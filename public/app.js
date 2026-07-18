const chat = document.getElementById('chat');
const form = document.getElementById('terminalForm');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const ledStrip = document.getElementById('ledStrip');
const footnote = document.getElementById('footnote');

let history = []; // {role, content}
let passcode = sessionStorage.getItem('classPasscode') || '';

// Per-browser ID
let clientId = localStorage.getItem('clientId');
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem('clientId', clientId);
}

//Class-gate
async function ensurePasscode() {
  while (!passcode) {
    const entered = window.prompt('Enter your class access code for Digital Logic Companion:');
    if (entered === null) continue; 
    passcode = entered.trim();
  }
  sessionStorage.setItem('classPasscode', passcode);
}

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg msg--${role === 'user' ? 'student' : 'tutor'}`;

  const chip = document.createElement('div');
  chip.className = `chip chip--${role === 'user' ? 'student' : 'tutor'}`;

  if (role !== 'user') {
    const pins = document.createElement('div');
    pins.className = 'pins pins--left';
    pins.innerHTML = '<span></span><span></span><span></span>';
    chip.appendChild(pins);
  }

  const body = document.createElement('div');
  body.className = 'chip-body';
  body.textContent = text;
  chip.appendChild(body);

  wrap.appendChild(chip);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return body;
}

function setThinking(on) {
  ledStrip.classList.toggle('thinking', on);
  sendBtn.disabled = on;
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
}
input.addEventListener('input', autosize);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  await ensurePasscode();

  addMessage('user', text);
  history.push({ role: 'user', content: text });
  input.value = '';
  autosize();
  setThinking(true);
  footnote.textContent = 'Session for this class only · conversations are not stored';
  footnote.classList.remove('error');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Class-Passcode': passcode,
        'X-Client-Id': clientId,
      },
      body: JSON.stringify({ messages: history }),
    });

    if (res.status === 401) {
      sessionStorage.removeItem('classPasscode');
      passcode = '';
      throw new Error('Access code not recognized. Refresh and re-enter it.');
    }
    if (res.status === 429) {
      throw new Error("You've hit the question limit. Please wait a few minutes before trying again.");
    }
    if (!res.ok) throw new Error('Something went wrong reaching the tutor.');

    const data = await res.json();
    addMessage('assistant', data.reply);
    history.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    footnote.textContent = err.message;
    footnote.classList.add('error');
  } finally {
    setThinking(false);
  }
});

ensurePasscode();
