//credit: Dan https://github.com/dano1234/SharedMindsS26/tree/main/Week%2001%20%20Vanilla%20Javascript
const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");
const inputBox = document.getElementById("inputBox");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const radius = 30;
let focusMode = false;
let currentFocus = null;

// mouse
let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
window.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});

class Thought {
  //invisible thoughts moving around randomly
  constructor(text, type = "self", parent = null, depth = 0) {
    this.text = text;
    this.type = type;
    this.parent = parent;
    this.depth = depth;
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    const angle = Math.random() * Math.PI * 2;  //get random angle on unit circle
    const speed = 0.2 + Math.random() * 0.4;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.baseClarity = 0.2;
    this.clarity = this.baseClarity;
    this.fadeTarget = this.baseClarity;
    this.frozen = false;
    this.selected = false;
  }

  update() {
    //if not frozen, updatate postion to move
    if (!this.frozen) {
      this.x += this.vx;
      this.y += this.vy;
    }

    const fontSize = 12 + this.clarity * 10;  //font size based on clarity
    ctx.font = `${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(this.text).width;
    //bounce off edges
    const margin = 8;
    if (this.x < margin){
      this.x = margin;
      this.vx *= -1;
    }
    if (this.x + textWidth > canvas.width - margin){
      this.x = canvas.width - margin - textWidth;
      this.vx *= -1;
    }
    if (this.y - fontSize < margin){
      this.y = margin + fontSize;
      this.vy *= -1;
    }
    if (this.y > canvas.height - margin){
      this.y = canvas.height - margin;
      this.vy *= -1;
    }

    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // determine desired fade target based on attention and focus
    // determine fade target
    if (this.frozen) {
      this.fadeTarget = 1;
    } else if (!focusMode && dist < radius) {
      this.fadeTarget = 1;
    } else if (!focusMode) {
      this.fadeTarget = this.baseClarity;
    }

    // smooth clarity
    const fadeSpeed = 0.08;
    this.clarity += (this.fadeTarget - this.clarity) * fadeSpeed;
    this.clarity = Math.max(0, Math.min(1, this.clarity));
  }

  //credit ai agent: draw thoughts onto canvas
  draw() {
    if (this.clarity <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = this.clarity;
    ctx.font = `${12 + this.clarity * 10}px sans-serif`;
    ctx.fillStyle = this.type === "ai" ? "#333" : "#000";
    ctx.fillText(this.text, this.x, this.y);
    // selected highlight
    if (this.selected) {
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeText(this.text, this.x, this.y);
    }
    ctx.restore();
  }
}

let thoughts = [
  "10:00 am meeting",
  "portfolio",
  "blog post idea",
  "water pipe leak",
  "grocery",
  "friend coming over",
  "dinner",
  "boring",
  "Saturday laundry",
  "nervous",
  "cold",
  "call mom"
].map(t => new Thought(t)); //credit ai agent: how to initialize new thoughts

//event for press enter to add thought
inputBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && inputBox.value.trim()) {
    const t = new Thought(inputBox.value.trim());
    t.fadeTarget = 1;
    thoughts.push(t);
    inputBox.value = "";
  }
});

//credit ai: find if there is any thought under xy coordinates
function getThoughtAt(x, y) {
  for (let i = thoughts.length - 1; i >= 0; i--) {
    const t = thoughts[i];
    const fontSize = 12 + t.clarity * 10;
    ctx.font = `${fontSize}px sans-serif`;
    const w = ctx.measureText(t.text).width;
    if (
      x >= t.x - 4 &&
      x <= t.x + w + 4 &&
      y >= t.y - fontSize &&
      y <= t.y + 4
    ) return t;
  }
  return null;
}

//event for hover to change cursor
canvas.addEventListener('mousemove', e => {
  // mouse is already tracked globally; ensure we check hover
  const rect = canvas.getBoundingClientRect();
  const hit = getThoughtAt(e.clientX - rect.left, e.clientY - rect.top);
  canvas.style.cursor = hit ? 'pointer' : 'default';
});

//event for click to freeze/unfreeze thought
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const hit = getThoughtAt(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;

  // if clicking on current focus, exit focus
  if (hit === currentFocus) {
    exitFocus();
  } else {
    enterFocus(hit);
  }
});

function enterFocus(thought) {
  focusMode = true;
  currentFocus = thought;

  thoughts.forEach(t => {
    t.selected = false;

    if (t === thought) {
      t.selected = true;
      t.frozen = true;
      t.fadeTarget = 1;
    } else {
      t.frozen = false;
      t.fadeTarget = 0;
    }
  });

  askAI(thought);
}

function exitFocus() {
  focusMode = false;
  currentFocus = null;

  thoughts = thoughts.filter(t => {
    // remove ai-generated thoughts when exiting focus
    return t.type !== "ai";
  });

  thoughts.forEach(t => {
    t.selected = false;
    t.frozen = false;
    t.fadeTarget = t.baseClarity; // reset to base clarity
  });
}

function selectThought(thought) {
  focusMode = true;

  thoughts.forEach(t => {
    t.selected = false;
    if (t !== thought) {
      t.fadeTarget = 0;
    }
  });

  thought.selected = true;
  thought.fadeTarget = 1;
  thought.frozen = true;

  askAI(thought);
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  thoughts.forEach(t => {
    t.update();
    t.draw();
  });

  //mouse attention circle
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, radius, 0, Math.PI * 2);
  // ctx.strokeStyle = "rgb(0,0,0)";
  // ctx.lineWidth = 1;
  // ctx.stroke();

  // keep thoughts in the array even if they're faint so mouse hover can revive them
  // thoughts = thoughts.filter(t => t.clarity > 0.02 || t.selected);

  requestAnimationFrame(animate);
}

animate();

async function askAI(thought) {
  const url = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
  let authToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImY3NThlNTYzYzBiNjRhNzVmN2UzZGFlNDk0ZDM5NTk1YzE0MGVmOTMiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzAxNTIzNDMsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MDE1MjM0MywiZXhwIjoxNzcwMTU1OTQzLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.Ftupi-emO3k6ii3CWwVvdjs0kb3Xy_K5NNIWo8kYotiMlbqn1TmF9K7vC2VCD85Xnf8AqpUCr983HgrRswbOxqKeuK2Cwr4WQHlaodauQtZVdVvvaDeGBKZ8H8-op0VUkV34g6utL75qp8JcHmg6oiyQMcIa_WeXjPLp9FO_43HwSirLJ-8aEH-hcpwKttDYUNej1lNCEy11_fnEl04_AmaTEYNNA0qcinWHLU-uwzgbkKmnoEACkDN9l5zaxTt6t1GuC05ckybXl8xfP_uM1D-UM3tuR-dogVuzpgE4WmjbU99oXM9ay5hqdrSvl1VwBzL3VFdzAaD1vXqhuZ4pCQ";

  const prompt =
    "You are continuing an internal train of thought. Given the thought:" + thought.text +
    ", write 5 short next thoughts that might realistically follow or phrases that help express the related emotion. Avoid synonyms, explanations, or poetic language. Return only a JSON array of short phrases.";

  const data = {
    model: "openai/gpt-5",
    input: { prompt }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(data),
  });

  const json = await res.json();
  const list = JSON.parse(json.output.join(""));
  const count = list.length;
  const baseRadius = 70;
  const layerSpacing = 60;
  const r = baseRadius + thought.depth * layerSpacing;

  list.forEach((word, i) => {
    const angle = (i / count) * Math.PI * 2;
    const t = new Thought(
      word,
      "ai",
      thought,
      thought.depth + 1
    );
    t.x = thought.x + r * Math.cos(angle);
    t.y = thought.y + r * Math.sin(angle);
    t.frozen = true;
    t.fadeTarget = 1;

    thoughts.push(t);
  });
}

