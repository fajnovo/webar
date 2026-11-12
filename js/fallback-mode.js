// Náhradný 3D režim (bez AR): rovnaká scéna, kocku obchádzaš ťahaním prsta.
// Slúži pre zariadenia bez podpory AR a ako rýchla kontrola tieňov.

import { buildTestScene } from './test-scene.js?v=2';

export function startFallback({ THREE, canvas, hud }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe8d2);
  buildTestScene(THREE, scene, { visibleFloor: true });

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 20);
  let theta = 0.6;
  let phi = 1.1;
  let radius = 0.9;

  const updateCamera = () => {
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi) + 0.1,
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, 0.1, 0);
  };

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  updateCamera();

  // Ovládanie: 1 prst = otáčanie, 2 prsty (alebo koliesko) = priblíženie.
  const pointers = new Map();
  let pinchStart = 0;
  let radiusStart = radius;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      radiusStart = radius;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      theta -= (cur.x - prev.x) * 0.008;
      phi = clamp(phi - (cur.y - prev.y) * 0.008, 0.2, 1.5);
    }
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinchStart > 0) {
      const [a, b] = [...pointers.values()];
      radius = clamp(radiusStart * (pinchStart / Math.hypot(a.x - b.x, a.y - b.y)), 0.35, 2.5);
    }
    updateCamera();
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    radius = clamp(radius * (1 + Math.sign(e.deltaY) * 0.08), 0.35, 2.5);
    updateCamera();
  }, { passive: true });

  let raf = 0;
  const loop = () => {
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  hud.setPlaceHandler(null);
  hud.setStatus('3D náhľad (bez AR)', true);
  hud.setInfo('');
  hud.setHint('Ťahaj prstom a obchádzaj kocku. Dvoma prstami približuješ.');

  return {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
