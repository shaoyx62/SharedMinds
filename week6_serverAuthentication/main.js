import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {
  getDatabase, ref, push, update, onChildAdded, onChildChanged
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import {
  getAuth, signOut, setPersistence, browserSessionPersistence,
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { UMAP } from "https://cdn.skypack.dev/umap-js";

// FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCDiqN2YBLvo-OId0avSakGCEjlaZjWrC0",
  authDomain: "week5-server.firebaseapp.com",
  databaseURL: "https://week5-server-default-rtdb.firebaseio.com",
  projectId: "week5-server",
  storageBucket: "week5-server.firebasestorage.app",
  messagingSenderId: "930220057354",
  appId: "1:930220057354:web:d5eeda958d0a67ec5d10f3"
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);
setPersistence(auth, browserSessionPersistence);

const googleProvider = new GoogleAuthProvider();
const APP_NAME = "MeteorWorld";

const EMBED_AUTH = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImY1MzMwMzNhMTMzYWQyM2EyYzlhZGNmYzE4YzRlM2E3MWFmYWY2MjkiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzEzNDYyMjIsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MTU1MTcxMCwiZXhwIjoxNzcxNTU1MzEwLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.az9bomnrWMZJs2-0IdX5918ChtqCsV0lCKX8ZnvGKteta8Cgd5rd_6qfkcOXpO9EXLJFtO4Td4nyxvsME-ZuwyvzmRgNIznca7P1TKj6ASeR6rt08y5s2-DiswXnFYwTRvci5CX690UlxZExAzimwivfuPfG4eyuZUAhj4I6bQ7VC-EWkcWuABEqmBNAfqzrwC6ltYT-WBiaVy8nmuFcK4whpqQ5ZeQkebFIcyasgKDnPxj093AXiMDn3ZQZt7srAqCawpKtP7dYOITmf4eq0UXzctY3nMVoxkdsM_ZHME7NKK0m_5z27sgtUMHklUQ73rP1jRwaEGSO4Cloz7IGvQ";
const EMBED_URL  = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

// CANVAS
const canvas = document.getElementById("worldCanvas");
const ctx    = canvas.getContext("2d");

resize();
window.addEventListener("resize", resize);
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

// STATE
let currentUser = null;
let allWishes   = {};  // key -> wish (may have .embedding)
let meteors     = [];

// UMAP result cache: key -> { x, y } (normalized 0-1)
let umapCoords  = {};
const UMAP_MIN_POINTS   = 15;   // min wishes with embeddings before UMAP is useful
const COSINE_THRESHOLD  = 0.85; // min cosine similarity to show as "similar"

// LOGIN UI
const authDiv = document.getElementById("authDiv");

function showLogin() {
  authDiv.innerHTML = "";

  const googleBtn = document.createElement("button");
  googleBtn.className = "auth-btn";
  googleBtn.innerText = "✦ Sign in with Google";
  googleBtn.onclick = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")
        signInWithRedirect(auth, googleProvider);
    }
  };
  authDiv.appendChild(googleBtn);

  const divider = document.createElement("div");
  divider.className = "auth-divider";
  divider.innerText = "— or —";
  authDiv.appendChild(divider);

  const emailInput = document.createElement("input");
  emailInput.type = "email"; emailInput.placeholder = "Email"; emailInput.className = "auth-input";
  authDiv.appendChild(emailInput);

  const passInput = document.createElement("input");
  passInput.type = "password"; passInput.placeholder = "Password"; passInput.className = "auth-input";
  authDiv.appendChild(passInput);

  const emailBtn = document.createElement("button");
  emailBtn.className = "auth-btn secondary";
  emailBtn.innerText = "Sign in / Register";
  emailBtn.onclick = async () => {
    const email = emailInput.value.trim(), pass = passInput.value;
    if (!email || !pass) return;
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch (err) {
      if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential" || err.code === "auth/invalid-login-credentials") {
        try { await createUserWithEmailAndPassword(auth, email, pass); }
        catch (e) { emailBtn.innerText = "Error — try again"; }
      } else { emailBtn.innerText = "Error — check console"; }
    }
  };
  authDiv.appendChild(emailBtn);
}

function showLogout(user) {
  authDiv.innerHTML = "";
  const name = document.createElement("div");
  name.className = "auth-name";
  name.innerText = "✦ " + (user.displayName || user.email);
  authDiv.appendChild(name);
  const btn = document.createElement("button");
  btn.className = "auth-btn"; btn.innerText = "Sign out";
  btn.onclick = () => signOut(auth);
  authDiv.appendChild(btn);
}

getRedirectResult(auth).then(r => { if (r?.user) currentUser = r.user; }).catch(() => {});

let listenersStarted = false;
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    showLogout(user);
    if (!listenersStarted) {
      listenersStarted = true;
      startFirebaseListeners();
      setTimeout(updateTimeline, 500);
    } else {
      updateTimeline();
    }
  } else {
    showLogin();
    updateTimeline();
  }
});

// SEND WISH
const input = document.getElementById("wishInput");

input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  if (!currentUser) { input.placeholder = "Please sign in first..."; return; }
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  const newRef = await push(ref(db, APP_NAME + "/wishes"), {
    text, user: currentUser.displayName || currentUser.email,
    uid: currentUser.uid, time: Date.now(), status: "pending"
  });

  // embed in background
  getEmbedding(text).then(emb => {
    if (emb) update(newRef, { embedding: emb }).then(() => scheduleUMAP());
  });
});

// EMBEDDING
async function getEmbedding(text) {
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBED_AUTH}` },
      body: JSON.stringify({
        version: "beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad",
        input: { texts: JSON.stringify([text]) }
      })
    });
    const json = await res.json();
    return json.output?.[0] ?? null;
  } catch (err) { console.error("Embedding error:", err); return null; }
}

// UMAP  (run once, synchronously, on demand)
// Debounce: wait 2s after last change before running UMAP
let umapTimer = null;
function scheduleUMAP() {
  clearTimeout(umapTimer);
  umapTimer = setTimeout(runUMAP, 2000);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function runUMAP() {
  const eligible = Object.values(allWishes).filter(w => w.embedding && w.status !== "gaveUp");

  if (eligible.length >= UMAP_MIN_POINTS) {
    // Enough data: use UMAP
    const embeddings = eligible.map(w => w.embedding);
    const nNeighbors = Math.min(10, eligible.length - 1);
    try {
      const umap = new UMAP({ nNeighbors, minDist: 0.3, nComponents: 2, spread: 1.0 });
      const fittings = umap.fit(embeddings);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      fittings.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;

      umapCoords = {};
      eligible.forEach((w, i) => {
        umapCoords[w.key] = {
          x: (fittings[i][0] - minX) / rangeX,
          y: (fittings[i][1] - minY) / rangeY
        };
      });
      console.log("UMAP ready with", eligible.length, "points");
    } catch (err) {
      console.error("UMAP error:", err);
      umapCoords = {};
    }
  } else {
    // Not enough data: clear UMAP coords so cosine fallback is used
    umapCoords = {};
    console.log("Not enough data for UMAP (" + eligible.length + "/" + UMAP_MIN_POINTS + "), using cosine similarity");
  }
  updateTimeline();
}

// Euclidean distance in UMAP 2D space
function umapDistance(keyA, keyB) {
  const a = umapCoords[keyA], b = umapCoords[keyB];
  if (!a || !b) return Infinity;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function usingUMAP() {
  return Object.keys(umapCoords).length > 0;
}

// Find top N similar wishes from OTHER users
// Uses UMAP distance if available, otherwise cosine similarity with strict threshold
function findSimilarWishes(myWish, topN = 3) {
  const others = Object.values(allWishes).filter(
    w => w.uid !== myWish.uid && w.status !== "gaveUp" && w.embedding
  );
  if (others.length === 0 || !myWish.embedding) return [];

  if (usingUMAP() && umapCoords[myWish.key]) {
    // UMAP mode: euclidean distance in 2D space, only show if close enough
    const UMAP_THRESHOLD = 0.25;
    return others
      .filter(w => umapCoords[w.key] && umapDistance(myWish.key, w.key) < UMAP_THRESHOLD)
      .map(w => ({ ...w, dist: umapDistance(myWish.key, w.key) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, topN);
  } else {
    // Cosine mode: strict threshold, only genuinely similar
    return others
      .map(w => ({ ...w, score: cosineSimilarity(myWish.embedding, w.embedding) }))
      .filter(w => w.score >= COSINE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
}

// FIREBASE LISTENERS
function startFirebaseListeners() {
  onChildAdded(ref(db, APP_NAME + "/wishes"), (snapshot) => {
    const wish = snapshot.val(); wish.key = snapshot.key;
    allWishes[snapshot.key] = wish;
    spawnMeteor(wish);
    updateTimeline();
    if (wish.embedding) scheduleUMAP();
  });

  onChildChanged(ref(db, APP_NAME + "/wishes"), (snapshot) => {
    const wish = snapshot.val(); wish.key = snapshot.key;
    allWishes[snapshot.key] = wish;

    // sync meteor text and status
    meteors.forEach(m => {
      if (m.key === snapshot.key) {
        m.text   = wish.text;    // ← keeps meteor text in sync after edits
        m.status = wish.status;
        if (wish.tribute && !m.hasTribute) { m.hasTribute = true; spawnTribute(wish); }
      }
    });

    updateTimeline();
    if (wish.embedding) scheduleUMAP();
  });
}

// METEOR SYSTEM
const STATUS_STYLE = {
  pending:   { r:255, g:255, b:255, dim:1.0 },
  fulfilled: { r:120, g:255, b:160, dim:1.0 },
  gaveUp:    { r:180, g:120, b:255, dim:0.35 }
};

function meteorColor(status, opacity) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return `rgba(${s.r},${s.g},${s.b},${opacity * s.dim})`;
}

function spawnMeteor(wish) {
  const lane = hashLane(wish.key);
  meteors.push({
    key: wish.key, text: wish.text, user: wish.user,
    status: wish.status || "pending", hasTribute: !!wish.tribute, isTribute: false,
    x: canvas.width + 200 + Math.random() * 400,
    y: 80 + lane * (canvas.height * 0.75),
    speed: 0.8 + Math.random() * 0.7, opacity: 0, fadingIn: true
  });
}

function spawnTribute(wish) {
  meteors.push({
    key: wish.key + "_tribute", text: "✨ " + wish.tribute + "  — " + wish.user,
    user: "", status: "tribute", isTribute: true,
    x: canvas.width + 100, y: 60 + Math.random() * (canvas.height * 0.6),
    speed: 2.5 + Math.random() * 1.5, opacity: 0, fadingIn: true, loops: 0
  });
}

function hashLane(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h % 100) / 100;
}

// DRAW LOOP
const stars = Array.from({ length: 160 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.4, twinkle: Math.random() * Math.PI * 2
}));

function drawStars() {
  stars.forEach(s => {
    s.twinkle += 0.02;
    const alpha = 0.3 + 0.5 * Math.abs(Math.sin(s.twinkle));
    ctx.beginPath();
    ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  });
}

function draw() {
  ctx.fillStyle = "rgba(2,4,18,0.88)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawStars();

  meteors = meteors.filter(m => !(m.isTribute && m.loops >= 3));

  meteors.forEach(m => {
    m.x -= m.speed;
    if (m.fadingIn) { m.opacity = Math.min(1, m.opacity + 0.02); if (m.opacity >= 1) m.fadingIn = false; }
    if (m.x < -800) {
      m.x = canvas.width + 100 + Math.random() * 300;
      m.y = Math.max(60, Math.min(canvas.height - 60, m.y + (Math.random() - 0.5) * 40));
      if (m.isTribute) m.loops = (m.loops || 0) + 1;
    }

    const color    = m.isTribute ? `rgba(255,220,80,${m.opacity})` : meteorColor(m.status, m.opacity);
    const trailLen = m.isTribute ? 80 : 30 + m.speed * 10;
    const grad     = ctx.createLinearGradient(m.x, m.y, m.x + trailLen, m.y);
    grad.addColorStop(0, color); grad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + trailLen, m.y);
    ctx.strokeStyle = grad; ctx.lineWidth = m.isTribute ? 2.5 : 1.5; ctx.stroke();

    ctx.beginPath(); ctx.arc(m.x, m.y, m.isTribute ? 3 : 2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();

    ctx.font = m.isTribute ? "bold 15px 'Georgia',serif" : "14px 'Georgia',serif";
    ctx.fillStyle = color;
    ctx.fillText(m.text, m.x + 14, m.y + 5);

    if (!m.isTribute) {
      ctx.font = "11px Arial";
      ctx.fillStyle = `rgba(180,180,220,${m.opacity * 0.7})`;
      ctx.fillText(m.user, m.x + 14, m.y + 20);
    }
  });

  requestAnimationFrame(draw);
}
draw();

//////////////////////////////////////////////////
// TIMELINE
//////////////////////////////////////////////////

function updateTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";

  if (!currentUser) {
    timeline.innerHTML = `<p class="timeline-hint">Sign in to see your wishes</p>`;
    return;
  }

  const myWishes = Object.values(allWishes)
    .filter(w => w.uid === currentUser.uid)
    .sort((a, b) => b.time - a.time);

  if (myWishes.length === 0) {
    timeline.innerHTML = `<p class="timeline-hint">Your wishes will appear here ✦</p>`;
    return;
  }

  myWishes.forEach(w => {
    const item = document.createElement("div");
    item.className = "wish-item " + (w.status || "pending");

    // badge
    const badge = document.createElement("span");
    badge.className = "wish-badge " + (w.status || "pending");
    badge.innerText = w.status === "fulfilled" ? "✓ fulfilled"
                    : w.status === "gaveUp"    ? "✕ gave up"  : "✦ wishing";
    item.appendChild(badge);

    // text row
    if (w.status === "pending") {
      const textWrap = document.createElement("div");
      textWrap.className = "wish-text-wrap";

      const textEl = document.createElement("div");
      textEl.className = "wish-text";
      textEl.innerText = w.text;
      textWrap.appendChild(textEl);

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn"; editBtn.title = "Edit wish"; editBtn.innerText = "✎";
      editBtn.onclick = () => openEditMode(item, textEl, editBtn, w);
      textWrap.appendChild(editBtn);
      item.appendChild(textWrap);
    } else {
      const textEl = document.createElement("div");
      textEl.className = "wish-text"; textEl.innerText = w.text;
      item.appendChild(textEl);
    }

    // date
    const dateEl = document.createElement("div");
    dateEl.className = "wish-date";
    dateEl.innerText = new Date(w.time).toLocaleDateString();
    item.appendChild(dateEl);

    // existing tribute
    if (w.tribute) {
      const tributeEl = document.createElement("div");
      tributeEl.className = "wish-tribute-display";
      tributeEl.innerText = "✨ " + w.tribute;
      item.appendChild(tributeEl);
    }

    // pending actions
    if (w.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "wish-actions";

      const fulfillBtn = document.createElement("button");
      fulfillBtn.className = "wish-btn fulfill"; fulfillBtn.innerText = "✓ Fulfilled";
      fulfillBtn.onclick = () => update(ref(db, APP_NAME + "/wishes/" + w.key), { status: "fulfilled" });

      const giveUpBtn = document.createElement("button");
      giveUpBtn.className = "wish-btn giveup"; giveUpBtn.innerText = "✕ Give Up";
      giveUpBtn.onclick = () => update(ref(db, APP_NAME + "/wishes/" + w.key), { status: "gaveUp" });

      actions.appendChild(fulfillBtn); actions.appendChild(giveUpBtn);
      item.appendChild(actions);
    }

    // tribute input
    if (w.status === "fulfilled" && !w.tribute) {
      const tributeWrap = document.createElement("div");
      tributeWrap.className = "tribute-wrap";

      const tributeInput = document.createElement("input");
      tributeInput.className = "tribute-input";
      tributeInput.placeholder = "Leave a message for others...";
      tributeWrap.appendChild(tributeInput);

      const sendBtn = document.createElement("button");
      sendBtn.className = "wish-btn tribute-send"; sendBtn.innerText = "✨ Send";
      sendBtn.onclick = () => {
        const msg = tributeInput.value.trim(); if (!msg) return;
        update(ref(db, APP_NAME + "/wishes/" + w.key), { tribute: msg });
        tributeInput.value = "";
      };
      tributeWrap.appendChild(sendBtn);
      item.appendChild(tributeWrap);
    }

    // ── UMAP similar wishes
    const similar = findSimilarWishes(w);
    if (similar.length > 0) {
      const simSection = document.createElement("div");
      simSection.className = "similar-section";

      // count total similar (UMAP or cosine depending on data size)
      const totalNearby = Object.values(allWishes).filter(x => {
        if (x.uid === w.uid || x.status === "gaveUp" || !x.embedding) return false;
        if (usingUMAP() && umapCoords[x.key] && umapCoords[w.key])
          return umapDistance(w.key, x.key) < 0.25;
        return cosineSimilarity(w.embedding, x.embedding) >= COSINE_THRESHOLD;
      }).length;

      const extra = Math.max(0, totalNearby - similar.length);

      const simTitle = document.createElement("div");
      simTitle.className = "similar-title";
      simTitle.innerText = "✦ Similar wishes" + (extra > 0 ? `  +${extra} more people` : "");
      simSection.appendChild(simTitle);

      similar.forEach(s => {
        const card = document.createElement("div");
        card.className = "similar-card";

        const sUser = document.createElement("div");
        sUser.className = "similar-user"; sUser.innerText = s.user;
        card.appendChild(sUser);

        const sText = document.createElement("div");
        sText.className = "similar-text"; sText.innerText = s.text;
        card.appendChild(sText);

        simSection.appendChild(card);
      });

      item.appendChild(simSection);
    }

    timeline.appendChild(item);
  });
}

// inline edit
function openEditMode(item, textEl, editBtn, w) {
  const orig = textEl.innerText;
  const editInput = document.createElement("input");
  editInput.className = "wish-edit-input"; editInput.value = orig;
  textEl.replaceWith(editInput); editInput.focus();
  editBtn.innerText = "✕";

  const cancel = () => {
    editInput.replaceWith(textEl);
    editBtn.innerText = "✎";
    editBtn.onclick = () => openEditMode(item, textEl, editBtn, w);
  };
  editBtn.onclick = cancel;

  editInput.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { cancel(); return; }
    if (e.key === "Enter") {
      const newText = editInput.value.trim();
      if (!newText || newText === orig) { cancel(); return; }

      textEl.innerText = newText;
      editInput.replaceWith(textEl);
      editBtn.innerText = "✎";
      editBtn.onclick = () => openEditMode(item, textEl, editBtn, w);

      await update(ref(db, APP_NAME + "/wishes/" + w.key), { text: newText });
      const emb = await getEmbedding(newText);
      if (emb) { await update(ref(db, APP_NAME + "/wishes/" + w.key), { embedding: emb }); scheduleUMAP(); }
    }
  });
}