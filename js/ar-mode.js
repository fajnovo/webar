// AR režim: Three.js + 8th Wall engine (distribuovaný binárny súbor, SLAM).
// Overené iba podľa dokumentácie 8thwall.org - na skutočnom mobile ešte netestované.

import { buildTestScene } from './test-scene.js';

const ENGINE_SRC = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js';
const CAMERA_HEIGHT = 1.4; // m - východisková výška kamery nad "zemou" scény

function loadEngine() {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve();
    const timer = setTimeout(() => reject(new Error('Engine sa nenačítal (časový limit).')), 20000);
    window.addEventListener('xrloaded', () => { clearTimeout(timer); resolve(); }, { once: true });
    const s = document.createElement('script');
    s.src = ENGINE_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.preloadChunks = 'slam'; // = data-preload-chunks="slam"
    s.onerror = () => { clearTimeout(timer); reject(new Error('Engine sa nepodarilo stiahnuť.')); };
    document.head.appendChild(s);
  });
}

// iOS vyžaduje povolenie senzorov pohybu a musí sa žiadať priamo po ťuknutí na tlačidlo.
async function askMotionPermission() {
  for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    if (E && typeof E.requestPermission === 'function') {
      const r = await E.requestPermission();
      if (r !== 'granted') throw new Error('Pohyb telefónu nebol povolený.');
    }
  }
}

function deviceSupportsAR() {
  try {
    const ok = XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices: XR8.XrConfig.device().ANY });
    return ok !== false;
  } catch (e) {
    return true; // ak sa to nedá zistiť, skúsime spustiť a zlyhanie zachytíme neskôr
  }
}

export async function startAR({ THREE, canvas, hud }) {
  await askMotionPermission();
  hud.setHint('Sťahujem AR engine…');
  await loadEngine();
  if (!deviceSupportsAR()) throw new Error('Toto zariadenie alebo prehliadač nepodporuje AR.');

  let anchor = null;
  let cam = null;
  let placed = false;
  let tracking = false;
  let frames = 0;
  let fpsStart = performance.now();
  let fps = 0;

  const onPointer = (e) => {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    const hits = XR8.XrController.hitTest(x, y, ['FEATURE_POINT']);
    if (!hits || !hits.length) {
      hud.setHint('Nenašiel som povrch. Pohni telefónom pomaly doprava a doľava a skús znova.');
      return;
    }
    const p = hits[0].position;
    anchor.position.set(p.x, p.y, p.z);
    anchor.visible = true;
    placed = true;
    hud.setHint(
      'Umiestnené. Obíď stôl a sleduj, či kocka zostáva na mieste. ' +
        (tracking ? '' : '(Sledovanie je zatiaľ slabé, skús ešte chvíľu hýbať telefónom.)')
    );
    hud.showReset(true);
  };

  const pipeline = {
    name: 'fajnovo-ar-test',
    onStart: () => {
      const xr = XR8.Threejs.xrScene();
      const { scene, camera, renderer } = xr;
      cam = camera;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      anchor = buildTestScene(THREE, scene).root;
      anchor.visible = false;

      camera.position.set(0, CAMERA_HEIGHT, 0);
      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      });

      canvas.addEventListener('pointerdown', onPointer);
      hud.setStatus('AR: čakám na sledovanie…', false);
      hud.setHint('Namier kameru na stôl a pomaly pohybuj telefónom. Keď sa stav zmení na „AR OK“, ťukni na stôl.');
    },
    onUpdate: () => {
      frames += 1;
      const now = performance.now();
      if (now - fpsStart >= 500) {
        fps = Math.round((frames * 1000) / (now - fpsStart));
        frames = 0;
        fpsStart = now;
        const dist = placed && cam ? cam.position.distanceTo(anchor.position).toFixed(2) + ' m' : '–';
        hud.setInfo(`FPS ${fps} · vzdialenosť ${dist}`);
      }
    },
    onException: (err) => hud.fail('Chyba AR: ' + (err && err.message ? err.message : err)),
    onCameraStatusChange: ({ status }) => {
      if (status === 'failed') hud.fail('Kamera sa nespustila. Skontroluj povolenie kamery v prehliadači.');
    },
    listeners: [
      {
        event: 'reality.trackingstatus',
        process: ({ detail }) => {
          tracking = detail.status === 'NORMAL';
          hud.setStatus(tracking ? 'AR OK – sledovanie stabilné' : 'AR: sledovanie obmedzené', tracking);
        },
      },
    ],
  };

  XR8.XrController.configure({ scale: 'absolute' });
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    pipeline,
  ]);
  XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });

  return {
    reset() {
      if (anchor) anchor.visible = false;
      placed = false;
      hud.setHint('Ťukni na stôl a umiestni kocku znova.');
    },
  };
}
