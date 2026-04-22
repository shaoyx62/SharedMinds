/* ==========================================================
   RESONANCE — a study of meeting
   ---
   Core loop:
   1. Login → pick a name
   2. Intro → wait until another user is present
   3. Play  → two users each control one sine wave
              their sum must match a target composite wave
   4. Result → LUCKY / RARE / MISSED, saved to gallery
   5. Gallery
   ---
   For local testing: the two roles communicate via BroadcastChannel,
   so you can open two tabs of index.html and they sync.
   Dev panel lets one person swap roles + jump between screens.
   ========================================================== */

// ============================================================
// PARAMETERS — waves are pure sine: y = amp * sin(freq * x + phase)
// ============================================================
const PLAY_DURATION   = 60;       // seconds
const MATCH_THRESHOLD = 0.55;     // >= this = LUCKY/RARE (was 0.85 — way too hard)
const MISS_THRESHOLD  = 0.25;     // below this at timeout = MISSED (was 0.55)
const SAMPLE_POINTS   = 400;      // points across canvas for comparison
const X_RANGE         = Math.PI * 4; // wave x spans 0 .. 4π

// parameter ranges — narrower freq range makes it easier to match
const FREQ_MIN = 0.8, FREQ_MAX = 3.5;
const AMP_MIN  = 0.1, AMP_MAX  = 1.0;
const PHASE_MIN = 0,  PHASE_MAX = Math.PI * 2;

// ============================================================
// STATE
// ============================================================
const state = {
  role: null,                 // 'A' | 'B'
  name: 'anonymous',
  screen: 'login',
  peer: {                     // the other user's current wave
    present: false,
    name: '—',
    freq:  1.5,
    amp:   0.5,
    phase: 0,
  },
  me: {
    freq:  1.5,
    amp:   0.5,
    phase: 0,
  },
  target: null,               // {aFreq, aAmp, aPhase, bFreq, bAmp, bPhase}
  timeLeft: PLAY_DURATION,
  playing: false,
  aiHelper: null,             // null or {freq, amp, phase}
  matchPct: 0,
};

// ============================================================
// FIREBASE INIT
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCDiqN2YBLvo-OId0avSakGCEjlaZjWrC0",
  authDomain: "week5-server.firebaseapp.com",
  databaseURL: "https://week5-server-default-rtdb.firebaseio.com",
  projectId: "week5-server",
  storageBucket: "week5-server.firebasestorage.app",
  messagingSenderId: "930220057354",
  appId: "1:930220057354:web:7205c19228fe5d945d10f3"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

// ============================================================
// FIREBASE REALTIME — replaces BroadcastChannel
// ============================================================
// Room structure in DB:
//   /rooms/{roomId}/players/{A|B}: { uid, name, freq, amp, phase, ts }
//   /rooms/{roomId}/target: { aFreq, aAmp, aPhase, bFreq, bAmp, bPhase }
//   /rooms/{roomId}/status: 'waiting' | 'encounter' | 'playing' | 'finished'
//   /rooms/{roomId}/result: { tier, matchPct }
// Matchmaking:
//   /queue: ordered list of waiting users. First creates a room, second joins.

let roomRef = null;
let roomId  = null;
let myUid   = null;
let peerListener = null;
let statusListener = null;

function send(type, payload = {}) {
  // Firebase version: write directly to the room
  if (!roomRef || !state.role) return;
  const now = firebase.database.ServerValue.TIMESTAMP;

  switch (type) {
    case 'wave':
      roomRef.child('players/' + state.role).update({
        freq: state.me.freq,
        amp:  state.me.amp,
        phase: state.me.phase,
        ts: now
      });
      break;
    case 'start':
      roomRef.child('target').set(payload.target);
      roomRef.child('status').set('encounter');
      break;
    case 'finish':
      roomRef.child('result').set({ tier: payload.tier, matchPct: payload.matchPct });
      roomRef.child('status').set('finished');
      break;
    case 'leave':
    case 'bye':
      leaveRoom();
      break;
  }
}

function leaveRoom() {
  if (roomRef && state.role) {
    roomRef.child('players/' + state.role).remove();
    // If I'm the last one, clean up the room
    roomRef.child('players').once('value', snap => {
      if (!snap.exists() || Object.keys(snap.val()).length === 0) {
        roomRef.remove();
      }
    });
  }
  if (peerListener)   { peerListener(); peerListener = null; }
  if (statusListener) { statusListener(); statusListener = null; }
  roomRef = null;
  roomId  = null;
  state.role = null;
  state.peer.present = false;
  state.peer.name = '—';
}

function joinMatchmaking() {
  if (!myUid) return;
  console.log('[MATCH] joining queue, uid:', myUid);
  const queueRef = db.ref('queue');

  // Add myself to the queue with a simple numeric timestamp
  const myEntryRef = queueRef.push();
  const myEntryKey = myEntryRef.key;
  myEntryRef.set({
    uid: myUid,
    name: state.name,
    ts: Date.now()
  }).then(() => {
    console.log('[MATCH] added to queue with key:', myEntryKey);
  });

  // Watch the queue — when we see 2+ entries, the earliest one does the pairing
  const queueWatcher = queueRef.on('value', (snap) => {
    const entries = snap.val();
    console.log('[MATCH] queue changed:', JSON.stringify(entries));
    if (!entries) return;

    const keys = Object.keys(entries);
    console.log('[MATCH] queue size:', keys.length);
    if (keys.length < 2) return;

    // Sort by timestamp
    keys.sort((a, b) => (entries[a].ts || 0) - (entries[b].ts || 0));

    // Find myself
    const myIdx = keys.findIndex(k => entries[k].uid === myUid);
    if (myIdx === -1) {
      console.log('[MATCH] I am no longer in queue (already matched)');
      return;
    }

    // Find someone else
    const otherIdx = keys.findIndex(k => entries[k].uid !== myUid);
    if (otherIdx === -1) return;

    const theirKey = keys[otherIdx];
    const them = entries[theirKey];

    console.log('[MATCH] found pair! me:', myIdx, 'them:', otherIdx, 'I am earlier:', myIdx < otherIdx);

    // Only the earlier one creates the room
    if (myIdx > otherIdx) {
      console.log('[MATCH] waiting — the other person will create the room');
      return;
    }

    // I'm earlier — create the room
    console.log('[MATCH] I am creating the room');
    queueRef.off('value', queueWatcher);

    const newRoomId = db.ref('rooms').push().key;
    const updates = {};
    updates['assignments/' + myUid]    = { roomId: newRoomId, role: 'A' };
    updates['assignments/' + them.uid] = { roomId: newRoomId, role: 'B' };
    updates['rooms/' + newRoomId + '/status'] = 'waiting';
    updates['queue/' + myEntryKey] = null;
    updates['queue/' + theirKey]   = null;

    db.ref().update(updates).then(() => {
      console.log('[MATCH] room created:', newRoomId);
    }).catch(err => {
      console.error('[MATCH] failed to create room:', err);
    });
  });

  // Listen for my assignment
  const assignRef = db.ref('assignments/' + myUid);
  const assignWatcher = assignRef.on('value', (snap) => {
    const assignment = snap.val();
    if (!assignment) return;

    console.log('[MATCH] got assignment:', JSON.stringify(assignment));

    // Stop watching
    queueRef.off('value');
    assignRef.off('value', assignWatcher);
    assignRef.remove();
    // Clean up my queue entry too
    myEntryRef.remove();

    // Join the room
    roomId = assignment.roomId;
    state.role = assignment.role;
    roomRef = db.ref('rooms/' + roomId);
    console.log('[ROOM] joined room:', roomId, 'as:', state.role);

    // Write my player data
    roomRef.child('players/' + state.role).set({
      uid: myUid, name: state.name,
      freq: state.me.freq, amp: state.me.amp, phase: state.me.phase,
      ts: Date.now()
    });

    // Listen for peer
    const peerRole = state.role === 'A' ? 'B' : 'A';
    const peerRef = roomRef.child('players/' + peerRole);
    peerRef.on('value', (pSnap) => {
      const pd = pSnap.val();
      if (pd) {
        const wasPresent = state.peer.present;
        state.peer.present = true;
        state.peer.name = pd.name || '—';
        state.peer.freq  = pd.freq  ?? 1.5;
        state.peer.amp   = pd.amp   ?? 0.5;
        state.peer.phase = pd.phase ?? 0;
        if (!wasPresent) {
          console.log('[ROOM] peer arrived:', pd.name);
          updateIntro();
          maybeStart();
        }
      } else {
        if (state.peer.present) {
          console.log('[ROOM] peer left');
          state.peer.present = false;
          state.peer.name = '—';
          if (state.screen === 'result') {
            const body = document.getElementById('result-body');
            if (body) body.innerHTML += `<br/><span style="color: var(--ink-faint); font-size: 13px;">— they have gone —</span>`;
            setTimeout(() => { if (state.screen === 'result') showScreen('intro'); }, 2600);
          } else if (state.screen === 'play') {
            state.playing = false;
            clearInterval(countdownInterval);
            cancelAnimationFrame(playRAF);
            showScreen('intro');
          }
          updateIntro();
        }
      }
    });
    peerListener = () => peerRef.off('value');

    // Listen for room status
    const statusRef = roomRef.child('status');
    statusRef.on('value', (sSnap) => {
      const st = sSnap.val();
      console.log('[ROOM] status changed:', st);
      if (st === 'encounter' && state.role === 'B') {
        roomRef.child('target').once('value', tSnap => {
          state.target = tSnap.val();
          if (state.screen === 'intro') {
            playEncounterAnimation(() => startPlay(false));
          }
        });
      }
      if (st === 'finished' && state.playing) {
        roomRef.child('result').once('value', rSnap => {
          const r = rSnap.val();
          if (r) finishPlay(r.tier, r.matchPct, false);
        });
      }
    });
    statusListener = () => statusRef.off('value');

    updateIntro();
    maybeStart();
  });
}

window.addEventListener('beforeunload', () => {
  leaveRoom();
  // Also remove from queue if still there
  if (myUid) db.ref('queue').once('value', s => {
    if (!s.exists()) return;
    s.forEach(c => {
      if (c.val() && c.val().uid === myUid) c.ref.remove();
    });
  });
});

// ============================================================
// SCREEN SWITCHING
// ============================================================
const screens = {
  login:   document.getElementById('screen-login'),
  intro:   document.getElementById('screen-intro'),
  play:    document.getElementById('screen-play'),
  result:  document.getElementById('screen-result'),
  gallery: document.getElementById('screen-gallery'),
};

function showScreen(name) {
  state.screen = name;
  Object.entries(screens).forEach(([k, el]) => { el.hidden = (k !== name); });
  document.getElementById('dev-current').textContent = name + (state.role ? ' · ' + state.role : '');
  if (name === 'gallery') renderGallery();
  if (name === 'result')  drawResultCanvas();
  if (name === 'intro')   enterIntro();
}

// ============================================================
// TUTORIAL — canvas-driven, three chapters, minimal text
// ============================================================
let tutorialPlayed = false;   // only play once per session
let tutorialRAF = null;
let tutorialStart = 0;
let tutorialChapter = 0;
const TUTORIAL_CHAPTERS = [
  { dur: 5000 },   // one wave alone
  { dur: 14000 },  // A and B changing → C responds (main gameplay concept)
  { dur: 14000 },  // hand gestures, larger/slower
];

function enterIntro() {
  if (!tutorialPlayed) {
    tutorialPlayed = true;
    document.getElementById('tutorial').hidden = false;
    document.getElementById('waiting').hidden = true;
    startTutorial();
  } else {
    document.getElementById('tutorial').hidden = true;
    document.getElementById('waiting').hidden = false;
    updateIntro();
    startWaitingSandbox();
    // Re-join matchmaking if not already in a room
    if (myUid && !roomRef) {
      joinMatchmaking();
    }
  }
}

function startTutorial() {
  tutorialChapter = 0;
  tutorialStart = performance.now();
  updateTutorialDots();
  cancelAnimationFrame(tutorialRAF);
  const loop = (t) => {
    const elapsed = t - tutorialStart;
    drawTutorialFrame(tutorialChapter, elapsed);
    if (elapsed > TUTORIAL_CHAPTERS[tutorialChapter].dur) {
      tutorialChapter++;
      if (tutorialChapter >= TUTORIAL_CHAPTERS.length) {
        endTutorial();
        return;
      }
      tutorialStart = t;
      updateTutorialDots();
    }
    tutorialRAF = requestAnimationFrame(loop);
  };
  tutorialRAF = requestAnimationFrame(loop);
}

function endTutorial() {
  cancelAnimationFrame(tutorialRAF);
  document.getElementById('tutorial').hidden = true;
  document.getElementById('waiting').hidden = false;
  updateIntro();
  startWaitingSandbox();
  // Now that tutorial is done, join the matchmaking queue
  if (myUid && !roomRef) {
    joinMatchmaking();
  }
}

function updateTutorialDots() {
  document.querySelectorAll('#tutorial-dots .dot').forEach((d, i) => {
    d.classList.toggle('active', i === tutorialChapter);
  });
}

// ============================================================
// WAITING SANDBOX — shows the user's own wave, live,
// so they can practice hand controls while waiting for a peer.
// ============================================================
let waitingRAF = null;

function startWaitingSandbox() {
  cancelAnimationFrame(waitingRAF);
  // kick off hand tracking immediately so the user can practice
  initHandTrackingOnce();
  const canvas = document.getElementById('waiting-canvas');
  const ctx = canvas.getContext('2d');

  const loop = () => {
    if (state.screen !== 'intro') return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr) {
      canvas.width  = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const w = rect.width, h = rect.height, cy = h/2;

    ctx.clearRect(0, 0, w, h);

    // grid + axis
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

    // user's own wave — coral/blue depending on assumed role (default coral)
    const amp = h * 0.28;
    ctx.strokeStyle = 'rgba(124,245,196,0.9)';
    ctx.shadowColor = 'rgba(124,245,196,0.6)';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const px = (i/200) * w;
      const x  = (i/200) * Math.PI * 4;
      const y  = cy - state.me.amp * amp * Math.sin(state.me.freq * x + state.me.phase);
      if (i === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    waitingRAF = requestAnimationFrame(loop);
  };
  waitingRAF = requestAnimationFrame(loop);
}

document.getElementById('tutorial-skip').addEventListener('click', endTutorial);

function drawTutorialFrame(chapter, elapsed) {
  const canvas = document.getElementById('tutorial-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width * dpr) {
    canvas.width  = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const w = rect.width, h = rect.height, cy = h/2;

  ctx.clearRect(0,0,w,h);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  for (let x=0;x<w;x+=30){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y=0;y<h;y+=30){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(w,cy); ctx.stroke();

  if (chapter === 0) drawChapter0(ctx, w, h, elapsed);
  else if (chapter === 1) drawChapter1(ctx, w, h, elapsed);
  else drawChapter2(ctx, w, h, elapsed);
}

// --- Chapter 0: one wave alone, fading in, lonely ---
function drawChapter0(ctx, w, h, t) {
  const cy = h / 2;
  const amp = h * 0.14;
  const T = TUTORIAL_CHAPTERS[0].dur;
  const fadeIn  = Math.min(1, t / 1200);
  const fadeOut = Math.max(0, 1 - (t - (T - 800)) / 800);
  const alpha = fadeIn * fadeOut;

  ctx.strokeStyle = `rgba(232,124,124,${alpha * 0.9})`;
  ctx.shadowColor = `rgba(232,124,124,${alpha * 0.6})`;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const px = (i/200) * w;
    const x  = (i/200) * Math.PI * 4;
    const y  = cy - amp * Math.sin(1.5 * x + t * 0.002);
    if (i === 0) ctx.moveTo(px,y); else ctx.lineTo(px,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// --- Chapter 1: A and B change, C (their sum) responds — the core mechanic ---
function drawChapter1(ctx, w, h, t) {
  const T = TUTORIAL_CHAPTERS[1].dur;

  // Layout: upper third = wave A (coral), middle third = wave C = A+B (teal),
  //         lower third = wave B (blue)
  const yA = h * 0.22;
  const yC = h * 0.55;
  const yB = h * 0.82;
  const smallAmp = h * 0.08;
  const bigAmp   = h * 0.14;

  // ---- animated parameters: we script a sequence of changes ----
  // Timeline within this chapter (in ms):
  //  0    - 2000 : fade in A alone (top), B = 0
  //  2000 - 4000 : fade in B (bottom), C now shows nonzero sum
  //  4000 - 7000 : A's FREQUENCY slowly increases — C changes shape visibly
  //  7000 - 9500 : A's AMPLITUDE slowly decreases then increases — C wiggles
  //  9500 - 12000: B's FREQUENCY slowly decreases — C changes shape differently
  // 12000 - end  : gentle fade while holding final state
  let aFreq, aAmp, aPhase, bFreq, bAmp, bPhase;
  let alphaA = 0, alphaB = 0, alphaC = 0;

  // base values
  aFreq = 1.2; aAmp = 0.7; aPhase = 0;
  bFreq = 2.2; bAmp = 0.7; bPhase = Math.PI * 0.5;

  const ease = (p) => p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;

  if (t < 2000) {
    alphaA = Math.min(1, t / 600);
    alphaB = 0;
    alphaC = 0; // C does not exist until B exists
  } else if (t < 4000) {
    alphaA = 1;
    alphaB = Math.min(1, (t - 2000) / 600);
    alphaC = alphaB; // C emerges in sync with B
  } else if (t < 7000) {
    const p = ease((t - 4000) / 3000);
    aFreq = 1.2 + p * 2.0;    // 1.2 → 3.2 (noticeable change)
    alphaA = 1; alphaB = 1; alphaC = 1;
  } else if (t < 9500) {
    const p = (t - 7000) / 2500;
    aFreq = 3.2;
    aAmp = 0.7 * (1 - Math.abs(Math.sin(p * Math.PI))); // 0.7 → 0 → 0.7
    alphaA = 1; alphaB = 1; alphaC = 1;
  } else if (t < 12000) {
    const p = ease((t - 9500) / 2500);
    aFreq = 3.2; aAmp = 0.7;
    bFreq = 2.2 - p * 1.2;   // 2.2 → 1.0
    alphaA = 1; alphaB = 1; alphaC = 1;
  } else {
    aFreq = 3.2; aAmp = 0.7;
    bFreq = 1.0;
    alphaA = 1; alphaB = 1; alphaC = 1;
    const fade = Math.max(0, 1 - (t - (T - 600)) / 600);
    alphaA *= fade; alphaB *= fade; alphaC *= fade;
  }

  // wave A at yA
  drawWaveLine(ctx, w, yA, smallAmp, alphaA, 232, 124, 124, 2,
    (x) => aAmp * Math.sin(aFreq * x + aPhase + t * 0.0015));

  // wave B at yB
  drawWaveLine(ctx, w, yB, smallAmp, alphaB, 124, 180, 232, 2,
    (x) => bAmp * Math.sin(bFreq * x + bPhase + t * 0.0015));

  // wave C (sum) at yC — bigger and bright
  drawWaveLine(ctx, w, yC, bigAmp, alphaC, 124, 245, 196, 2.5,
    (x) =>
      aAmp * Math.sin(aFreq * x + aPhase + t * 0.0015) +
      bAmp * Math.sin(bFreq * x + bPhase + t * 0.0015));

  // horizontal separators (very faint)
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath(); ctx.moveTo(0, (yA + yC) / 2); ctx.lineTo(w, (yA + yC) / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, (yC + yB) / 2); ctx.lineTo(w, (yC + yB) / 2); ctx.stroke();

  // labels: just "A", "B", "C" letters on the left — no words
  const alphaText = Math.min(alphaA, alphaC, alphaB) * 0.55;
  if (alphaText > 0) {
    ctx.font = 'italic 22px "Cormorant Garamond", serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(232,124,124,${alphaA * 0.6})`;
    ctx.fillText('A', 14, yA + 6);
    ctx.fillStyle = `rgba(124,180,232,${alphaB * 0.6})`;
    ctx.fillText('B', 14, yB + 6);
    ctx.fillStyle = `rgba(124,245,196,${alphaC * 0.7})`;
    ctx.fillText('A + B', 14, yC + 6);
  }
}

function drawWaveLine(ctx, w, yCenter, amp, alpha, r, g, b, lineW, fn) {
  if (alpha <= 0) return;
  ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.7})`;
  ctx.shadowBlur = 10;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  for (let i = 0; i <= 220; i++) {
    const px = (i/220) * w;
    const x  = (i/220) * Math.PI * 4;
    const y  = yCenter - amp * fn(x);
    if (i === 0) ctx.moveTo(px,y); else ctx.lineTo(px,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// --- Chapter 2: hand gesture demo — TWO hands, big, slow, obvious ---
function drawChapter2(ctx, w, h, t) {
  const T = TUTORIAL_CHAPTERS[2].dur;

  // Layout: left panel is divided into left-hand area + right-hand area.
  // Right panel shows the resulting wave.
  const panelX = w * 0.08;
  const panelW = w * 0.46;
  const panelY = h * 0.12;
  const panelH = h * 0.76;
  const leftHandBoxX  = panelX + panelW * 0.02;
  const leftHandBoxW  = panelW * 0.32;
  const rightHandBoxX = panelX + panelW * 0.38;
  const rightHandBoxW = panelW * 0.60;

  // Timeline (total 14s):
  //   0    -   600 : fade in (both hands at neutral)
  //   600  -  5100 : RIGHT hand sweeps horizontally (freq)
  //  5100 -  5600 : pause
  //  5600 - 10100 : RIGHT hand sweeps vertically (amp)
  // 10100 - 10600 : pause
  // 10600 - T-400 : LEFT hand sweeps vertically (phase)
  // T-400 - T     : fade out

  let rightX = 0.5, rightY = 0.5;  // 0..1 within right-hand box
  let leftY  = 0.5;                 // 0..1 within left-hand box
  let hlRightH = 0, hlRightV = 0, hlLeftV = 0;

  const fadeIn  = Math.min(1, t / 600);
  const fadeOut = Math.max(0, 1 - Math.max(0, t - (T - 400)) / 400);
  const globalAlpha = fadeIn * fadeOut;

  if (t < 600) {
    // neutral pose
  } else if (t < 5100) {
    const p = (t - 600) / 4500;
    rightX = 0.5 - 0.4 * Math.sin(p * Math.PI * 2); // 0.5 → 0.1 → 0.5 → 0.9 → 0.5
    rightY = 0.5;
    leftY  = 0.5;
    hlRightH = Math.sin(p * Math.PI);
  } else if (t < 5600) {
    rightX = 0.5; rightY = 0.5; leftY = 0.5; // pause
  } else if (t < 10100) {
    const p = (t - 5600) / 4500;
    rightX = 0.5;
    rightY = 0.5 - 0.4 * Math.sin(p * Math.PI * 2);
    leftY  = 0.5;
    hlRightV = Math.sin(p * Math.PI);
  } else if (t < 10600) {
    rightX = 0.5; rightY = 0.5; leftY = 0.5;
  } else {
    const p = (t - 10600) / (T - 11000);
    rightX = 0.5; rightY = 0.5;
    leftY  = 0.5 - 0.4 * Math.sin(p * Math.PI * 2);
    hlLeftV = Math.sin(Math.min(1, p) * Math.PI);
  }

  // compute demo wave params from poses
  const freqDemo  = 0.8 + rightX * 3.5;
  const ampDemo   = 0.2 + (1 - rightY) * 0.8;
  const phaseDemo = leftY * Math.PI * 2;

  ctx.globalAlpha = globalAlpha;

  // ---- outer panel frame ----
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.strokeRect(panelX, panelY, panelW, panelH);
  // divider between the two hand sub-boxes
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  const dividerX = panelX + panelW * 0.36;
  ctx.moveTo(dividerX, panelY + 8);
  ctx.lineTo(dividerX, panelY + panelH - 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- left-hand position (inside leftHandBox) ----
  const leftHandCx = leftHandBoxX + leftHandBoxW * 0.5;
  const leftHandCy = panelY + panelH * (0.12 + leftY * 0.76);

  // ---- right-hand position (inside rightHandBox) ----
  const rightHandCx = rightHandBoxX + rightHandBoxW * (0.12 + rightX * 0.76);
  const rightHandCy = panelY + panelH * (0.12 + rightY * 0.76);

  // Highlights: axis guide lines while the relevant hand is moving
  if (hlRightH > 0.05) {
    ctx.strokeStyle = `rgba(124,245,196,${0.15 + 0.3 * hlRightH})`;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rightHandBoxX + 4, rightHandCy);
    ctx.lineTo(rightHandBoxX + rightHandBoxW - 4, rightHandCy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (hlRightV > 0.05) {
    ctx.strokeStyle = `rgba(124,245,196,${0.15 + 0.3 * hlRightV})`;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rightHandCx, panelY + 4);
    ctx.lineTo(rightHandCx, panelY + panelH - 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (hlLeftV > 0.05) {
    ctx.strokeStyle = `rgba(245,193,108,${0.15 + 0.3 * hlLeftV})`;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftHandCx, panelY + 4);
    ctx.lineTo(leftHandCx, panelY + panelH - 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw left hand (amber — matches phase color channel)
  drawHand(ctx, leftHandCx, leftHandCy, 1, '#f5c16c');
  // Draw right hand (teal — matches freq/amp channel)
  drawHand(ctx, rightHandCx, rightHandCy, 1, '#7cf5c4');

  // ---- right panel: resulting wave ----
  const waveX = w * 0.58;
  const waveW = w * 0.36;
  ctx.save();
  ctx.beginPath();
  ctx.rect(waveX, panelY, waveW, panelH);
  ctx.clip();

  ctx.strokeStyle = `rgba(124,245,196,${0.9 * globalAlpha})`;
  ctx.shadowColor = `rgba(124,245,196,${0.7 * globalAlpha})`;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const waveAmp = h * 0.22;
  const cy = h / 2;
  for (let i = 0; i <= 220; i++) {
    const px = waveX + (i/220) * waveW;
    const x  = (i/220) * Math.PI * 4;
    const y  = cy - ampDemo * waveAmp * Math.sin(freqDemo * x + phaseDemo + t * 0.002);
    if (i === 0) ctx.moveTo(px,y); else ctx.lineTo(px,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // faint frame for wave panel
  ctx.strokeStyle = `rgba(255,255,255,${0.05 * globalAlpha})`;
  ctx.strokeRect(waveX, panelY, waveW, panelH);

  ctx.globalAlpha = 1;
}

function drawHand(ctx, cx, cy, openness, color) {
  // openness: 0 = fist, 1 = open palm
  // Realistic-looking hand: oval palm + 4 fingers of varying lengths + thumb offset to side.
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha *= 0.92;

  // ---- PALM: rounded rectangle/oval, taller than wide ----
  const palmW = 34;
  const palmH = 42;
  const palmTop = cy - 4;        // top edge of palm (where fingers come out)
  const palmBottom = cy + palmH - 4;
  // use roundRect-style path (manually, so it works everywhere)
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(cx - palmW/2 + r, palmTop);
  ctx.lineTo(cx + palmW/2 - r, palmTop);
  ctx.quadraticCurveTo(cx + palmW/2, palmTop, cx + palmW/2, palmTop + r);
  ctx.lineTo(cx + palmW/2, palmBottom - r);
  ctx.quadraticCurveTo(cx + palmW/2, palmBottom, cx + palmW/2 - r, palmBottom);
  ctx.lineTo(cx - palmW/2 + r, palmBottom);
  ctx.quadraticCurveTo(cx - palmW/2, palmBottom, cx - palmW/2, palmBottom - r);
  ctx.lineTo(cx - palmW/2, palmTop + r);
  ctx.quadraticCurveTo(cx - palmW/2, palmTop, cx - palmW/2 + r, palmTop);
  ctx.closePath();
  ctx.fill();

  // ---- 4 FINGERS (index, middle, ring, pinky) — different lengths ----
  // thickness tapers slightly, lengths follow hand proportions:
  // middle longest, then index ≈ ring, pinky shortest
  const fingerBaseY = palmTop + 2;
  const fingerThickness = 8;
  ctx.lineWidth = fingerThickness;

  // fist: fingers curl back, so length is short and they appear inside palm
  // open: fingers extend upward to full length
  const fingers = [
    { xOff: -11, maxLen: 32 },   // index
    { xOff:  -4, maxLen: 38 },   // middle (longest)
    { xOff:   4, maxLen: 34 },   // ring
    { xOff:  11, maxLen: 26 },   // pinky
  ];
  fingers.forEach(f => {
    const len = 6 + openness * (f.maxLen - 6);
    const x0 = cx + f.xOff;
    const y0 = fingerBaseY;
    const y1 = fingerBaseY - len;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.stroke();
    // fingertip cap
    ctx.beginPath();
    ctx.arc(x0, y1, fingerThickness / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // ---- THUMB — offset to the left side, shorter, angled ----
  const thumbLen = 8 + openness * 18;
  const thumbAngle = -Math.PI * 0.7 + (1 - openness) * 0.4; // slightly curls in on fist
  const thumbBaseX = cx - palmW/2 + 4;
  const thumbBaseY = palmTop + 14;
  const thumbTipX = thumbBaseX + Math.cos(thumbAngle) * thumbLen;
  const thumbTipY = thumbBaseY + Math.sin(thumbAngle) * thumbLen;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(thumbBaseX, thumbBaseY);
  ctx.lineTo(thumbTipX, thumbTipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(thumbTipX, thumbTipY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ============================================================
// LOGIN — Firebase Auth
// ============================================================
const authError = document.getElementById('auth-error');

function showAuthError(msg) {
  authError.textContent = msg;
  setTimeout(() => { authError.textContent = ''; }, 5000);
}

let authHandled = false;

function onAuthSuccess(user) {
  if (authHandled) return;
  authHandled = true;
  myUid = user.uid;
  state.name = user.displayName || user.email?.split('@')[0] || 'anonymous';
  showScreen('intro');
}

// Google sign-in
document.getElementById('google-login').addEventListener('click', async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    onAuthSuccess(result.user);
  } catch (err) {
    showAuthError(err.message);
  }
});

// Email sign-in
document.getElementById('email-login').addEventListener('click', async () => {
  const email = document.getElementById('email-input').value.trim();
  const pass  = document.getElementById('password-input').value;
  if (!email || !pass) { showAuthError('enter email and password'); return; }
  try {
    const result = await auth.signInWithEmailAndPassword(email, pass);
    onAuthSuccess(result.user);
  } catch (err) {
    showAuthError(err.message);
  }
});

// Email sign-up
document.getElementById('email-signup').addEventListener('click', async () => {
  const email = document.getElementById('email-input').value.trim();
  const pass  = document.getElementById('password-input').value;
  if (!email || !pass) { showAuthError('enter email and password'); return; }
  if (pass.length < 6)  { showAuthError('password must be at least 6 characters'); return; }
  try {
    const result = await auth.createUserWithEmailAndPassword(email, pass);
    onAuthSuccess(result.user);
  } catch (err) {
    showAuthError(err.message);
  }
});

// No auto-login — always start at the login screen.
// Sign out any stale session so the experience begins fresh.
auth.signOut().catch(() => {});

function announcePresence() {
  // No-op in Firebase version — matchmaking handles presence
}

// ============================================================
// INTRO
// ============================================================
function updateIntro() {
  const count = state.peer.present ? 2 : 1;
  document.getElementById('intro-count').textContent = count;
  document.getElementById('intro-plural').textContent = count === 1 ? '' : 's';
  if (count === 2) {
    document.getElementById('intro-title').textContent = 'a wave has arrived';
    document.getElementById('intro-body').innerHTML = '';
  } else {
    document.getElementById('intro-title').textContent = 'waiting for another wave';
    document.getElementById('intro-body').innerHTML = `a wave cannot meet itself.`;
  }
}

function maybeStart() {
  // Start only when both are present AND we are on intro screen AND we are role A (deterministic)
  if (!state.peer.present) return;
  if (state.screen !== 'intro') return;
  if (state.role !== 'A') return;

  setTimeout(() => {
    if (!state.peer.present || state.screen !== 'intro') return;
    // role A generates the target and broadcasts
    state.target = randomTarget();
    send('start', { target: state.target });
    playEncounterAnimation(() => startPlay(true));
  }, 1200);
}

// ============================================================
// ENCOUNTER ANIMATION
// Plays on the waiting-sandbox canvas when the second user arrives.
// Your wave stays; their wave drifts in from offscreen, approaches yours,
// and once they meet, we fade into the play screen.
// Timed to feel like YOU drew them in — not a system match.
// ============================================================
let encounterRAF = null;
const ENCOUNTER_DURATION = 3400; // ms

function playEncounterAnimation(onComplete) {
  cancelAnimationFrame(waitingRAF);
  cancelAnimationFrame(encounterRAF);

  const canvas = document.getElementById('waiting-canvas');
  const ctx = canvas.getContext('2d');
  const startTime = performance.now();

  // update the count ring to 2 so viewer senses change
  document.getElementById('intro-count').textContent = '2';
  document.getElementById('intro-plural').textContent = 's';
  document.getElementById('intro-title').textContent = 'a signal — someone is here';
  document.getElementById('intro-body').innerHTML = `<em>hold your wave steady.</em>`;

  // snapshot the user's current wave so it feels like it persists
  const myWaveSnapshot = { ...state.me };
  const peerSnapshot = state.peer.present ? { ...state.peer } : { freq: 2, amp: 0.5, phase: Math.PI * 0.4 };

  // Audio: play the encounter signal tone
  playEncounterTone();

  const loop = (now) => {
    const elapsed = now - startTime;
    if (elapsed >= ENCOUNTER_DURATION) {
      cancelAnimationFrame(encounterRAF);
      onComplete();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr) {
      canvas.width  = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const w = rect.width, h = rect.height, cy = h/2;
    const amp = h * 0.24;

    // progress 0..1
    const p = elapsed / ENCOUNTER_DURATION;
    // three phases:
    // 0   - 0.35 : peer wave flickers in from the right edge (partial segments)
    // 0.35 - 0.75: peer wave becomes full, slides/grows into the frame
    // 0.75 - 1  : both waves glow brighter, screen begins to fade (handled by next screen)

    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

    // --- my wave (always fully visible) ---
    ctx.strokeStyle = 'rgba(124,245,196,0.9)';
    ctx.shadowColor = 'rgba(124,245,196,0.6)';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= 220; i++) {
      const px = (i/220) * w;
      const x  = (i/220) * Math.PI * 4;
      const y  = cy - myWaveSnapshot.amp * amp * Math.sin(myWaveSnapshot.freq * x + myWaveSnapshot.phase + now * 0.002);
      if (i === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // --- peer wave — entering from the right edge ---
    // coverage: how far into the canvas from the right the peer wave has arrived
    // starts 0, reaches 1 at p=0.75, then holds
    const coverage = Math.min(1, p / 0.75);

    // segment visibility: in the first 35% we show flickering dashes
    const flicker = p < 0.35 ? (0.4 + 0.6 * Math.sin(elapsed * 0.025 + 1)) : 1;

    ctx.strokeStyle = `rgba(245,193,108,${0.45 + 0.45 * coverage * flicker})`;
    ctx.shadowColor = `rgba(245,193,108,${0.5 * coverage * flicker})`;
    ctx.shadowBlur = 10 * coverage * flicker;
    ctx.lineWidth = 1.8;
    if (p < 0.35) ctx.setLineDash([6, 10]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    // the peer wave only draws from (1 - coverage) * w to w
    const startIdx = Math.floor(220 * (1 - coverage));
    let started = false;
    for (let i = startIdx; i <= 220; i++) {
      const px = (i/220) * w;
      const x  = (i/220) * Math.PI * 4;
      const y  = cy - peerSnapshot.amp * amp * Math.sin(peerSnapshot.freq * x + peerSnapshot.phase + now * 0.002) * 0.7;
      if (!started) { ctx.moveTo(px, y); started = true; }
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // --- leading edge indicator: a soft glow at the front of the peer wave ---
    if (coverage < 1) {
      const edgeX = (1 - coverage) * w;
      const g = ctx.createRadialGradient(edgeX, cy, 0, edgeX, cy, h * 0.35);
      g.addColorStop(0, `rgba(245,193,108,${0.25 * flicker})`);
      g.addColorStop(1, 'rgba(245,193,108,0)');
      ctx.fillStyle = g;
      ctx.fillRect(edgeX - h * 0.4, 0, h * 0.8, h);
    }

    // --- "signal strength" ticks in the corners, suggesting a handshake ---
    if (p > 0.5) {
      const ticksAlpha = Math.min(1, (p - 0.5) / 0.3);
      ctx.fillStyle = `rgba(124,245,196,${0.5 * ticksAlpha})`;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('· · · · signal locked', 14, 20);
    }

    // --- final fade to black before jumping to play ---
    if (p > 0.9) {
      const fadeA = (p - 0.9) / 0.1;
      ctx.fillStyle = `rgba(10,14,16,${fadeA * 0.7})`;
      ctx.fillRect(0, 0, w, h);
    }

    encounterRAF = requestAnimationFrame(loop);
  };
  encounterRAF = requestAnimationFrame(loop);
}

function randomTarget() {
  // target composite = waveA + waveB with random params
  // Kept within the same ranges the user can reach (FREQ_MIN..MAX, AMP_MIN..MAX)
  // so every target is achievable.
  const rand = (a, b) => a + Math.random() * (b - a);
  return {
    aFreq:  +rand(1.0, 3.0).toFixed(2),
    aAmp:   +rand(0.35, 0.8).toFixed(2),
    aPhase: +rand(0, Math.PI * 2).toFixed(2),
    bFreq:  +rand(1.0, 3.0).toFixed(2),
    bAmp:   +rand(0.35, 0.8).toFixed(2),
    bPhase: +rand(0, Math.PI * 2).toFixed(2),
  };
}

// ============================================================
// PLAY
// ============================================================
let playRAF = null;
let countdownInterval = null;

function startPlay(isInitiator) {
  state.playing = true;
  state.timeLeft = PLAY_DURATION;
  state.aiHelper = null;
  // reset my wave to a neutral start
  state.me = { freq: 1.5, amp: 0.5, phase: 0 };

  // role badge
  document.getElementById('role-badge').textContent = state.role;
  document.getElementById('role-name').textContent = state.name;

  showScreen('play');
  resizeWaveCanvas();
  startWaveLoop();

  // Audio: start BGM drone and wave sonification
  startBGM();
  startWaveSound();

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    state.timeLeft -= 1;
    document.getElementById('countdown').textContent = state.timeLeft;
    if (state.timeLeft <= 0) {
      clearInterval(countdownInterval);
      finalizeResult();
    }
  }, 1000);

  // initialize MediaPipe hand tracking the first time
  initHandTrackingOnce();
}

function finalizeResult() {
  const pct = computeMatch();
  let tier;
  if (pct >= 0.65) {
    tier = 'IN_PHASE';
  } else if (pct >= 0.40) {
    tier = 'INTERFERENCE';
  } else {
    tier = 'OUT_OF_PHASE';
  }
  finishPlay(tier, pct, true);
}

function finishPlay(tier, pct, isInitiator) {
  state.playing = false;
  clearInterval(countdownInterval);
  cancelAnimationFrame(playRAF);

  // Audio: stop wave sound, play result chime
  stopWaveSound();
  stopBGM();
  playResultChime(tier);

  if (isInitiator) {
    send('finish', { tier, matchPct: pct });
  }

  // save to gallery
  saveToGallery({
    tier,
    matchPct: pct,
    target: state.target,
    waveA: state.role === 'A' ? { ...state.me } : { ...state.peer },
    waveB: state.role === 'B' ? { ...state.me } : { ...state.peer },
    nameA: state.role === 'A' ? state.name : state.peer.name,
    nameB: state.role === 'B' ? state.name : state.peer.name,
    usedAi: !!state.aiHelper,
    ts: Date.now(),
  });

  // update result UI
  const tierEl = document.getElementById('result-tier');
  const tierLabels = {
    IN_PHASE:     'in phase',
    INTERFERENCE: 'interference',
    OUT_OF_PHASE: 'out of phase',
  };
  tierEl.textContent = tierLabels[tier];
  tierEl.setAttribute('data-tier', tier);

  const titles = {
    IN_PHASE:     'in phase',
    INTERFERENCE: 'interference',
    OUT_OF_PHASE: 'out of phase',
  };
  const bodies = {
    IN_PHASE:     `your waves aligned. for a moment, you moved as one.`,
    INTERFERENCE: `your waves met and made something neither could alone.`,
    OUT_OF_PHASE: `your waves passed through each other. yet every meeting leaves a trace.`,
  };
  document.getElementById('result-title').textContent = titles[tier];
  document.getElementById('result-body').innerHTML = bodies[tier];

  showScreen('result');
}

function computeMatch() {
  // Two-factor scoring:
  //   1. RMS error (absolute closeness) — soft curved
  //   2. Pearson correlation (shape similarity) — rewards "parallel but offset" waves
  // Final score blends both, so you get credit for matching the shape even if
  // amplitude or vertical offset is off.
  if (!state.target) return 0;
  let diffSq = 0, targetSq = 0;
  let sumC = 0, sumT = 0, sumCT = 0, sumCC = 0, sumTT = 0;
  const extraWaves = state.aiHelper ? [state.aiHelper] : [];
  const N = SAMPLE_POINTS;
  for (let i = 0; i < N; i++) {
    const x = (i / N) * X_RANGE;
    let combined =
      state.me.amp   * Math.sin(state.me.freq   * x + state.me.phase) +
      state.peer.amp * Math.sin(state.peer.freq * x + state.peer.phase);
    for (const w of extraWaves) combined += w.amp * Math.sin(w.freq * x + w.phase);
    const target =
      state.target.aAmp * Math.sin(state.target.aFreq * x + state.target.aPhase) +
      state.target.bAmp * Math.sin(state.target.bFreq * x + state.target.bPhase);
    diffSq   += (combined - target) ** 2;
    targetSq += target * target;
    sumC  += combined;
    sumT  += target;
    sumCT += combined * target;
    sumCC += combined * combined;
    sumTT += target * target;
  }

  // Factor 1: RMS-based (absolute closeness)
  const rmsDiff   = Math.sqrt(diffSq / N);
  const rmsTarget = Math.sqrt(targetSq / N) || 1e-6;
  const relErr    = rmsDiff / rmsTarget;
  const rmsScore  = 1 / (1 + Math.pow(relErr, 1.5));

  // Factor 2: Pearson correlation (shape similarity, ignores amplitude scaling + offset)
  // r = 1 means identical shape, 0 means uncorrelated, -1 means inverted
  const num   = N * sumCT - sumC * sumT;
  const denA  = Math.sqrt(N * sumCC - sumC * sumC);
  const denB  = Math.sqrt(N * sumTT - sumT * sumT);
  const denom = denA * denB || 1e-6;
  const corr  = num / denom; // -1 to 1
  // map correlation to 0..1 score: -1→0, 0→0.3, 1→1
  const corrScore = Math.max(0, (corr + 1) / 2);

  // Blend: 40% absolute closeness + 60% shape similarity
  // This way "parallel but shifted" (corr~1 but rms~medium) scores ~70%+
  const pct = 0.4 * rmsScore + 0.6 * corrScore;
  return Math.min(1, Math.max(0, pct));
}

function waveDivergence(w1, w2) {
  // simple parameter distance
  const df = Math.abs(w1.freq - w2.freq) / (FREQ_MAX - FREQ_MIN);
  const da = Math.abs(w1.amp  - w2.amp)  / (AMP_MAX  - AMP_MIN);
  const dp = Math.abs(((w1.phase - w2.phase) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.PI;
  return (df + da + dp) / 3;
}

// ============================================================
// WAVE RENDER LOOP
// ============================================================
const waveCanvas = document.getElementById('wave-canvas');
const wctx = waveCanvas.getContext('2d');

function resizeWaveCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = waveCanvas.getBoundingClientRect();
  waveCanvas.width  = rect.width * dpr;
  waveCanvas.height = rect.height * dpr;
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => {
  if (state.screen === 'play') resizeWaveCanvas();
});

let lastSend = 0;
function startWaveLoop() {
  cancelAnimationFrame(playRAF);
  const loop = (t) => {
    if (state.screen !== 'play') return;
    drawWaveCanvas();
    // send my wave ~20Hz
    if (t - lastSend > 50) {
      send('wave', { ...state.me });
      lastSend = t;
    }
    // update match percentage
    const pct = computeMatch();
    state.matchPct = pct;
    document.getElementById('match-value').textContent = Math.round(pct * 100) + '%';
    // update readout
    document.getElementById('p-freq').textContent  = state.me.freq.toFixed(2);
    document.getElementById('p-amp').textContent   = state.me.amp.toFixed(2);
    document.getElementById('p-phase').textContent = state.me.phase.toFixed(2);

    // update audio: wave pitch/volume follows hand, filter opens with match%
    updateWaveSound();

    playRAF = requestAnimationFrame(loop);
  };
  playRAF = requestAnimationFrame(loop);
}

function drawWaveCanvas() {
  const w = waveCanvas.clientWidth;
  const h = waveCanvas.clientHeight;
  wctx.clearRect(0, 0, w, h);

  // grid
  wctx.strokeStyle = 'rgba(255,255,255,0.03)';
  wctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < w; x += gridSize) {
    wctx.beginPath(); wctx.moveTo(x, 0); wctx.lineTo(x, h); wctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    wctx.beginPath(); wctx.moveTo(0, y); wctx.lineTo(w, y); wctx.stroke();
  }

  // axis
  wctx.strokeStyle = 'rgba(255,255,255,0.08)';
  wctx.beginPath(); wctx.moveTo(0, h/2); wctx.lineTo(w, h/2); wctx.stroke();

  const amplitudeScale = h * 0.18; // leaves room for 2-wave sum

  // target wave (dashed amber)
  wctx.strokeStyle = 'rgba(245,193,108,0.55)';
  wctx.lineWidth = 1.5;
  wctx.setLineDash([4, 4]);
  wctx.shadowColor = 'rgba(245,193,108,0.5)';
  wctx.shadowBlur = 8;
  drawWave(w, h, amplitudeScale, (x) => {
    if (!state.target) return 0;
    return (
      state.target.aAmp * Math.sin(state.target.aFreq * x + state.target.aPhase) +
      state.target.bAmp * Math.sin(state.target.bFreq * x + state.target.bPhase)
    );
  });
  wctx.setLineDash([]);

  // combined wave — brightness/width scales with match quality ("hot/cold" feedback)
  const q = state.matchPct; // 0..1
  const baseA = 0.35 + 0.65 * q;
  const lineW = 1.2 + 1.8 * q;
  const blur  = 4 + 18 * q;
  wctx.strokeStyle = `rgba(124,245,196,${baseA})`;
  wctx.lineWidth = lineW;
  wctx.shadowColor = `rgba(124,245,196,${0.4 + 0.6 * q})`;
  wctx.shadowBlur = blur;
  drawWave(w, h, amplitudeScale, (x) => {
    let v = state.me.amp * Math.sin(state.me.freq * x + state.me.phase);
    if (state.peer.present) v += state.peer.amp * Math.sin(state.peer.freq * x + state.peer.phase);
    if (state.aiHelper)     v += state.aiHelper.amp * Math.sin(state.aiHelper.freq * x + state.aiHelper.phase);
    return v;
  });
  wctx.shadowBlur = 0;

  // ghost: your individual wave (faint coral or blue depending on role)
  const myColor = state.role === 'A' ? 'rgba(232,124,124,0.4)' : 'rgba(124,180,232,0.4)';
  wctx.strokeStyle = myColor;
  wctx.lineWidth = 1;
  drawWave(w, h, amplitudeScale, (x) =>
    state.me.amp * Math.sin(state.me.freq * x + state.me.phase)
  );
}

function drawWave(w, h, ampScale, fn) {
  wctx.beginPath();
  const cy = h / 2;
  for (let i = 0; i <= SAMPLE_POINTS; i++) {
    const px = (i / SAMPLE_POINTS) * w;
    const x  = (i / SAMPLE_POINTS) * X_RANGE;
    const y  = cy - fn(x) * ampScale;
    if (i === 0) wctx.moveTo(px, y);
    else wctx.lineTo(px, y);
  }
  wctx.stroke();
}

// ============================================================
// AI HELPER BUTTON
// ============================================================
// ============================================================
// RESULT CANVAS — target + A + B overlaid
// ============================================================
function drawResultCanvas() {
  const c = document.getElementById('result-canvas');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width  = rect.width * dpr;
  c.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const ampScale = h * 0.18;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const waveA = state.role === 'A' ? state.me : state.peer;
  const waveB = state.role === 'B' ? state.me : state.peer;

  const drawOn = (ctxRef, color, glow, lineWidth, fn) => {
    ctxRef.strokeStyle = color;
    ctxRef.lineWidth = lineWidth;
    ctxRef.shadowColor = glow;
    ctxRef.shadowBlur = 8;
    ctxRef.beginPath();
    for (let i = 0; i <= SAMPLE_POINTS; i++) {
      const px = (i / SAMPLE_POINTS) * w;
      const x  = (i / SAMPLE_POINTS) * X_RANGE;
      const y  = cy - fn(x) * ampScale;
      if (i === 0) ctxRef.moveTo(px, y);
      else ctxRef.lineTo(px, y);
    }
    ctxRef.stroke();
    ctxRef.shadowBlur = 0;
  };

  // target (dashed amber, subtle)
  ctx.setLineDash([4,4]);
  drawOn(ctx, 'rgba(245,193,108,0.4)', 'rgba(245,193,108,0.2)', 1, (x) =>
    state.target.aAmp * Math.sin(state.target.aFreq * x + state.target.aPhase) +
    state.target.bAmp * Math.sin(state.target.bFreq * x + state.target.bPhase)
  );
  ctx.setLineDash([]);
  // wave A (faint)
  drawOn(ctx, 'rgba(232,124,124,0.45)', 'rgba(232,124,124,0.2)', 1, (x) =>
    waveA.amp * Math.sin(waveA.freq * x + waveA.phase)
  );
  // wave B (faint)
  drawOn(ctx, 'rgba(124,180,232,0.45)', 'rgba(124,180,232,0.2)', 1, (x) =>
    waveB.amp * Math.sin(waveB.freq * x + waveB.phase)
  );
  // COMBINED wave A+B — the main event, bright and thick
  drawOn(ctx, 'rgba(124,245,196,1)', 'rgba(124,245,196,0.9)', 2.5, (x) =>
    waveA.amp * Math.sin(waveA.freq * x + waveA.phase) +
    waveB.amp * Math.sin(waveB.freq * x + waveB.phase)
  );
}

// ============================================================
// GALLERY
// ============================================================
const GALLERY_KEY = 'resonance-gallery';

function saveToGallery(entry) {
  // Save to localStorage as cache
  const list = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]');
  list.unshift(entry);
  localStorage.setItem(GALLERY_KEY, JSON.stringify(list.slice(0, 120)));
  // Also save to Firebase so all users can see it
  db.ref('gallery').push(entry);
}

let galleryFilter = 'all';

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = `<div class="gallery-empty">loading...</div>`;
  // Load from Firebase — no orderBy to avoid index issues
  db.ref('gallery').limitToLast(80).once('value', (snap) => {
    let list = [];
    if (snap.exists()) {
      snap.forEach(child => list.push(child.val()));
      list.reverse(); // newest first
    }
    // Also merge any localStorage entries that might not be in Firebase
    const local = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]');
    if (list.length === 0) list = local;
    renderGalleryItems(grid, list);
  }).catch((err) => {
    console.warn('[GALLERY] Firebase load failed, using localStorage:', err);
    const list = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]');
    renderGalleryItems(grid, list);
  });
}

function renderGalleryItems(grid, list) {
  const filtered = galleryFilter === 'all' ? list : list.filter(e => e.tier === galleryFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="gallery-empty">no meetings yet. go make one.</div>`;
    return;
  }

  grid.innerHTML = '';
  const tierLabel = { IN_PHASE: 'in phase', INTERFERENCE: 'interference', OUT_OF_PHASE: 'out of phase' };
  filtered.forEach((entry, idx) => {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    const label = tierLabel[entry.tier] || entry.tier;
    card.innerHTML = `
      <div class="card-canvas-wrap"><canvas></canvas></div>
      <div class="card-meta">
        <span class="card-tier" data-tier="${entry.tier}">${label}${entry.usedAi ? ' · ai' : ''}</span>
        <span class="card-match">${Math.round(entry.matchPct * 100)}%</span>
      </div>
      <div class="card-names">${escapeHtml(entry.nameA)} &times; ${escapeHtml(entry.nameB)}</div>
    `;
    grid.appendChild(card);
    const canvas = card.querySelector('canvas');
    drawCardCanvas(canvas, entry);
  });
}

function drawCardCanvas(canvas, entry) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, cy = h/2, ampScale = h * 0.18;

  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let x=0;x<w;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for (let y=0;y<h;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}

  const paint = (color, glow, lw, fn, dashed=false) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.shadowColor = glow; ctx.shadowBlur = 6;
    if (dashed) ctx.setLineDash([3,3]); else ctx.setLineDash([]);
    ctx.beginPath();
    for (let i=0;i<=SAMPLE_POINTS;i++){
      const px = (i/SAMPLE_POINTS)*w;
      const x  = (i/SAMPLE_POINTS)*X_RANGE;
      const y  = cy - fn(x)*ampScale;
      if (i===0) ctx.moveTo(px,y); else ctx.lineTo(px,y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  };

  const t = entry.target, A = entry.waveA, B = entry.waveB;
  // target (faint dashed)
  paint('rgba(245,193,108,0.35)','rgba(245,193,108,0.2)',1, x =>
    t.aAmp*Math.sin(t.aFreq*x+t.aPhase)+t.bAmp*Math.sin(t.bFreq*x+t.bPhase), true);
  // individual waves (very faint)
  paint('rgba(232,124,124,0.35)','rgba(232,124,124,0.15)',0.8, x =>
    A.amp*Math.sin(A.freq*x+A.phase));
  paint('rgba(124,180,232,0.35)','rgba(124,180,232,0.15)',0.8, x =>
    B.amp*Math.sin(B.freq*x+B.phase));
  // COMBINED A+B — the main line, bright
  paint('rgba(124,245,196,1)','rgba(124,245,196,0.8)',2, x =>
    A.amp*Math.sin(A.freq*x+A.phase) + B.amp*Math.sin(B.freq*x+B.phase));
}

document.querySelectorAll('.gallery-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.gallery-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    galleryFilter = tab.dataset.tier;
    renderGallery();
  });
});

document.getElementById('to-gallery-btn').addEventListener('click', () => {
  // Just view the gallery — don't leave the room yet
  showScreen('gallery');
});
document.getElementById('meet-new-btn').addEventListener('click', () => {
  leaveRoom();
  joinMatchmaking();
  showScreen('intro');
});
document.getElementById('back-to-play-btn').addEventListener('click', () => {
  // From gallery, go back to find someone new
  leaveRoom();
  joinMatchmaking();
  showScreen('intro');
});

// ============================================================
// MEDIAPIPE HAND TRACKING
// ============================================================
// ============================================================
// HAND TRACKING (MediaPipe) — two hands
//   Right hand (viewer's right): x = frequency, y = amplitude
//   Left  hand (viewer's left) : y = phase
// Fallback: mouse x/y = freq/amp, arrow keys (or mouse button hold) = phase
// ============================================================
let handTrackingInit = false;
let inputMode = 'idle'; // 'hands' | 'mouse' | 'idle'

// Smoothing for stable values
const smooth = (prev, next, k = 0.25) => prev + (next - prev) * k;

async function initHandTrackingOnce() {
  if (handTrackingInit) return;
  handTrackingInit = true;

  const video = document.getElementById('video');
  const handCanvas = document.getElementById('hand-canvas');
  const hctx = handCanvas.getContext('2d');

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
      handCanvas.width = video.videoWidth || 320;
      handCanvas.height = video.videoHeight || 240;
      hctx.clearRect(0, 0, handCanvas.width, handCanvas.height);

      // Also draw on the waiting-screen hand canvas if it exists
      const waitingHC = document.getElementById('waiting-hand-canvas');
      const whctx = waitingHC ? waitingHC.getContext('2d') : null;
      if (whctx) {
        waitingHC.width = handCanvas.width;
        waitingHC.height = handCanvas.height;
        whctx.clearRect(0, 0, waitingHC.width, waitingHC.height);
      }

      // Draw the dividing line on both canvases.
      // Because CSS does scaleX(-1), we must draw text counter-flipped.
      const drawOnBoth = (fn) => {
        fn(hctx, handCanvas);
        if (whctx) fn(whctx, waitingHC);
      };

      drawOnBoth((ctx, cvs) => {
        // divider line
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cvs.width / 2, 0);
        ctx.lineTo(cvs.width / 2, cvs.height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels — counter-flip so they read correctly in mirrored video
        ctx.save();
        ctx.translate(cvs.width, 0);
        ctx.scale(-1, 1);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(245,193,108,0.55)';
        ctx.fillText('PHASE', cvs.width * 0.25, 14);
        ctx.fillStyle = 'rgba(124,245,196,0.55)';
        ctx.fillText('FREQ / AMP', cvs.width * 0.75, 14);
        ctx.restore();
      });

      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

      let rightHand = null, leftHand = null;
      results.multiHandLandmarks.forEach((lm) => {
        if (!lm || !lm[9]) return; // skip incomplete detections
        const palmX = lm[9].x;
        if (palmX < 0.5) {
          if (!rightHand || lm[9].x < rightHand[9].x) rightHand = lm;
        } else {
          if (!leftHand || lm[9].x > leftHand[9].x) leftHand = lm;
        }
      });

      inputMode = 'hands';

      const drawSkeleton = (ctx, cvs, lm, color) => {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        const wrist = lm[0];
        [4, 8, 12, 16, 20].forEach(tip => {
          ctx.beginPath();
          ctx.moveTo(wrist.x * cvs.width, wrist.y * cvs.height);
          ctx.lineTo(lm[tip].x * cvs.width, lm[tip].y * cvs.height);
          ctx.stroke();
        });
        lm.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x * cvs.width, p.y * cvs.height, 1.8, 0, Math.PI * 2);
          ctx.fill();
        });
      };

      drawOnBoth((ctx, cvs) => {
        if (rightHand) drawSkeleton(ctx, cvs, rightHand, 'rgba(124,245,196,0.9)');
        if (leftHand)  drawSkeleton(ctx, cvs, leftHand,  'rgba(245,193,108,0.9)');
      });

      // ---- Map RIGHT hand (viewer's right) to freq + amp ----
      // Because palmX < 0.5 means viewer's right, we remap within that half
      // so moving from the divider outward = increasing freq.
      if (rightHand) {
        const cx = rightHand[9].x; // in 0..0.5
        const cy = rightHand[9].y;
        // cx=0.5 (at divider) → freq LOW; cx=0 (far right of preview) → freq HIGH
        const normX = 1 - (cx / 0.5);       // 0 at divider, 1 at edge
        const freqTarget = FREQ_MIN + normX * (FREQ_MAX - FREQ_MIN);
        const ampTarget  = AMP_MIN  + (1 - cy) * (AMP_MAX  - AMP_MIN);
        state.me.freq = smooth(state.me.freq, freqTarget);
        state.me.amp  = smooth(state.me.amp,  ampTarget);
      }

      // ---- Map LEFT hand (viewer's left) vertical pos to phase ----
      if (leftHand) {
        const cy = leftHand[9].y;
        const phaseTarget = cy * Math.PI * 2;
        let dp = phaseTarget - state.me.phase;
        while (dp >  Math.PI) dp -= Math.PI * 2;
        while (dp < -Math.PI) dp += Math.PI * 2;
        state.me.phase = (state.me.phase + dp * 0.25 + Math.PI * 4) % (Math.PI * 2);
      }
    });

    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    await video.play();

    // Share the same camera stream with the waiting-screen video element
    const waitingVideo = document.getElementById('waiting-video');
    if (waitingVideo) {
      waitingVideo.srcObject = video.srcObject;
      waitingVideo.play().catch(() => {});
    }

    const camera = new Camera(video, {
      onFrame: async () => {
        // run on intro (sandbox) AND play — so the user can practice while waiting
        if (state.screen === 'play' || state.screen === 'intro') {
          await hands.send({ image: video });
        }
      },
      width: 320,
      height: 240,
    });
    camera.start();
  } catch (err) {
    console.warn('Hand tracking unavailable — falling back to mouse control:', err);
    enableMouseFallback();
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function enableMouseFallback() {
  inputMode = 'mouse';
  // Bind globally so it works on waiting sandbox and play.
  window.addEventListener('mousemove', (e) => {
    if (state.screen !== 'play' && state.screen !== 'intro') return;
    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;
    state.me.freq = FREQ_MIN + nx * (FREQ_MAX - FREQ_MIN);
    state.me.amp  = AMP_MIN + (1 - ny) * (AMP_MAX - AMP_MIN);
  });
  // phase controlled by arrow keys
  window.addEventListener('keydown', (e) => {
    if (state.screen !== 'play' && state.screen !== 'intro') return;
    if (e.key === 'ArrowLeft')  state.me.phase = (state.me.phase - 0.2 + Math.PI * 2) % (Math.PI * 2);
    if (e.key === 'ArrowRight') state.me.phase = (state.me.phase + 0.2) % (Math.PI * 2);
  });
}

// ============================================================
// DEV PANEL
// ============================================================
document.querySelectorAll('#dev-panel .dev-btn[data-screen]').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.screen;
    if (s === 'play') {
      if (!state.role) state.role = 'A';
      state.peer = { present: true, name: 'testpeer', freq: 2, amp: 0.5, phase: Math.PI/3 };
      state.target = state.target || randomTarget();
      startPlay(true);
    } else if (s === 'result') {
      if (!state.target) state.target = randomTarget();
      if (!state.peer.present) state.peer = { present: true, name: 'testpeer', freq: 2, amp: 0.5, phase: 0 };
      const pct = computeMatch();
      const tier = pct >= 0.65 ? 'IN_PHASE' : (pct >= 0.40 ? 'INTERFERENCE' : 'OUT_OF_PHASE');
      finishPlay(tier, pct, false);
    } else {
      showScreen(s);
      if (s === 'intro') updateIntro();
    }
  });
});

document.getElementById('dev-reset').addEventListener('click', () => {
  if (confirm('Clear gallery and reset?')) {
    localStorage.removeItem(GALLERY_KEY);
    leaveRoom();
    authHandled = false;
    auth.signOut();
    location.reload();
  }
});

// ============================================================
// UTIL
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ============================================================
// BOOT
// ============================================================
showScreen('login');

// ============================================================
// AUDIO — Web Audio API
//   - Ambient BGM: warm pad drone that's always-on during play
//   - Wave sonification: your wave params map to a soft oscillator
//   - Chorus effect: slight detuned copies for that shimmer
//   - Match feedback: the closer you are to the target, the more
//     consonant the sound becomes (dissonance → consonance)
// ============================================================
let audioCtx = null;
let audioStarted = false;

// nodes
let bgmGain, bgmOsc1, bgmOsc2, bgmOsc3;
let waveOscGain, waveOsc, waveOscDetune1, waveOscDetune2;
let matchFilter;

function initAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // ---- MASTER output ----
  const master = audioCtx.createGain();
  master.gain.value = 0.3;
  master.connect(audioCtx.destination);

  // ---- BGM: warm ambient pad (three detuned sine/triangle oscillators) ----
  bgmGain = audioCtx.createGain();
  bgmGain.gain.value = 0;
  bgmGain.connect(master);

  // reverb-like effect using a delay + feedback
  const delay = audioCtx.createDelay(1);
  delay.delayTime.value = 0.4;
  const feedback = audioCtx.createGain();
  feedback.gain.value = 0.3;
  const delayFilter = audioCtx.createBiquadFilter();
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 1200;
  bgmGain.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(master);

  // Pad oscillators — very low, warm
  bgmOsc1 = audioCtx.createOscillator();
  bgmOsc1.type = 'sine';
  bgmOsc1.frequency.value = 55; // A1
  bgmOsc1.connect(bgmGain);
  bgmOsc1.start();

  bgmOsc2 = audioCtx.createOscillator();
  bgmOsc2.type = 'triangle';
  bgmOsc2.frequency.value = 82.4; // E2
  const bgm2gain = audioCtx.createGain();
  bgm2gain.gain.value = 0.5;
  bgmOsc2.connect(bgm2gain);
  bgm2gain.connect(bgmGain);
  bgmOsc2.start();

  bgmOsc3 = audioCtx.createOscillator();
  bgmOsc3.type = 'sine';
  bgmOsc3.frequency.value = 110; // A2
  const bgm3gain = audioCtx.createGain();
  bgm3gain.gain.value = 0.25;
  bgmOsc3.connect(bgm3gain);
  bgm3gain.connect(bgmGain);
  bgmOsc3.start();

  // ---- WAVE SONIFICATION: oscillator that follows the user's wave params ----
  waveOscGain = audioCtx.createGain();
  waveOscGain.gain.value = 0;
  waveOscGain.connect(master);

  // chorus: three slightly detuned copies
  waveOsc = audioCtx.createOscillator();
  waveOsc.type = 'sine';
  waveOsc.frequency.value = 220;
  waveOsc.connect(waveOscGain);
  waveOsc.start();

  waveOscDetune1 = audioCtx.createOscillator();
  waveOscDetune1.type = 'sine';
  waveOscDetune1.frequency.value = 220;
  waveOscDetune1.detune.value = 18; // 18 cents sharp — wider chorus
  const d1g = audioCtx.createGain();
  d1g.gain.value = 0.4;
  waveOscDetune1.connect(d1g);
  d1g.connect(waveOscGain);
  waveOscDetune1.start();

  waveOscDetune2 = audioCtx.createOscillator();
  waveOscDetune2.type = 'sine';
  waveOscDetune2.frequency.value = 220;
  waveOscDetune2.detune.value = -18; // 18 cents flat
  const d2g = audioCtx.createGain();
  d2g.gain.value = 0.4;
  waveOscDetune2.connect(d2g);
  d2g.connect(waveOscGain);
  waveOscDetune2.start();

  // filter that opens up as match % increases (consonance)
  matchFilter = audioCtx.createBiquadFilter();
  matchFilter.type = 'lowpass';
  matchFilter.frequency.value = 400;
  matchFilter.Q.value = 2;
  waveOscGain.disconnect();
  waveOscGain.connect(matchFilter);
  matchFilter.connect(master);
}

function startBGM() {
  if (!audioCtx) initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  bgmGain.gain.setTargetAtTime(0.18, audioCtx.currentTime, 1.5);
}

function stopBGM() {
  if (!bgmGain) return;
  bgmGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.8);
}

function startWaveSound() {
  if (!audioCtx) return;
  waveOscGain.gain.setTargetAtTime(0.22, audioCtx.currentTime, 0.3);
}

function stopWaveSound() {
  if (!waveOscGain) return;
  waveOscGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.4);
}

// Quantize a frequency to the nearest note in a pentatonic scale
// for that "climbing scale" feel instead of smooth glide
const SCALE_FREQS = [
  130.81, 146.83, 164.81, 196.00, 220.00,  // C3 D3 E3 G3 A3
  261.63, 293.66, 329.63, 392.00, 440.00,  // C4 D4 E4 G4 A4
  523.25, 587.33, 659.26                    // C5 D5 E5
];

function quantizeToScale(freq) {
  let closest = SCALE_FREQS[0];
  let minDist = Math.abs(freq - closest);
  for (let i = 1; i < SCALE_FREQS.length; i++) {
    const d = Math.abs(freq - SCALE_FREQS[i]);
    if (d < minDist) { minDist = d; closest = SCALE_FREQS[i]; }
  }
  return closest;
}

let lastQuantizedFreq = 0;

function updateWaveSound() {
  if (!audioCtx || !waveOsc) return;
  // Map wave freq param (0.8-3.5) to audio frequency range
  const rawFreq = 130 + (state.me.freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN) * 530;
  // Snap to pentatonic scale — discrete steps, no glide
  const audioFreq = quantizeToScale(rawFreq);
  const now = audioCtx.currentTime;

  // Only update if we've moved to a different note (avoids constant scheduling)
  if (audioFreq !== lastQuantizedFreq) {
    lastQuantizedFreq = audioFreq;
    waveOsc.frequency.setValueAtTime(audioFreq, now);
    waveOscDetune1.frequency.setValueAtTime(audioFreq, now);
    waveOscDetune2.frequency.setValueAtTime(audioFreq, now);
  }

  // Volume scales with amplitude param — louder overall
  const vol = 0.08 + state.me.amp * 0.2;
  waveOscGain.gain.setTargetAtTime(vol, now, 0.05);

  // Filter opens with match percentage (consonance feedback)
  if (matchFilter) {
    const filterFreq = 400 + state.matchPct * 4000;
    matchFilter.frequency.setTargetAtTime(filterFreq, now, 0.1);
  }
}

// Play a brief success/fail chime
function playResultChime(tier) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.connect(g);
  g.connect(audioCtx.destination);
  g.gain.value = 0.15;

  if (tier === 'IN_PHASE' || tier === 'INTERFERENCE') {
    // rising major chord arpeggio
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.setValueAtTime(277, now + 0.15);
    osc.frequency.setValueAtTime(330, now + 0.3);
    osc.frequency.setValueAtTime(440, now + 0.45);
    g.gain.setTargetAtTime(0, now + 0.6, 0.2);
    osc.start(now);
    osc.stop(now + 1);
  } else {
    // gentle descending tone
    osc.type = 'sine';
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.setTargetAtTime(220, now, 0.4);
    g.gain.setTargetAtTime(0, now + 0.5, 0.3);
    osc.start(now);
    osc.stop(now + 1);
  }
}

// Play a soft "signal" tone when encounter animation starts
function playEncounterTone() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 440;
  osc.connect(g);
  g.connect(audioCtx.destination);
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.08, now, 0.3);
  g.gain.setTargetAtTime(0, now + 2.5, 0.4);
  osc.start(now);
  osc.stop(now + 3.5);
}

// Ensure audio starts on first user interaction (required by browsers)
document.addEventListener('click', () => {
  if (!audioStarted) initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { once: false });
