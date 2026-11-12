// AR režim B: natívny WebXR (na Androide beží nad ARCore).
// Sledovanie priestoru robí operačný systém, nie JavaScript, preto býva stabilnejšie.
// Nefunguje na iPhone (Safari WebXR AR nepodporuje).

import { buildTestScene } from './test-scene.js?v=2';

const MIN_DIST = 0.2; // m
const MAX_DIST = 4; // m
const STABLE_MS = 1000;
const MIN_UP = 0.8; // normála povrchu musí smerovať hore (vodorovná plocha)

export async function isWebXRArSupported() {
  try {
    return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
  } catch (e) {
    return false;
  }
}

export async function startWebXR({ THREE, canvas, hud, diag, overlayRoot, onEnd }) {
  diag.log('WebXR: žiadam reláciu immersive-ar');
  const init = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'] };
  if (overlayRoot) init.domOverlay = { root: overlayRoot };
  const session = await navigator.xr.requestSession('immersive-ar', init);
  diag.set('WebXR relácia', 'vytvorená');
  diag.set('WebXR funkcie', (session.enabledFeatures || ['(prehliadač nehlási)']).join(', '));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local'); // 'local' podporuje každá AR relácia
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const anchor = buildTestScene(THREE, scene).root;
  anchor.visible = false;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe8a317, transparent: true, opacity: 0.9, depthTest: false })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  reticle.renderOrder = 10;
  scene.add(reticle);

  const refSpace = renderer.xr.getReferenceSpace();
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });
  diag.set('hitTest dostupný', 'áno (XRHitTestSource)');

  // --- stav ---
  let placed = false;
  let tracking = false;
  let trackingSince = 0;
  let lastHit = null; // { pos: Vector3, ny, distance }
  let hitCount = 0;
  let frames = 0;
  let fpsStart = performance.now();
  let lastUi = 0;
  const m = new THREE.Matrix4();

  function readiness() {
    if (!tracking) return { ok: false, reason: 'Sledovanie sa stratilo alebo sa ešte neinicializovalo. Pomaly pohybuj telefónom.' };
    if (performance.now() - trackingSince < STABLE_MS) return { ok: false, reason: 'Sledovanie sa ustaľuje, chvíľu pohybuj telefónom.' };
    if (!lastHit) return { ok: false, reason: 'V strede obrazovky nevidím vodorovný povrch. Zameraj stôl.' };
    return { ok: true, reason: '' };
  }

  function refreshUi() {
    const r = readiness();
    reticle.material.color.setHex(r.ok ? 0x2e7d32 : 0xe8a317);
    hud.setPlaceEnabled(r.ok && !placed);
    if (placed) {
      hud.setHint(
        tracking
          ? 'Umiestnené. Obíď stôl a sleduj, či kocka zostáva na mieste.'
          : 'POZOR: sledovanie sa stratilo, poloha kocky nie je spoľahlivá. Pohybuj telefónom pomaly.'
      );
    } else {
      hud.setHint(r.ok ? 'Zameraj stred na stôl a ťukni na obrazovku.' : r.reason);
    }
    hud.setStatus(tracking ? 'AR OK – sledovanie normálne (WebXR)' : 'AR: sledovanie obmedzené (WebXR)', tracking);
    diag.set('pripravenosť na umiestnenie', r.ok ? 'ÁNO' : 'NIE – ' + r.reason);
    diag.set('objekt', placed ? (tracking ? 'umiestnený, sledovanie OK' : 'umiestnený, poloha NEISTÁ') : 'neumiestnený');
  }

  function tryPlace() {
    if (placed) return;
    const r = readiness();
    if (!r.ok) {
      hud.setHint(r.reason);
      diag.log('Umiestnenie odmietnuté: ' + r.reason);
      return;
    }
    anchor.position.copy(lastHit.pos);
    anchor.visible = true;
    placed = true;
    reticle.visible = false;
    hud.showReset(true);
    diag.log(
      `Umiestnené: vzdialenosť ${lastHit.distance.toFixed(2)} m, pozícia ` +
        `${lastHit.pos.x.toFixed(2)}, ${lastHit.pos.y.toFixed(2)}, ${lastHit.pos.z.toFixed(2)}`
    );
    refreshUi();
  }

  session.addEventListener('select', tryPlace);
  hud.setPlaceHandler(tryPlace);
  diag.log('WebXR: relácia beží');

  renderer.setAnimationLoop((time, frame) => {
    if (!frame) return;
    frames += 1;

    const viewer = frame.getViewerPose(refSpace);
    const nowTracking = !!viewer && !viewer.emulatedPosition;
    if (nowTracking && !tracking) trackingSince = performance.now();
    if (nowTracking !== tracking) {
      diag.log('Sledovanie: ' + (nowTracking ? 'OK' : 'STRATENÉ (emulatedPosition)'));
    }
    tracking = nowTracking;

    const results = frame.getHitTestResults(hitSource);
    hitCount = results.length;
    lastHit = null;
    reticle.visible = false;
    if (results.length && viewer) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        m.fromArray(pose.transform.matrix);
        const pos = new THREE.Vector3().setFromMatrixPosition(m);
        const ny = pose.transform.matrix[5]; // y-os pózy = normála povrchu
        const vp = viewer.transform.position;
        const distance = Math.hypot(pos.x - vp.x, pos.y - vp.y, pos.z - vp.z);
        if (ny >= MIN_UP && distance >= MIN_DIST && distance <= MAX_DIST && Number.isFinite(pos.x + pos.y + pos.z)) {
          lastHit = { pos, ny, distance };
          if (!placed) {
            reticle.visible = true;
            reticle.matrix.copy(m);
          }
        } else {
          diag.set('hitTest odmietnutý', `ny=${ny.toFixed(2)}, vzdialenosť=${distance.toFixed(2)} m`);
        }
      }
    }

    const now = performance.now();
    if (now - lastUi > 100) {
      lastUi = now;
      refreshUi();
    }
    if (now - fpsStart >= 500) {
      const fps = Math.round((frames * 1000) / (now - fpsStart));
      frames = 0;
      fpsStart = now;
      const dist = placed ? 'umiestnené' : '–';
      hud.setInfo(`FPS ${fps} · ${dist}`);
      diag.set('FPS', fps);
      diag.set(
        'hitTest (stred obrazovky)',
        lastHit ? `${hitCount} výsledkov, platný, ${lastHit.distance.toFixed(2)} m, normála y=${lastHit.ny.toFixed(2)}` : `${hitCount} výsledkov, žiadny platný`
      );
    }

    renderer.render(scene, camera);
  });

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    diag.log('WebXR: relácia skončila');
    if (onEnd) onEnd();
  });

  return {
    reset() {
      anchor.visible = false;
      placed = false;
      hud.showReset(false);
      diag.log('Umiestnenie zrušené, môžeš umiestniť znova');
      refreshUi();
    },
    stop() {
      session.end();
    },
  };
}
