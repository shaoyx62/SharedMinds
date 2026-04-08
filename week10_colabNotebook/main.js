const GIST_URL = 'https://gist.githubusercontent.com/shaoyx62/91d3ac46dd6f2b66db4762c92a26a8ec/raw/9d24a4d8b0371d24363d7525519d994dee769a92/CloudflareTunnelURL.txt';

async function getColabURL() {
  const res = await fetch(GIST_URL + '?t=' + Date.now());
  return (await res.text()).trim();
}

async function fetchOracle(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function consult() {
  const n1       = parseInt(document.getElementById('n1').value);
  const n2       = parseInt(document.getElementById('n2').value);
  const n3       = parseInt(document.getElementById('n3').value);
  const question = document.getElementById('question').value.trim();

  const errorEl = document.getElementById('error');
  errorEl.classList.remove('visible');

  if (!n1 || !n2 || !n3) return showError('Please enter three numbers.');
  if (!question)         return showError('Please enter your question.');

  // reset previous result
  document.getElementById('guas-section').classList.remove('visible');
  const ansEl = document.getElementById('answer-section');
  ansEl.classList.remove('visible', 'show');
  ansEl.style.display = 'none';
  [0, 1, 2].forEach(i => document.getElementById(`gua-${i}`).classList.remove('show'));

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  document.getElementById('loading').classList.add('visible');

  try {
    const url      = await getColabURL();
    console.log('Colab URL:', url);
    const endpoint = url + '/oracle';
    const data     = await fetchOracle(endpoint, { n1, n2, n3, question });

    document.getElementById('loading').classList.remove('visible');

    document.getElementById('guas-section').classList.add('visible');

    data.guas.forEach((gua, i) => {
      const match = gua.name.match(/^([\u4e00-\u9fff]+)(.+)$/);
      const zh = match ? match[1] : gua.name;
      const en = match ? match[2].trim() : '';

      document.getElementById(`sym-${i}`).textContent     = gua.symbol;
      document.getElementById(`name-zh-${i}`).textContent = zh;
      document.getElementById(`name-en-${i}`).textContent = en;

      setTimeout(() => {
        document.getElementById(`gua-${i}`).classList.add('show');
      }, i * 300);
    });

    setTimeout(() => {
      document.getElementById('answer-text').textContent = data.answer;
      ansEl.classList.add('visible');
      ansEl.style.display = 'block';
      setTimeout(() => ansEl.classList.add('show'), 50);
    }, 1200);

  } catch (err) {
    document.getElementById('loading').classList.remove('visible');
    showError('Could not reach Colab. Make sure it is running.');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.add('visible');
}
