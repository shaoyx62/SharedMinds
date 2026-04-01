const STATION_FREQ = 95.7;
const LOCK_RANGE   = 1.2;

let audioCtx     = null;
let noiseGain    = null;
let broadcastGain = null;
let masterGain   = null;
let broadcastBuf = null;
let broadcastSrc = null;
let noiseNode    = null;
let started      = false;

function initAudio() {
  if (started) return;
  started = true;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain    = audioCtx.createGain();
  noiseGain     = audioCtx.createGain();
  broadcastGain = audioCtx.createGain();

  masterGain.gain.value    = 0.6;
  noiseGain.gain.value     = 1.0;
  broadcastGain.gain.value = 0.0;

  //white noise
  const bufSize  = audioCtx.sampleRate * 2;
  const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data     = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  noiseNode = audioCtx.createBufferSource();
  noiseNode.buffer = noiseBuf;
  noiseNode.loop   = true;

  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1200;
  bandpass.Q.value = 0.8;

  noiseNode.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  noiseNode.start();

  fetch('broadcast.mp3')
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => {
      broadcastBuf = decoded;
      startBroadcast();
      broadcastGain.connect(masterGain);
    })
    .catch(() => {
      console.log('No broadcast.mp3 found — static only mode');
    });
}

function startBroadcast() {
  if (broadcastSrc) { try { broadcastSrc.stop(); } catch(e) {} }
  broadcastSrc = audioCtx.createBufferSource();
  broadcastSrc.buffer = broadcastBuf;
  broadcastSrc.loop   = true;
  broadcastSrc.connect(broadcastGain);
  broadcastSrc.start();
}

window.updateAudio = function(freq, amp) {
  if (!started || !audioCtx) return;

  // distance from station in FM units
  const dist = Math.abs(freq - STATION_FREQ);
  const lock = Math.max(0, 1 - dist / LOCK_RANGE); // 0 = static, 1 = clear

  const targetNoise     = 1.0 - lock * 0.92;
  const targetBroadcast = lock;

  const t = audioCtx.currentTime + 0.05;
  noiseGain.gain.linearRampToValueAtTime(targetNoise, t);
  broadcastGain.gain.linearRampToValueAtTime(targetBroadcast, t);

  masterGain.gain.linearRampToValueAtTime(
    Math.max(0.05, Math.min(1.0, amp * 0.38)),
    t
  );

  const freqEl = document.getElementById('freq-display');
  if (freqEl) {
    freqEl.style.color = lock > 0.5
      ? `rgba(255,255,255,${0.7 + lock * 0.3})`
      : '#fff';
    freqEl.style.textShadow = lock > 0.5
      ? `0 0 ${Math.round(lock * 20)}px rgba(255,255,255,0.4)`
      : 'none';
  }
};

window.addEventListener('keydown', initAudio, { once: true });
window.addEventListener('click',   initAudio, { once: true });