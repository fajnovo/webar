// Spoločná testovacia scéna: kocka 20 cm s kontaktným tieňom.
// Používa ju AR režim aj náhradný 3D režim. THREE sa odovzdáva zvonku,
// aby sa dala rovnaká verzia použiť pre engine aj pre scénu.

export const CUBE_SIZE = 0.2; // metre (platí pri absolútnej mierke AR)

export function buildTestScene(THREE, parent, { size = CUBE_SIZE, visibleFloor = false } = {}) {
  const root = new THREE.Group();
  root.name = 'testAnchor';
  parent.add(root);

  // Zem: v AR je neviditeľná a zachytáva len tieň, v náhľade je viditeľná.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    visibleFloor
      ? new THREE.MeshStandardMaterial({ color: 0xf3e9d2, roughness: 1 })
      : new THREE.ShadowMaterial({ opacity: 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Biely kruh okolo kocky - ukazuje bod, kde sa objekt dotýka stola.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.95, size * 1.02, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  root.add(ring);

  // Kocka s rôznofarebnými stenami, aby bolo vidieť natočenie pri obchádzaní.
  const faceColors = [0xe8a317, 0x4caf50, 0x2196f3, 0xe53935, 0x8e24aa, 0xfafafa];
  const materials = faceColors.map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 })
  );
  const cube = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials);
  cube.position.y = size / 2;
  cube.castShadow = true;
  root.add(cube);

  // Svetlá: jemné okolité + smerové so tieňom.
  root.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.9));

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, 1.4, 0.5);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -0.6;
  sun.shadow.camera.right = 0.6;
  sun.shadow.camera.top = 0.6;
  sun.shadow.camera.bottom = -0.6;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 4;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 4;
  root.add(sun);
  root.add(sun.target);

  return { root, cube };
}
