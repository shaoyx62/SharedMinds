const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

scene.background = new THREE.Color(0x000000);

camera.position.set(0, 8, 50);
camera.lookAt(0, 0, 0);

//line grid
const ROWS = 52;
const COLS = 140;
const SIZE = 80;

const lineMeshes = [];

for (let r = 0; r < ROWS; r++) {
  const points = [];
  for (let c = 0; c < COLS; c++) {
    const x = (c / (COLS - 1) - 0.5) * SIZE;
    const z = (r / (ROWS - 1) - 0.5) * SIZE;
    points.push(new THREE.Vector3(x, 0, z));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
  });

  const line = new THREE.Line(geo, mat);
  scene.add(line);
  lineMeshes.push({ line, geo, r });
}

//waves
const FM_MIN = 88.0;
const FM_MAX = 108.0;

const user = { x: 0, z: 0, freq: 88.0, amp: 1.0 };

const others = [
  { x: -16, z:  -6, freq: 91.3,  amp: 0.6  },
  { x:  18, z:  -4, freq: 95.7,  amp: 0.55 },
  { x:  -6, z:  14, freq: 100.1, amp: 0.5  },
  { x:  13, z:  16, freq: 88.5,  amp: 0.5  },
  { x:   3, z: -18, freq: 105.3, amp: 0.45 },
];

const sources = [user, ...others];

//rings
const userRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.0, 0.06, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
userRing.rotation.x = Math.PI / 2;
userRing.position.set(user.x, 0, user.z);
scene.add(userRing);

const otherRings = others.map(s => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.05, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x888888 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(s.x, 0, s.z);
  scene.add(ring);
  return ring;
});

//tuning
const freqDisplay = document.getElementById('freq-display');
let targetFreq = 88.0;

window.addEventListener('wheel', e => {
  targetFreq += e.deltaY * 0.008;
  targetFreq = Math.max(FM_MIN, Math.min(FM_MAX, targetFreq));
}, { passive: true });

//mouse drag camera orbit
let isDragging = false;
let lastX = 0;
let lastY = 0;

let orbitTheta = 0;
let orbitPhi = 1.15;
const ORBIT_R  = 58;

renderer.domElement.addEventListener('mousedown', e => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  orbitTheta -= (e.clientX - lastX) * 0.005;
  orbitPhi = Math.max(0.08, Math.min(1.45, orbitPhi - (e.clientY - lastY) * 0.004));
  lastX = e.clientX;
  lastY = e.clientY;
});

//wave function
function wave(dx, dz, freq, time, amp) {
  const dist = Math.sqrt(dx * dx + dz * dz) + 0.001;
  const k = (freq - FM_MIN) / (FM_MAX - FM_MIN) * 1.2 + 0.5;
  const speed = k * 1.6;
  return amp * Math.sin(k * dist - speed * time) / (1 + dist * 0.09);
}

let clock = 0;

function animate() {
  requestAnimationFrame(animate);
  clock += 0.016;

  //smooth frequency
  user.freq += (targetFreq - user.freq) * 0.05;
  freqDisplay.textContent = 'FM ' + user.freq.toFixed(1);

  //update each line
  lineMeshes.forEach(({ line, geo, r }) => {
    const posArr = geo.attributes.position.array;

    for (let c = 0; c < COLS; c++) {
      const x = posArr[c * 3];
      const z = posArr[c * 3 + 2];
      let h = 0;
      for (const s of sources) {
        h += wave(x - s.x, z - s.z, s.freq, clock, s.amp);
      }
      posArr[c * 3 + 1] = h * 1.8;
    }

    geo.attributes.position.needsUpdate = true;

    //lines in front slightly brighter
    const zNorm = r / (ROWS - 1); // 0 = back, 1 = front
    line.material.opacity = 0.3 + zNorm * 0.55;
  });

  // float rings on wave surface
  const userH = wave(0, 0, user.freq, clock, user.amp) * 1.8;
  userRing.position.y = userH;

  others.forEach((s, i) => {
    const h = wave(0, 0, s.freq, clock, s.amp) * 1.8;
    otherRings[i].position.y = h;
  });

  // camera orbit
  camera.position.x = ORBIT_R * Math.sin(orbitTheta) * Math.sin(orbitPhi);
  camera.position.y = ORBIT_R * Math.cos(orbitPhi);
  camera.position.z = ORBIT_R * Math.cos(orbitTheta) * Math.sin(orbitPhi);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

animate();