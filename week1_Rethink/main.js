//credit: Dan https://github.com/dano1234/SharedMindsS26/tree/main/Week%2001%20%20Vanilla%20Javascript
const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");
const inputBox = document.getElementById("inputBox");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const radius = 30;

// mouse
let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
window.addEventListener("mousemove", e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

class Thought {
  //invisible thoughts moving around randomly
  constructor(text) {
    this.text = text;
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    const angle = Math.random() * Math.PI * 2;  //get random angle on unit circle
    const speed = 0.2 + Math.random() * 0.4;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.baseClarity = 0;
    this.clarity = this.baseClarity;
    this.frozen = false;
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
    //if thought is within attention circle, increase clarity
    if (dist < radius && !this.frozen) {
      this.clarity = 1;
    } else if (!this.frozen) {
      //slowly return to base clarity(0)
      this.clarity -= 0.01;
    }
    // frozen thoughts stay visible
    if (this.frozen) this.clarity = 1;
    this.clarity = Math.max(0, Math.min(1, this.clarity));
  }

  //credit ai agent: draw thoughts onto canvas
  draw() {
    ctx.save();
    ctx.globalAlpha = this.clarity;
    ctx.font = `${12 + this.clarity * 10}px sans-serif`;
    ctx.fillText(this.text, this.x, this.y);
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
  "winter storm",
  "call mom"
].map(t => new Thought(t)); //credit ai agent: how to initialize new thoughts

//event for press enter to add thought
inputBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && inputBox.value.trim()) {
    thoughts.push(new Thought(inputBox.value.trim()));
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
    const left = t.x;
    const right = t.x + w;
    const top = t.y - fontSize;
    const bottom = t.y;
    if (x >= left - 4 && x <= right + 4 && y >= top - 2 && y <= bottom + 4) return t;
  }
  return null;
}

//event for hover to change cursor
canvas.addEventListener('mousemove', e => {
  // mouse is already tracked globally; ensure we check hover
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = getThoughtAt(x, y);
  canvas.style.cursor = hit ? 'pointer' : 'default';
});

//event for click to freeze/unfreeze thought
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = getThoughtAt(x, y);
  if (hit) {
    hit.frozen = !hit.frozen;
    if (hit.frozen) {
      hit.clarity = 1;
    }
  }
});

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

  requestAnimationFrame(animate);
}

animate();