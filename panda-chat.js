

function togglePanda() {
  document
    .getElementById('pandaChat')
    .classList
    .toggle('active');
}

async function sendPandaMessage() {
  const input = document.getElementById('pandaInput');
  const body = document.getElementById('pandaBody');

  const message = input.value.trim();
  if (!message) return;

  body.innerHTML += `
    <div class="message user-message">
      ${message}
    </div>
  `;

  input.value = '';

  body.innerHTML += `
    <div id="typingIndicator" class="message-row">
      <div class="panda-avatar">🐼</div>
      <div class="typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  body.scrollTop = body.scrollHeight;
const API_BASE = '/.netlify/functions/server';
  try {
  const response = await fetch('/.netlify/functions/server/panda-chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message })
});

const raw = await response.text();

let data;
try {
  data = JSON.parse(raw);
} catch {
  throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
}

if (!response.ok) {
  throw new Error(data.error || 'Panda unavailable');
}

return data;

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response: ${text.slice(0, 120)}`);
    }
    
    document.getElementById('typingIndicator')?.remove();

    body.innerHTML += `
      <div class="message-row">
        <div class="panda-avatar">🐼</div>
        <div class="message panda-message">
          ${data.reply || data.error || 'No response'}
        </div>
      </div>
    `;

    body.scrollTop = body.scrollHeight;

  } catch (error) {
    document.getElementById('typingIndicator')?.remove();

    body.innerHTML += `
      <div class="message-row">
        <div class="panda-avatar">🐼</div>
        <div class="message panda-message">
          ❌ Panda unavailable
        </div>
      </div>
    `;

    body.scrollTop = body.scrollHeight;
    console.error('Panda frontend error:', error);
  }
}