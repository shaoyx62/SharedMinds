// credit: https://github.com/dano1234/SharedMindsF25/tree/master/Week%2002%20ML%20APIs/ClientExamples/10%20Text%20Embeddings%20Clustered
let words = JSON.parse(localStorage.getItem("social_words")) || [];
let embeddings = JSON.parse(localStorage.getItem("social_embeds")) || [];
let isUserNode = JSON.parse(localStorage.getItem("social_is_user")) || [];

let umap;
let umapReady = false;
let nEpochs = 400;
let iterations = 1001;
const clusterSize = 3;

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ctx = canvas.getContext("2d");

const inputField = document.getElementById("memoryInput");
const godBtn = document.getElementById("godBtn");
const clearBtn = document.getElementById("clearBtn");

function saveToLocal() {
  localStorage.setItem("social_words", JSON.stringify(words));
  localStorage.setItem("social_embeds", JSON.stringify(embeddings));
  localStorage.setItem("social_is_user", JSON.stringify(isUserNode));
}

function initUMAP() {
  if (embeddings.length < 2) return;

  let currentNeighbors = Math.min(clusterSize, embeddings.length - 1);
  
  umap = new UMAP({
    nNeighbors: currentNeighbors,
    nComponents: 2,
    metric: 'cosine',
    minDist: 0.1,
    nEpochs: nEpochs,
    init: 'spectral'
  });

  umap.initializeFit(embeddings);
  iterations = 0;
  umapReady = true;
}

function animate() {
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (umapReady && iterations < nEpochs) {
    iterations = umap.step();
  }

  if (umap && words.length > 0) {
    let results = umap.getEmbedding();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    results.forEach(p => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });

    for (let i = 0; i < results.length; i++) {
      let x = (results[i][0] - minX) / (maxX - minX || 1) * (canvas.width - 250) + 125;
      let y = (results[i][1] - minY) / (maxY - minY || 1) * (canvas.height - 200) + 100;

      if (isUserNode[i] === true) {
        ctx.fillStyle = "#00f2ff"; 
        ctx.font = "bold 16px Arial";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#00f2ff";
        
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillText("【YOU】" + words[i], x + 12, y);
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)"; 
        ctx.font = "12px Arial";
        ctx.fillText(words[i], x, y);
      }
    }
  }
  requestAnimationFrame(animate);
}

async function askForEmbeddings(p_prompt, fromUser = false) {
  const authToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImY1MzMwMzNhMTMzYWQyM2EyYzlhZGNmYzE4YzRlM2E3MWFmYWY2MjkiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzEzNDYyMjIsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MTM0NjIyMiwiZXhwIjoxNzcxMzQ5ODIyLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.sp7YuGsbzmlOvvMPr3WUpx7bfP3bkM4qIQLD_95bzmgZKaOEYtk6pf8Rj9B4bVzOqYrXpe4k0fMmC4oe7Yap_4U1Wy9fjRcjtB3bA6XQlaBgvOo0m__-JfPPGvdArflKtTNNJc7vhkMtMCjsfvEFrjQI-QGi12NuM-M4zAi_4YiZ9rWeKZG0BmD3fJuUQc_JpnJ-LdMg0XAa_uv2TWZeAEy8im8Gq1hnjk2PgH8hBhX30Uu6AYIZ4-hwXSzXXEf_sd7THoybOCTeqoaX27XN4OtaYSEsTCG3imYf151ViIXeSqtNEq35BFoJrtYqJR5L8BUeT41W5zAtsdwKzo2VBA"; 
  const url = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

  let promptArray = Array.isArray(p_prompt) ? p_prompt : [p_prompt];
  
  try {
    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        version: "beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad",
        input: { texts: JSON.stringify(promptArray) }
      })
    });

    let json = await res.json();
    let newEmbeds = json.output;
    let newTexts = JSON.parse(json.input.texts);

    newEmbeds.forEach((emb, idx) => {
      embeddings.push(emb);
      words.push(newTexts[idx]);
      isUserNode.push(fromUser);
    });

    saveToLocal();
    initUMAP();
  } catch (err) { console.error(err); }
}

async function generateAIMemories() {
  const url = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
  const authToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImY1MzMwMzNhMTMzYWQyM2EyYzlhZGNmYzE4YzRlM2E3MWFmYWY2MjkiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzEzNDYyMjIsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MTM0NjIyMiwiZXhwIjoxNzcxMzQ5ODIyLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.sp7YuGsbzmlOvvMPr3WUpx7bfP3bkM4qIQLD_95bzmgZKaOEYtk6pf8Rj9B4bVzOqYrXpe4k0fMmC4oe7Yap_4U1Wy9fjRcjtB3bA6XQlaBgvOo0m__-JfPPGvdArflKtTNNJc7vhkMtMCjsfvEFrjQI-QGi12NuM-M4zAi_4YiZ9rWeKZG0BmD3fJuUQc_JpnJ-LdMg0XAa_uv2TWZeAEy8im8Gq1hnjk2PgH8hBhX30Uu6AYIZ4-hwXSzXXEf_sd7THoybOCTeqoaX27XN4OtaYSEsTCG3imYf151ViIXeSqtNEq35BFoJrtYqJR5L8BUeT41W5zAtsdwKzo2VBA"; 
  const prompt = "Generate 8 diverse short phrases of memories or experiences. Return ONLY a JSON array of strings.";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ model: "openai/gpt-4o", input: { prompt } }),
  });

  const json = await res.json();
  let rawText = json.output.join("");
  let cleanJson = rawText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleanJson);
}

inputField.addEventListener("keydown", async e => {
  if (e.key === "Enter" && inputField.value.trim()) {
    const text = inputField.value.trim();
    inputField.value = "";
    await askForEmbeddings(text, true);
  }
});

godBtn.onclick = async () => {
  godBtn.innerText = "Populating...";
  try {
    const aiWords = await generateAIMemories();
    await askForEmbeddings(aiWords, false);
  } finally {
    godBtn.innerText = "God Button";
  }
};

clearBtn.onclick = () => {
  localStorage.clear();
  words = []; embeddings = []; isUserNode = []; umap = null; umapReady = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

if (words.length > 0) initUMAP();

animate();
