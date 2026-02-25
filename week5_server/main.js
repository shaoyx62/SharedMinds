import { initializeApp } from
"https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  onValue
} from
"https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";

/* ---------------- FIREBASE ---------------- */
let userName = prompt("Your name?");
if (!userName || userName.trim() === "") {
  userName = "anonymous";
}

const firebaseConfig = {
  apiKey: "AIzaSyCDiqN2YBLvo-OId0avSakGCEjlaZjWrC0",
  authDomain: "week5-server.firebaseapp.com",
  projectId: "week5-server",
  storageBucket: "week5-server.firebasestorage.app",
  messagingSenderId: "930220057354",
  appId: "1:930220057354:web:7205c19228fe5d945d10f3"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const worldRef = ref(db,"sharedWorld/worldState");

/* ---------------- CANVAS ---------------- */

const canvas = document.getElementById("worldCanvas");
const ctx = canvas.getContext("2d");

resize();
window.addEventListener("resize", resize);

function resize(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

/* ---------------- WORLD STATE ---------------- */

let currentImage = null;
let promptHistory = [];

/* ---------------- DRAW ---------------- */

function draw(){
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if(currentImage){
    const imgRatio = currentImage.width / currentImage.height;
    const canvasRatio = canvas.width / canvas.height;

    let drawWidth, drawHeight, offsetX, offsetY;

    if(imgRatio < canvasRatio){
      drawWidth = canvas.width;
      drawHeight = canvas.width / imgRatio;
      offsetX = 0;
      offsetY = (canvas.height - drawHeight) / 2;
    } else {
      drawHeight = canvas.height;
      drawWidth = canvas.height * imgRatio;
      offsetX = (canvas.width - drawWidth) / 2;
      offsetY = 0;
    }

    ctx.drawImage(currentImage, offsetX, offsetY, drawWidth, drawHeight);
  }
}

/* ---------------- LISTEN TO WORLD ---------------- */

onValue(worldRef,(snapshot)=>{

  const data = snapshot.val();
  if(!data) return;

  promptHistory = data.promptHistory || [];

  const img = new Image();
  img.crossOrigin="anonymous";
  img.src = data.imageURL;

  img.onload = ()=>{
    currentImage = img;
    draw();
  };
});

/* ---------------- INPUT ---------------- */

const input = document.getElementById("inputBox");

input.addEventListener("keydown", async (e) => {
  if(e.key !== "Enter") return;
  const word = input.value.trim();
  if(!word) return;

  input.value = "Generating...";
  input.disabled = true;

  await evolveWorld(word);

  input.disabled = false;
  input.value = "";
  input.focus();
});

/* ---------------- AI WORLD EVOLUTION ---------------- */

async function evolveWorld(newWord){

  const replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
  const authToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImY1MzMwMzNhMTMzYWQyM2EyYzlhZGNmYzE4YzRlM2E3MWFmYWY2MjkiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzEzNDYyMjIsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MTU1MTcxMCwiZXhwIjoxNzcxNTU1MzEwLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.az9bomnrWMZJs2-0IdX5918ChtqCsV0lCKX8ZnvGKteta8Cgd5rd_6qfkcOXpO9EXLJFtO4Td4nyxvsME-ZuwyvzmRgNIznca7P1TKj6ASeR6rt08y5s2-DiswXnFYwTRvci5CX690UlxZExAzimwivfuPfG4eyuZUAhj4I6bQ7VC-EWkcWuABEqmBNAfqzrwC6ltYT-WBiaVy8nmuFcK4whpqQ5ZeQkebFIcyasgKDnPxj093AXiMDn3ZQZt7srAqCawpKtP7dYOITmf4eq0UXzctY3nMVoxkdsM_ZHME7NKK0m_5z27sgtUMHklUQ73rP1jRwaEGSO4Cloz7IGvQ";

  const newHistory = [...promptHistory, newWord];

  const recentHistory = newHistory.slice(-5);
  const combinedPrompt = recentHistory.join(", ");

  console.log("Generating with prompt:", combinedPrompt);

  try {
    const res = await fetch(replicateProxy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`
      },
      body: JSON.stringify({
        model: "google/imagen-4-fast",
        input: { prompt: combinedPrompt }
      })
    });

    if(!res.ok){
      const errText = await res.text();
      console.error("API error:", res.status, errText);
      input.value = `Error ${res.status} - try again`;
      return;
    }

    const json = await res.json();

    if(!json.output){
      console.error("No output from API:", json);
      input.value = "No image returned - try again";
      return;
    }

    set(worldRef, {
      imageURL: json.output,
      promptHistory: newHistory
    });

  } catch(err) {
    console.error("Fetch failed:", err);
    input.value = "Network error - try again";
  }
}