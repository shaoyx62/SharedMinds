const debugEl       = document.getElementById('debug');
const statusEl      = document.getElementById('gesture-status');
const overlayCanvas = document.getElementById('overlay');
const ctx           = overlayCanvas.getContext('2d');
const lockIndicator = document.getElementById('lock-indicator');

function setDebug(msg) { debugEl.textContent = msg; }

overlayCanvas.width  = 200;
overlayCanvas.height = 150;

window.targetFreq = 88.0;
window.targetAmp  = 1.0;
window.handActive = false;

let locked = false;
window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    locked = !locked;
    lockIndicator.textContent = locked ? '⏸ locked' : '▶ live';
    lockIndicator.style.opacity = locked ? '1' : '0.3';
  }
});

const SMOOTH = 18;
let angleBuffer  = [];
let heightBuffer = [];

function smoothPush(buf, val) {
  buf.push(val);
  if (buf.length > SMOOTH) buf.shift();
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

//add midpoint line to stable hand tracking
const MIDPOINT  = 256;
const HYSTERESIS = 40; //px dead zone around midpoint

// track last known assignment
let prevAssignment = { right: null, left: null };

function assignHands(hands) {
  if (hands.length === 0) return { right: null, left: null };

  if (hands.length === 1) {
    const wristX = hands[0].keypoints[0].x;
    if (wristX < MIDPOINT - HYSTERESIS) return { right: hands[0].keypoints, left: null };
    if (wristX > MIDPOINT + HYSTERESIS) return { right: null, left: hands[0].keypoints };
    // in dead zone, keep previous assignment for this hand
    const prev = prevAssignment;
    return prev.right ? { right: hands[0].keypoints, left: null }
                      : { right: null, left: hands[0].keypoints };
  }
  const sorted = [...hands].sort((a, b) => a.keypoints[0].x - b.keypoints[0].x);
  return { right: sorted[0].keypoints, left: sorted[1].keypoints };
}

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

const sketch = (p) => {
  let video;
  let handpose;
  let hands = [];

  p.preload = function() {
    setDebug('loading handpose...');
    handpose = ml5.handPose();
  };

  p.setup = function() {
    let cnv = p.createCanvas(512, 512);
    cnv.parent('p5-container');
    video = p.createCapture(p.VIDEO);
    video.size(512, 512);
    video.hide();
    handpose.detectStart(video, (results) => {
      hands = results;
      setDebug('ready · hands: ' + hands.length);
    });
    setDebug('camera ready');
  };

  p.draw = function() {
    p.clear();
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const mx = (x) => overlayCanvas.width  - (x / 512) * overlayCanvas.width;
    const my = (y) => (y / 512) * overlayCanvas.height;

    hands.forEach(hand => {
      const kps = hand.keypoints;
      const isRightSideOfFrame = kps[0].x < MIDPOINT;
      const col    = isRightSideOfFrame ? 'rgba(255,140,60,0.5)' : 'rgba(80,160,255,0.5)';
      const dotCol = isRightSideOfFrame ? '#ff8844' : '#4499ff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(mx(kps[a].x), my(kps[a].y));
        ctx.lineTo(mx(kps[b].x), my(kps[b].y));
        ctx.stroke();
      });
      kps.forEach((kp, i) => {
        ctx.fillStyle = i === 0 ? dotCol : col;
        ctx.beginPath();
        ctx.arc(mx(kp.x), my(kp.y), i === 0 ? 4 : 2, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    if (locked) {
      statusEl.textContent = '';
      return;
    }

    const parts = [];
    const { right: rightHand, left: leftHand } = assignHands(hands);
    prevAssignment = { right: rightHand, left: leftHand };

    // left hand tilt, frequency
    if (leftHand) {
      const wrist  = leftHand[0];
      const midMCP = leftHand[9];
      const rawAngle = Math.atan2(midMCP.y - wrist.y, midMCP.x - wrist.x);
      const angle    = smoothPush(angleBuffer, rawAngle);
      const norm     = (angle - (-Math.PI)) / Math.PI;
      window.targetFreq = 88.0 + Math.max(0, Math.min(1, norm)) * 20.0;
      parts.push('left: tune');
    }

    // right hand height, amplitude
    if (rightHand) {
      const wristY   = rightHand[0].y;
      const rawH     = 1.0 - (wristY / 512);
      const height   = smoothPush(heightBuffer, rawH);
      window.targetAmp = 0.2 + height * 2.6;
      parts.push('right: amplitude');
    }

    statusEl.textContent = parts.join('  ·  ');
  };
};

function loadML5() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/ml5@1.2.1/dist/ml5.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('ml5 failed'));
    document.head.appendChild(s);
  });
}

loadML5().then(() => {
  new p5(sketch);
}).catch(err => {
  setDebug('ml5 error: ' + err.message);
});