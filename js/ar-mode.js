// AR režim A: Three.js + 8th Wall engine (distribuovaný binárny súbor, SLAM v prehliadači).
// Verzia 2: oprava veľkosti plátna, kontrola pripravenosti pred umiestnením,
// zameriavač s priebežným hitTest a podrobná diagnostika.

import { buildTestScene } from './test-scene.js?v=2';

const ENGINE_SRC = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js';
const CAMERA_HEIGHT = 1.4; // m - východisková výška kamery (počiatok súradníc scény je "zem")
const HIT_TYPES = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT']; // poradie = priorita
const MIN_DIST = 0.2; // m
const MAX_DIST = 4; // m
const STABLE_MS = 1500; // ako dlho musí byť sledovanie v poriadku pred umiestnením

const REASONS = {
  INITIALIZING: 'inicializácia, pohybuj telefónom doprava a doľava',
  EXCESSIVE_MOTION: 'príliš rýchly pohyb, spomaľ',
  INSUFFICIENT_FEATURES: 'málo detailov na obraze, zameraj stôl s textúrou',
};

function loadEngine(diag) {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve();
    const timer = setTimeout(() => reject(new Error('Engine sa nenačítal (časový limit 20 s).')), 20000);
    window.addEventListener('xrloaded', () => { clearTimeout(timer); resolve(); }, { once: true });
    const s = document.createElement('script');
    s.src = ENGINE_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.preloadChunks = 'slam'; // = data-preload-chunks="slam"
    s.onerror = () => { clearTimeout(timer); reject(new Error('Engine sa nepodarilo stiahnuť.')); };
    document.head.appendChild(s);
    diag.log('Sťahujem engine: ' + ENGINE_SRC);
  });
}

// iOS vyžaduje povolenie senzorov pohybu priamo po ťuknutí na tlačidlo.
async function askMotionPermission(diag) {
  for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    if (E && typeof E.requestPermission === 'function') {
      const r = await E.requestPermission();
      diag.log('Povolenie pohybu: ' + r);
      if (r !== 'granted') throw new Error('Pohyb telefónu nebol povolený.');
    }
  }
}

function deviceSupportsAR(diag) {
  try {
    const ok = XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices: XR8.XrConfig.device().ANY });
    diag.set('zariadenie kompatibilné (engine)', ok);
    return ok !== false;
  } catch (e) {
    diag.set('zariadenie kompatibilné (engine)', 'nezistené: ' + e.message);
    return true;
  }
}

// Plátno MUSÍ zaberať celé okno a jeho vnútorné rozlíšenie musí zodpovedať oknu.
// (V ukážkach 8th Wall to robí XRExtras.FullWindowCanvas, ktorý tu nie je načítaný.)
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function describeCanvas(canvas, diag, warned) {
  const bw = canvas.width, bh = canvas.height;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  diag.set('canvas buffer / css / okno', `${bw}×${bh} / ${cw}×${ch} / ${window.innerWidth}×${window.innerHeight}`);
  const aspectBuf = bw / bh;
  const aspectCss = cw / ch;
  const problems = [];
  if (Math.abs(aspectBuf - aspectCss) / aspectCss > 0.02) problems.push('pomer strán buffera nesedí s css');
  if (Math.abs(ch - window.innerHeight) > 4) problems.push('výška plátna nezodpovedá oknu');
  if (Math.abs(cw - window.innerWidth) > 4) problems.push('šírka plátna nezodpovedá oknu');
  diag.set('canvas kontrola', problems.length ? 'PROBLÉM: ' + problems.join('; ') : 'v poriadku');
  const key = problems.join('|');
  if (problems.length && !warned.has(key)) {
    warned.add(key);
    diag.error('Canvas: ' + problems.join('; '));
  }
}

export async function startAR({ THREE, canvas, hud, diag, scaleMode = 'absolute' }) {
  await askMotionPermission(diag);
  hud.setHint('Sťahujem AR engine…');
  await loadEngine(diag);
  try {
    if (typeof XR8.version === 'function') diag.set('verzia enginu', XR8.version());
  } catch (e) { /* nepovinné */ }
  diag.set('hitTest dostupný', typeof (XR8.XrController && XR8.XrController.hitTest) === 'function' ? 'áno' : 'NIE');
  if (!deviceSupportsAR(diag)) throw new Error('Toto zariadenie alebo prehliadač nepodporuje AR.');

  // --- stav ---
  let anchor = null;
  let reticle = null;
  let cam = null;
  let placed = false;
  let trackStatus = 'čakám';
  let trackReason = '';
  let tracking = false;
  let trackingSince = 0;
  let lastHit = null; // { x, y, z, type, distance }
  let hitCount = 0;
  let lastHitErr = '';
  let lastProbe = 0;
  let frames = 0;
  let fpsStart = performance.now();
  let fps = 0;
  const canvasWarned = new Set();

  // --- veľkosť plátna ---
  fitCanvas(canvas);
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fitCanvas(canvas); describeCanvas(canvas, diag, canvasWarned); }, 150);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // --- pripravenosť na umiestnenie ---
  function readiness() {
    if (!tracking) {
      return { ok: false, reason: 'Sledovanie: ' + (REASONS[trackReason] || trackReason || trackStatus) + '.' };
    }
    if (performance.now() - trackingSince < STABLE_MS) {
      return { ok: false, reason: 'Sledovanie sa ustaľuje, ešte chvíľu pomaly pohybuj telefónom.' };
    }
    if (!lastHit) {
      return { ok: false, reason: 'V strede obrazovky nevidím povrch. Zameraj stôl s textúrou.' };
    }
    return { ok: true, reason: '' };
  }

  function probeHit() {
    let hits = [];
    try {
      hits = XR8.XrController.hitTest(0.5, 0.5, HIT_TYPES) || [];
      lastHitErr = '';
    } catch (e) {
      if (lastHitErr !== e.message) diag.error('hitTest zlyhal: ' + e.message);
      lastHitErr = e.message;
      hits = [];
    }
    hitCount = hits.length;
    let chosen = null;
    for (const type of HIT_TYPES) {
      const h = hits.find((x) => x && x.type === type);
      if (!h || !h.position) continue;
      const p = h.position;
      if (![p.x, p.y, p.z].every(Number.isFinite)) continue;
      const dist = Number.isFinite(h.distance) ? h.distance : cam ? cam.position.distanceTo(p) : NaN;
      if (!(dist >= MIN_DIST && dist <= MAX_DIST)) continue;
      chosen = { x: p.x, y: p.y, z: p.z, type, distance: dist };
      break;
    }
    lastHit = chosen;
    diag.set(
      'hitTest (stred obrazovky)',
      chosen
        ? `${hitCount} výsledkov, vybraný ${chosen.type}, ${chosen.distance.toFixed(2)} m, y=${chosen.y.toFixed(2)}`
        : `${hitCount} výsledkov, žiadny platný`
    );
  }

  function refreshUi() {
    const r = readiness();
    if (reticle) {
      reticle.visible = !!lastHit && !placed;
      if (lastHit) reticle.position.set(lastHit.x, lastHit.y + 0.003, lastHit.z);
      reticle.material.color.setHex(r.ok ? 0x2e7d32 : 0xe8a317);
    }
    hud.setPlaceEnabled(r.ok && !placed);
    if (placed) {
      hud.setHint(
        tracking
          ? 'Umiestnené. Obíď stôl a sleduj, či kocka zostáva na mieste.'
          : 'POZOR: sledovanie sa stratilo, poloha kocky nie je spoľahlivá. Pohybuj telefónom pomaly.'
      );
    } else {
      hud.setHint(r.ok ? 'Zameraj stred na stôl a ťukni na „Umiestniť“.' : r.reason);
    }
    diag.set(
      'pripravenosť na umiestnenie',
      r.ok ? 'ÁNO' : 'NIE – ' + r.reason
    );
    diag.set('objekt', placed ? (tracking ? 'umiestnený, sledovanie OK' : 'umiestnený, poloha NEISTÁ') : 'neumiestnený');
  }

  function tryPlace() {
    if (placed) return;
    probeHit();
    const r = readiness();
    if (!r.ok) {
      hud.setHint(r.reason);
      diag.log('Umiestnenie odmietnuté: ' + r.reason);
      return;
    }
    anchor.position.set(lastHit.x, lastHit.y, lastHit.z);
    anchor.visible = true;
    placed = true;
    hud.showReset(true);
    diag.log(
      `Umiestnené: ${lastHit.type}, vzdialenosť ${lastHit.distance.toFixed(2)} m, ` +
        `pozícia ${lastHit.x.toFixed(2)}, ${lastHit.y.toFixed(2)}, ${lastHit.z.toFixed(2)}`
    );
    refreshUi();
  }

  const pipeline = {
    name: 'fajnovo-ar-test',
    onStart: () => {
      const { scene, camera, renderer } = XR8.Threejs.xrScene();
      cam = camera;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      anchor = buildTestScene(THREE, scene).root;
      anchor.visible = false;

      reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xe8a317, transparent: true, opacity: 0.9, depthTest: false })
      );
      reticle.visible = false;
      reticle.renderOrder = 10;
      scene.add(reticle);

      // Kópie hodnôt (nie živé objekty kamery).
      camera.position.set(0, CAMERA_HEIGHT, 0);
      XR8.XrController.updateCameraProjectionMatrix({
        origin: { x: 0, y: CAMERA_HEIGHT, z: 0 },
        facing: { w: 1, x: 0, y: 0, z: 0 },
      });

      canvas.addEventListener('pointerdown', tryPlace);
      hud.setPlaceHandler(tryPlace);
      hud.setStatus('AR (8th Wall): čakám na sledovanie…', false);
      diag.log('Pipeline spustený, mierka: ' + scaleMode);
      describeCanvas(canvas, diag, canvasWarned);

      // Informácie o skutočnom kamerovom streame (napr. ultraširoký objektív).
      setTimeout(() => {
        try {
          const v = document.querySelector('video');
          const t = v && v.srcObject && v.srcObject.getVideoTracks()[0];
          if (t) {
            const s = t.getSettings();
            diag.set('kamera (stream)', `${t.label || 'bez názvu'}; ${s.width}×${s.height} @${s.frameRate} fps; facing ${s.facingMode}`);
          } else {
            diag.set('kamera (stream)', 'video element v DOM sa nenašiel');
          }
        } catch (e) {
          diag.set('kamera (stream)', 'chyba: ' + e.message);
        }
      }, 2000);
    },
    onCanvasSizeChange: (p) => {
      const d = p || {};
      diag.set('engine: veľkosť plátna', `canvas ${d.canvasWidth}×${d.canvasHeight}, video ${d.videoWidth}×${d.videoHeight}`);
      if (d.videoWidth && d.videoHeight) {
        diag.set('pomer strán kamery', (d.videoWidth / d.videoHeight).toFixed(3));
      }
      diag.log(`Zmena veľkosti: canvas ${d.canvasWidth}×${d.canvasHeight}, video ${d.videoWidth}×${d.videoHeight}`);
    },
    onUpdate: () => {
      frames += 1;
      const now = performance.now();
      if (now - lastProbe >= 100) {
        lastProbe = now;
        probeHit();
        refreshUi();
      }
      if (now - fpsStart >= 500) {
        fps = Math.round((frames * 1000) / (now - fpsStart));
        frames = 0;
        fpsStart = now;
        const dist = placed && cam ? cam.position.distanceTo(anchor.position).toFixed(2) + ' m' : '–';
        hud.setInfo(`FPS ${fps} · vzdialenosť ${dist}`);
        diag.set('FPS', fps);
        describeCanvas(canvas, diag, canvasWarned);
      }
    },
    onException: (err) => {
      const msg = err && err.message ? err.message : String(err);
      diag.error('Engine (onException): ' + msg);
      hud.fail('Chyba AR enginu: ' + msg);
    },
    onCameraStatusChange: (p) => {
      const status = p && p.status;
      diag.set('kamera (stav)', status);
      diag.log('Kamera: ' + status);
      if (status === 'failed') hud.fail('Kamera sa nespustila. Skontroluj povolenie kamery v prehliadači.');
    },
    listeners: [
      {
        event: 'reality.trackingstatus',
        process: ({ detail }) => {
          const was = tracking;
          trackStatus = detail.status;
          trackReason = detail.reason || '';
          tracking = detail.status === 'NORMAL';
          if (tracking && !was) trackingSince = performance.now();
          diag.set('sledovanie (engine)', `${detail.status}${detail.reason ? ' / ' + detail.reason : ''}`);
          diag.log(`Sledovanie: ${detail.status}${detail.reason ? ' / ' + detail.reason : ''}`);
          hud.setStatus(
            tracking ? 'AR OK – sledovanie normálne' : 'AR: sledovanie obmedzené' + (REASONS[trackReason] ? ' (' + REASONS[trackReason] + ')' : ''),
            tracking
          );
        },
      },
    ],
  };

  XR8.XrController.configure({ scale: scaleMode });
  diag.set('mierka (scale)', scaleMode);
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    pipeline,
  ]);
  XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
  diag.log('XR8.run() zavolané');

  return {
    reset() {
      if (anchor) anchor.visible = false;
      placed = false;
      hud.showReset(false);
      diag.log('Umiestnenie zrušené, môžeš umiestniť znova');
      refreshUi();
    },
  };
}
