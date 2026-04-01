const scene    = new THREE.Scene();
const camera3d = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('three-container').appendChild(renderer.domElement);

scene.background = new THREE.Color(0x000000);
camera3d.position.set(0, 8, 50);
camera3d.lookAt(0, 0, 0);

const ROWS = 52, COLS = 140, SIZE = 80;
const lineMeshes = [];

for (let r = 0; r < ROWS; r++) {
  const points = [];
  for (let c = 0; c < COLS; c++) {
    points.push(new THREE.Vector3(
      (c / (COLS - 1) - 0.5) * SIZE,
      0,
      (r / (ROWS - 1) - 0.5) * SIZE
    ));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  lineMeshes.push({ line: new THREE.Line(geo, mat), geo, r });
  scene.add(lineMeshes[lineMeshes.length - 1].line);
}

const FM_MIN = 88.0, FM_MAX = 108.0;

window.you = { x: 0, z: 0, freq: 88.0, amp: 1.0 };
const others = [
  { x: -16, z:  -6, freq: 91.3,  amp: 0.6  },
  { x:  18, z:  -4, freq: 95.7,  amp: 0.55 },
  { x:  -6, z:  14, freq: 100.1, amp: 0.5  },
  { x:  13, z:  16, freq: 88.5,  amp: 0.5  },
  { x:   3, z: -18, freq: 105.3, amp: 0.45 },
];
const sources = [window.you, ...others];

const youRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.0, 0.06, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
youRing.rotation.x = Math.PI / 2;
scene.add(youRing);

const otherRings = others.map(s => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.05, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x777777 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(s.x, 0, s.z);
  scene.add(ring);
  return ring;
});

let isDragging = false, lastX = 0, lastY = 0;
let orbitTheta = 0, orbitPhi = 1.15;
const ORBIT_R = 58;

renderer.domElement.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  orbitTheta -= (e.clientX - lastX) * 0.005;
  orbitPhi = Math.max(0.08, Math.min(1.45, orbitPhi - (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
});

window.targetFreq = 88.0;
window.targetAmp  = 1.0;
window.handActive = false;

window.addEventListener('wheel', e => {
  if (window.handActive) return;
  window.targetFreq = Math.max(FM_MIN, Math.min(FM_MAX, window.targetFreq + e.deltaY * 0.008));
}, { passive: true });

function wave(dx, dz, freq, time, amp) {
  const dist = Math.sqrt(dx * dx + dz * dz) + 0.001;
  const k    = (freq - FM_MIN) / (FM_MAX - FM_MIN) * 1.2 + 0.5;
  return amp * Math.sin(k * dist - k * 1.6 * time) / (1 + dist * 0.09);
}

const freqDisplay = document.getElementById('freq-display');
let clock = 0;

function animate() {
  requestAnimationFrame(animate);
  clock += 0.016;

  window.you.freq += (window.targetFreq - window.you.freq) * 0.06;
  window.you.amp  += (window.targetAmp  - window.you.amp)  * 0.06;
  freqDisplay.textContent = 'FM ' + window.you.freq.toFixed(1);

  lineMeshes.forEach(({ line, geo, r }) => {
    const posArr = geo.attributes.position.array;
    for (let c = 0; c < COLS; c++) {
      const x = posArr[c * 3], z = posArr[c * 3 + 2];
      let h = 0;
      sources.forEach(s => { h += wave(x - s.x, z - s.z, s.freq, clock, s.amp); });
      posArr[c * 3 + 1] = h * 1.8;
    }
    geo.attributes.position.needsUpdate = true;
    line.material.opacity = 0.3 + (r / (ROWS - 1)) * 0.55;
  });

  youRing.position.y = wave(0, 0, window.you.freq, clock, window.you.amp) * 1.8;
  others.forEach((s, i) => {
    otherRings[i].position.y = wave(s.x, s.z, s.freq, clock, s.amp) * 1.8;
  });

  camera3d.position.x = ORBIT_R * Math.sin(orbitTheta) * Math.sin(orbitPhi);
  camera3d.position.y = ORBIT_R * Math.cos(orbitPhi);
  camera3d.position.z = ORBIT_R * Math.cos(orbitTheta) * Math.sin(orbitPhi);
  camera3d.lookAt(0, 0, 0);

  if (window.updateAudio) window.updateAudio(window.you.freq, window.you.amp);

  renderer.render(scene, camera3d);
}

animate();

window.addEventListener('resize', () => {
  camera3d.aspect = innerWidth / innerHeight;
  camera3d.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});