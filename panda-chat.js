function togglePanda() {
  document.getElementById('pandaChat')?.classList.toggle('active');
}

function appendPandaMessage(body, message, fromPanda) {
  const row = document.createElement('div');
  if (fromPanda) {
    row.className = 'message-row';
    const avatar = document.createElement('div');
    avatar.className = 'panda-avatar';
    avatar.textContent = '🐼';
    row.append(avatar);
  } else {
    row.className = 'message user-message';
  }
  const bubble = document.createElement('div');
  bubble.className = fromPanda ? 'message panda-message' : '';
  bubble.textContent = String(message ?? '');
  row.append(bubble);
  body.append(row);
  body.scrollTop = body.scrollHeight;
  return row;
}

async function sendPandaMessage() {
  const input = document.getElementById('pandaInput');
  const body = document.getElementById('pandaBody');
  if (!input || !body || body.dataset.sending === 'true') return;

  const message = input.value.trim();
  if (!message) return;

  body.dataset.sending = 'true';
  const sendButton = document.getElementById('pandaSend');
  if (sendButton) sendButton.disabled = true;
  appendPandaMessage(body, message, false);
  input.value = '';

  const typing = document.createElement('div');
  typing.className = 'message-row';
  typing.id = 'typingIndicator';
  const avatar = document.createElement('div');
  avatar.className = 'panda-avatar';
  avatar.textContent = '🐼';
  const status = document.createElement('div');
  status.className = 'typing';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Panda is thinking');
  for (let i = 0; i < 3; i++) status.append(document.createElement('span'));
  typing.append(avatar, status);
  body.append(typing);
  body.scrollTop = body.scrollHeight;

  try {
    const response = await fetch('/.netlify/functions/server/panda-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Panda unavailable');
    typing.remove();
    appendPandaMessage(body, data.reply || 'No response', true);
  } catch (error) {
    typing.remove();
    appendPandaMessage(body, '❌ Panda unavailable', true);
    console.error('Panda frontend error:', error);
  } finally {
    body.dataset.sending = 'false';
    if (sendButton) sendButton.disabled = false;
  }
}
