const DEFAULT_MODEL = 'gemma-4-31b-it'; // change in Settings if your model ID differs
const store = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const INSTRUCTIONS = `You are CyberGuard, an expert cybersecurity and anti-phishing analyst. Analyze the user's input (a link, an SMS or email, or a security question) for scams, phishing, social engineering and fraud.
Reply with ONLY one JSON object, no markdown fences, no extra text, in exactly this shape:
{"risk":"HIGH or MEDIUM or LOW or UNKNOWN","score":0-100 integer threat score,"summary":"one or two plain sentences","redFlags":["..."],"actions":["clear step the user should take now"],"advice":"short tips on avoiding similar threats"}
For advice questions with nothing suspicious, use risk "UNKNOWN" and put the helpful answer in "actions" and "advice". Write in plain language for a non-expert.`;

const SAMPLES = {
  link1: ['link', 'http://www.bankofamerica-login-security-update.com/signin?ref=urgent'],
  sms1: ['text', 'FedEx: Your shipment is pending address confirmation. Update your details immediately at http://fedx-tracking-delivery.info/pay and pay a $1.50 fee to release it.'],
  email1: ['text', 'URGENT: Your Netflix account has been suspended due to billing issues. Click here within 24 hours to prevent account deletion: http://netflix-billing-fix.net']
};
const MODES = {
  link: ['Paste the link you want to check', 'https://secure-update-paypal-login.com/verify', 'Which link do you want to check today?'],
  text: ['Paste the text message or email', 'USPS: Your package could not be delivered. Update your address here…', 'Which message do you want to scan today?'],
  advice: ['Describe your security concern', 'I clicked a link in a text and typed my password. What should I do now?', 'What security concern can I help with today?']
};
const RISK = {
  HIGH: ['High risk', 'var(--high)', 'var(--high-soft)'],
  MEDIUM: ['Medium risk', 'var(--mid)', 'var(--mid-soft)'],
  LOW: ['Low risk', 'var(--low)', 'var(--low-soft)'],
  UNKNOWN: ['Use caution', 'var(--unk)', 'var(--unk-soft)']
};
const TIPS = [
  'Don’t tap links in texts or emails you weren’t expecting.',
  'Read the domain letter by letter. paypa1.com is not PayPal.',
  'Banks never ask for your password or PIN by message.',
  'Turn on two-factor authentication for email and banking.'
];

let mode = 'link';
let historyStorageKey = 'cyberguard_history_v2';
function loadHistory(key) {
  const savedHistory = store.get(key, []);
  return Array.isArray(savedHistory)
    ? savedHistory.filter(entry =>
      entry &&
      Number.isFinite(Number(entry.id)) &&
      typeof entry.time === 'string' &&
      typeof entry.input === 'string' &&
      entry.report &&
      Object.prototype.hasOwnProperty.call(RISK, entry.report.risk)
    ).slice(0, 15)
    : [];
}
let history = [];
window.addEventListener('cyberguard:auth', event => {
  const uid = event.detail?.uid;
  historyStorageKey = uid ? `cyberguard_history_v2_${uid}` : 'cyberguard_history_v2';
  history = uid ? loadHistory(historyStorageKey) : [];
  renderHistory();
});
let lastReport = '';
let lastSpoken = '';
let tipIndex = 0;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

// ---------- Sidebar (mobile drawer) and tips ----------
const setSide = open => document.body.classList.toggle('side-open', open);
$('menuBtn').addEventListener('click', () => setSide(true));
$('sidebarClose').addEventListener('click', () => setSide(false));
$('scrim').addEventListener('click', () => setSide(false));
function showTip() { $('tipText').textContent = TIPS[tipIndex]; }
$('tipBtn').addEventListener('click', () => { tipIndex = (tipIndex + 1) % TIPS.length; showTip(); });

// ---------- Modes, samples, clear ----------
function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
  $('inputLabel').textContent = MODES[m][0];
  $('userPrompt').placeholder = MODES[m][1];
  $('heroSub').textContent = MODES[m][2];
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { setMode(t.dataset.mode); $('userPrompt').focus(); }));
document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => {
  const [m, text] = SAMPLES[b.dataset.sample];
  setMode(m);
  $('userPrompt').value = text;
}));
$('clearBtn').addEventListener('click', () => {
  if (synth) synth.cancel();
  $('userPrompt').value = '';
  $('result').style.display = 'none';
  document.body.classList.remove('has-result');
  setSide(false);
  $('userPrompt').focus();
});

// ---------- Settings ----------
function showModel() { $('modelName').textContent = store.get('cyberguard_model', DEFAULT_MODEL); }
function openSettings() {
  $('apiKeyInput').value = store.get('cyberguard_key', '');
  $('modelInput').value = store.get('cyberguard_model', DEFAULT_MODEL);
  $('settingsDialog').showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
$('modelChip').addEventListener('click', openSettings);
$('saveSettings').addEventListener('click', () => {
  store.set('cyberguard_key', $('apiKeyInput').value.trim());
  store.set('cyberguard_model', $('modelInput').value.trim() || DEFAULT_MODEL);
  showModel();
});

// ---------- Analysis ----------
async function analyze() {
  const text = $('userPrompt').value.trim();
  if (!text) { $('userPrompt').focus(); return; }

  const key = store.get('cyberguard_key', '');
  if (!key) { showError('Add your API key in Settings before running a check.'); return; }
  const model = store.get('cyberguard_model', DEFAULT_MODEL);

  if (synth) synth.cancel();
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').setAttribute('aria-label', 'Checking…');
  $('loading').style.display = 'block';
  $('result').style.display = 'none';

  try {
    // Instructions are placed inside the prompt because Gemma models
    // don't always accept a separate systemInstruction field.
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${INSTRUCTIONS}\n\nMode: ${mode}\nUser input:\n${text}` }] }],
          generationConfig: { temperature: 0.2 }
        })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error?.message || `Request failed (HTTP ${res.status}).`);
    if (data.promptFeedback?.blockReason) throw new Error('The request was blocked: ' + data.promptFeedback.blockReason);

    // Skip any "thinking" parts, keep only the answer text
    const parts = data.candidates?.[0]?.content?.parts || [];
    const raw = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
    if (!raw) throw new Error('The model returned no answer. Try again.');

    const report = parseReport(raw);
    render(report);
    saveHistory(text, report);
    if ($('handsFree').checked) speak(lastSpoken);
  } catch (e) {
    showError(e.message + ' Check your API key and model name in Settings.');
  } finally {
    $('loading').style.display = 'none';
    $('analyzeBtn').disabled = false;
    $('analyzeBtn').setAttribute('aria-label', 'Check for threats');
  }
}
$('analyzeBtn').addEventListener('click', analyze);
$('userPrompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze();
});

function parseReport(raw) {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  try {
    const o = JSON.parse(cleaned.slice(start, end + 1));
    const risk = String(o.risk || 'UNKNOWN').toUpperCase();
    return {
      risk: RISK[risk] ? risk : 'UNKNOWN',
      score: Math.max(0, Math.min(100, parseInt(o.score, 10) || 0)),
      summary: o.summary || '',
      redFlags: Array.isArray(o.redFlags) ? o.redFlags : [],
      actions: Array.isArray(o.actions) ? o.actions : [],
      advice: o.advice || ''
    };
  } catch {
    return { risk: 'UNKNOWN', score: 0, summary: '', redFlags: [], actions: [], advice: '', raw };
  }
}

// ---------- Rendering ----------
function showResult() {
  const r = $('result');
  document.body.classList.add('has-result');
  r.style.display = 'block';
  r.classList.remove('show');
  void r.offsetWidth; // restart the entrance animation
  r.classList.add('show');
  r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render(r) {
  const [label, color, soft] = RISK[r.risk];
  const box = $('verdictBox');
  box.style.setProperty('--verdict', color);
  box.style.setProperty('--verdict-soft', soft);
  $('riskTitle').textContent = label;
  $('summary').textContent = r.summary || (r.raw ? 'The model answered in free text. Full answer below.' : '');
  $('scoreNum').textContent = r.score;

  const fill = $('gaugeFill');
  fill.style.strokeDashoffset = 157.08;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.strokeDashoffset = 157.08 * (1 - r.score / 100);
  }));

  const list = (tag, items) => `<${tag}>${items.map(i => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
  let html = '';
  if (r.raw) html += `<div class="sec"><h3>Full answer</h3><div class="raw">${esc(r.raw)}</div></div>`;
  if (r.redFlags.length) html += `<div class="sec flags"><h3>Warning signs found</h3>${list('ul', r.redFlags)}</div>`;
  if (r.actions.length) html += `<div class="sec actions"><h3>What to do now</h3>${list('ol', r.actions)}</div>`;
  if (r.advice) html += `<div class="sec advice"><h3>How to stay safe next time</h3><div>${esc(r.advice)}</div></div>`;
  $('sections').innerHTML = html;

  lastReport = [
    `${label} (${r.score}/100)`, r.summary,
    r.redFlags.length ? 'Warning signs:\n- ' + r.redFlags.join('\n- ') : '',
    r.actions.length ? 'What to do now:\n- ' + r.actions.join('\n- ') : '',
    r.advice, r.raw || ''
  ].filter(Boolean).join('\n\n');

  lastSpoken = [
    `${label}. Threat score ${r.score} out of 100.`, r.summary,
    r.actions.length ? 'What to do now. ' + r.actions.map((a, i) => `Step ${i + 1}. ${a}`).join(' ') : '',
    r.raw ? r.raw.slice(0, 600) : ''
  ].filter(Boolean).join(' ');

  showResult();
}

function showError(msg) {
  const box = $('verdictBox');
  box.style.setProperty('--verdict', 'var(--high)');
  box.style.setProperty('--verdict-soft', 'var(--high-soft)');
  $('sections').innerHTML = '';
  $('gaugeFill').style.strokeDashoffset = 157.08;
  $('scoreNum').textContent = '–';
  $('riskTitle').textContent = 'Check didn’t run';
  $('summary').textContent = msg;
  lastReport = '';
  lastSpoken = '';
  showResult();
}

$('copyBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  try { await navigator.clipboard.writeText(lastReport); $('copyBtn').textContent = 'Copied'; }
  catch { $('copyBtn').textContent = 'Copy failed'; }
  setTimeout(() => { $('copyBtn').textContent = 'Copy report'; }, 1500);
});

// ---------- History (grouped by day, searchable) ----------
function saveHistory(input, report) {
  history.unshift({
    id: Date.now(),
    time: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    input, report
  });
  history = history.slice(0, 15);
  store.set(historyStorageKey, history);
  renderHistory();
}
function groupLabel(id) {
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(id))) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7) return 'Previous 7 days';
  return 'Older';
}
function renderHistory() {
  const q = $('histSearch').value.trim().toLowerCase();
  const items = history.filter(h => !q || h.input.toLowerCase().includes(q));
  if (!items.length) {
    $('history').innerHTML = `<p class="muted">${history.length ? 'No checks match your search.' : 'Nothing checked yet. Your last 15 checks show up here.'}</p>`;
    return;
  }
  const groups = {};
  items.forEach(h => (groups[groupLabel(h.id)] ||= []).push(h));
  $('history').innerHTML = Object.entries(groups).map(([label, list]) =>
    `<div class="hist-group"><h4>${label}</h4>${list.map(h =>
      `<div class="hist-item"><button class="hist-open" type="button" data-id="${h.id}" title="${esc(h.time)} · ${esc(RISK[h.report.risk][0])}"><i class="dot" style="background:${RISK[h.report.risk][1]};color:${RISK[h.report.risk][1]}"></i><span class="p">${esc(h.input)}</span></button><button class="hist-del" type="button" data-del="${h.id}" aria-label="Delete this check" title="Delete">⋯</button></div>`
    ).join('')}</div>`
  ).join('');
}
$('histSearch').addEventListener('input', renderHistory);
$('history').addEventListener('click', e => {
  const del = e.target.closest('.hist-del');
  if (del) {
    history = history.filter(x => x.id !== Number(del.dataset.del));
    store.set(historyStorageKey, history);
    renderHistory();
    return;
  }
  const b = e.target.closest('.hist-open');
  if (!b) return;
  const h = history.find(x => x.id === Number(b.dataset.id));
  if (!h) return;
  $('userPrompt').value = h.input;
  render(h.report);
  setSide(false);
});
$('clearHistBtn').addEventListener('click', () => {
  if (history.length && confirm('Delete all saved checks from this browser?')) {
    history = [];
    try { localStorage.removeItem(historyStorageKey); } catch {}
    renderHistory();
  }
});

// ---------- Voice assistant ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;
const setVoice = t => { $('voiceStatus').textContent = t; };

function startListening() {
  if (!SR) { setVoice('Voice input isn’t supported in this browser. Use Edge or Chrome.'); return; }
  if (listening) { recognizer.stop(); return; }
  if (synth) synth.cancel();

  recognizer = new SR();
  recognizer.lang = 'en-US';
  recognizer.interimResults = true;
  let finalText = '';
  let hadError = false;

  recognizer.onstart = () => {
    listening = true;
    $('micBtn').classList.add('listening');
    setVoice('Listening… speak now.');
  };
  recognizer.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    $('userPrompt').value = (finalText + interim).trim();
  };
  recognizer.onerror = e => {
    hadError = true;
    const msgs = {
      'not-allowed': 'Microphone is blocked. Allow it in the address bar, then try again.',
      'no-speech': 'I didn’t hear anything. Tap the mic and try again.',
      'audio-capture': 'No microphone found.',
      'network': 'The voice service can’t be reached. Check your internet.'
    };
    setVoice(msgs[e.error] || 'Voice error: ' + e.error);
  };
  recognizer.onend = () => {
    listening = false;
    $('micBtn').classList.remove('listening');
    if (finalText.trim()) {
      setVoice('Got it.');
      if ($('handsFree').checked) analyze();
    } else if (!hadError) {
      setVoice('Tap the mic and say your question.');
    }
  };
  try {
    recognizer.start();
  } catch (error) {
    listening = false;
    $('micBtn').classList.remove('listening');
    setVoice(`Couldn’t start voice input: ${error.message}`);
  }
}

function speak(text) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, 'the link'));
  u.lang = 'en-US';
  const v = synth.getVoices().find(v => /^en/i.test(v.lang) && /natural|online|google/i.test(v.name));
  if (v) u.voice = v;
  u.onstart = () => { $('eq').classList.add('on'); $('speakBtn').textContent = 'Stop'; };
  u.onend = u.onerror = () => { $('eq').classList.remove('on'); $('speakBtn').textContent = 'Read aloud'; };
  synth.speak(u);
}

$('micBtn').addEventListener('click', startListening);
$('speakBtn').addEventListener('click', () => {
  if (!synth) return;
  if (synth.speaking) synth.cancel(); else speak(lastSpoken);
});
$('handsFree').checked = !!store.get('cyberguard_handsfree', false);
$('handsFree').addEventListener('change', e => store.set('cyberguard_handsfree', e.target.checked));

// ---------- Start ----------
renderHistory();
showModel();
showTip();