(() => {
  'use strict';
  const F = window.HanVerseFeatures;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = F?.currentUserId?.();
  const api = (path, options = {}) => F.api(path, options);
  const state = { world: null, stories: [], reviewCount: null, mock: null, mockAnswers: [], scenario: null, conversationId: null, voice: null };
  const toast = message => { const node = $('#worldToast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 3200); };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const requireLogin = () => { if (uid) return true; toast('Please sign in to save your progress.'); return false; };
  const errorText = error => error?.message || 'Something went wrong. Please try again.';
  function updateTrailSummary() {
    const summary = $('#trailSummary');
    if (!uid) { summary.textContent = 'Sign in to shape a short learning path around your saved words and story progress.'; return; }
    const review = state.reviewCount === null ? 'Checking your review queue.' : state.reviewCount ? `${state.reviewCount} ${state.reviewCount === 1 ? 'word is' : 'words are'} ready for review.` : 'Your review deck is clear.';
    const chapters = state.world?.stories?.reduce((total, story) => total + story.progress.length, 0) || 0;
    summary.textContent = `${review} You have finished ${chapters} story ${chapters === 1 ? 'chapter' : 'chapters'}. The full trail takes about 10 minutes; choose one step or try all three.`;
  }
  function openTrailStep(panel) {
    const tab = $(`.world-tab[data-panel="${panel}"]`);
    if (!tab) return;
    tab.click();
    $(`#panel-${panel}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $$('[data-trail-panel]').forEach(button => button.addEventListener('click', () => openTrailStep(button.dataset.trailPanel)));
  $('#trailStart').addEventListener('click', () => openTrailStep('review'));

  $$('.world-tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.world-tab').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
    $$('.world-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tab.dataset.panel}`));
    if (tab.dataset.panel === 'review') loadReview();
  }));
  $$('.world-tab').forEach((tab, index, tabs) => tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  }));

  async function loadWorld() {
    if (!uid) { $('#worldStats').innerHTML = '<span class="stat-chip">Sign in to save XP and progress</span>'; }
    if (!uid) { renderDecor(); renderMockBest([]); return; }
    try {
      const data = await api('/world/state'); state.world = data;
      $('#worldStats').innerHTML = `<span class="stat-chip">⭐ ${Number(data.xp) || 0} XP</span><span class="stat-chip">📚 ${data.stories.reduce((n, x) => n + x.progress.length, 0)} story chapters</span><span class="stat-chip">🎯 ${data.bestMocks.length} practice rooms tried</span>`;
      renderDecor(); renderMockBest(data.bestMocks); updateTrailSummary();
    } catch (error) { $('#worldStats').innerHTML = `<span class="stat-chip">${escape(errorText(error))}</span>`; }
  }

  async function loadStories() {
    if (!uid) { $('#storyGrid').innerHTML = '<div class="empty-state">Sign in to save your story progress and earn XP.</div>'; return; }
    try {
      const data = await api('/world/stories'); state.stories = data.stories || [];
      $('#storyGrid').innerHTML = state.stories.map(story => {
        const done = new Set(story.progress.map(row => Number(row.chapter)));
        const next = Array.from({ length: story.chapters }, (_, i) => i).find(i => !done.has(i));
        const progress = `${done.size}/${story.chapters} chapters`;
        return `<article class="world-card"><div class="story-icon">${escape(story.icon)}</div><h3>${escape(story.title)}</h3><p>${escape(story.summary)}</p><div class="tag-row"><span class="tag">Level ${story.level}</span><span class="tag">${progress}</span></div><button class="world-btn" data-story="${escape(story.id)}" data-chapter="${next ?? story.chapters - 1}">${next === undefined ? 'Replay final chapter' : done.size ? 'Continue story →' : 'Begin story →'}</button></article>`;
      }).join('');
      $$('[data-story]').forEach(button => button.addEventListener('click', () => showChapter(button.dataset.story, Number(button.dataset.chapter))));
    } catch (error) { $('#storyGrid').innerHTML = `<div class="empty-state">${escape(errorText(error))}</div>`; }
  }
  async function showChapter(story, chapter) {
    if (!requireLogin()) return;
    const play = $('#storyPlay'); play.classList.remove('hidden'); play.innerHTML = '<div class="loading">Opening your story…</div>';
    try {
      const data = await api(`/world/stories/${encodeURIComponent(story)}/${chapter}`);
      play.innerHTML = `<div class="play-progress">${escape(data.title)} · Chapter ${chapter + 1} of ${data.total}</div><p>${escape(data.scene)}</p><div class="story-line" lang="zh">${escape(data.line)}</div><button class="world-btn secondary" id="listenStoryLine" type="button">🔊 Listen to the Mandarin</button><p class="voice-note" id="storyVoiceNote" aria-live="polite"></p><h3>${escape(data.question)}</h3><div class="choice-list">${data.choices.map(choice => `<button class="choice" data-choice="${escape(choice.id)}">${escape(choice.text)}</button>`).join('')}</div><p class="feedback" id="storyFeedback" aria-live="polite"></p><button class="world-btn secondary" id="closeStory">Back to adventures</button>`;
      $('#listenStoryLine').addEventListener('click', () => {
        if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
          $('#storyVoiceNote').textContent = 'Audio is not available in this browser. Ask a grown-up to help read the Mandarin line.';
          return;
        }
        window.speechSynthesis.cancel();
        const mandarinLine = data.line.includes(':') ? data.line.slice(data.line.indexOf(':') + 1).trim() : data.line;
        const utterance = new window.SpeechSynthesisUtterance(mandarinLine);
        utterance.lang = 'zh-CN'; utterance.rate = 0.85;
        window.speechSynthesis.speak(utterance);
        $('#storyVoiceNote').textContent = 'Playing the Mandarin line slowly.';
      });
      $('#closeStory').addEventListener('click', () => { window.speechSynthesis?.cancel?.(); play.classList.add('hidden'); });
      $$('.choice', play).forEach(button => button.addEventListener('click', async () => {
        $$('.choice', play).forEach(choice => choice.disabled = true);
        try {
          const result = await api(`/world/stories/${encodeURIComponent(story)}/${chapter}/complete`, { method: 'POST', body: { choice: button.dataset.choice } });
          $('#storyFeedback').textContent = `${result.feedback}${result.earnedXp ? ' +5 XP earned!' : ''}${result.storyComplete ? ' Story complete!' : ''}`;
          if (result.correct && result.nextChapter !== null) { const next = document.createElement('button'); next.className = 'world-btn'; next.textContent = 'Next chapter →'; next.addEventListener('click', () => showChapter(story, result.nextChapter)); $('#storyFeedback').after(next); }
          if (!result.correct) $$('.choice', play).forEach(choice => choice.disabled = false);
          await Promise.all([loadStories(), loadWorld()]);
        } catch (error) { $('#storyFeedback').textContent = errorText(error); $$('.choice', play).forEach(choice => choice.disabled = false); }
      }));
      play.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { play.innerHTML = `<div class="empty-state">${escape(errorText(error))}</div>`; }
  }

  async function loadReview() {
    if (!uid) { $('#reviewList').innerHTML = '<div class="empty-state">Sign in to see your saved words.</div>'; return; }
    try {
      const [calendar, deck] = await Promise.all([api('/world/review-calendar'), F.review.deck(uid)]);
      const days = calendar.days || []; const now = new Date();
      const cells = Array.from({ length: 7 }, (_, i) => { const date = new Date(now); date.setDate(now.getDate() + i); const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; const found = days.find(item => item.day === key || (i === 0 && item.day === 'overdue')); return `<div class="day-cell"><strong>${date.toLocaleDateString(undefined, { weekday: 'short' })}</strong><span>${found?.cards || 0}</span></div>`; });
      $('#reviewCalendar').innerHTML = cells.join('');
      const overdue = days.find(row => row.day === 'overdue')?.cards || 0;
      $('#reviewDueLabel').textContent = overdue ? `${overdue} overdue ${overdue === 1 ? 'word' : 'words'} are included in today’s deck.` : 'Numbers show words due each day.';
      const cards = deck.cards || []; state.reviewCount = cards.length; updateTrailSummary();
      $('#reviewList').innerHTML = cards.length ? cards.map((card, i) => `<article class="review-word" data-review-card="${i}"><div><strong lang="zh">${escape(card.word)}</strong><div class="muted">${escape(card.pinyin || '')}</div><button class="review-listen" type="button" data-listen-review="${i}" aria-label="Listen to this Mandarin word">🔊 Listen</button><p class="review-meaning" hidden>${escape(card.meaning || '')}</p><button class="review-reveal" type="button" data-reveal-review>Show meaning</button></div><div class="review-actions" data-word-index="${i}" hidden><span class="review-prompt">How easy was it to remember?</span><button data-quality="0" title="I forgot">Again</button><button data-quality="3" title="It was difficult">Hard</button><button data-quality="4" title="I remembered it">Good</button><button data-quality="5" title="Very easy to remember">Easy</button></div></article>`).join('') : '<div class="empty-state">Your review deck is clear. Complete lessons to add vocabulary for later.</div>';
      $$('[data-listen-review]').forEach(button => button.addEventListener('click', () => {
        const card = cards[Number(button.dataset.listenReview)];
        if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { toast('Audio is not available here. Try reading the pinyin aloud.'); return; }
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(card.word);
        utterance.lang = 'zh-CN'; utterance.rate = 0.85;
        window.speechSynthesis.speak(utterance);
      }));
      $$('[data-reveal-review]').forEach(button => button.addEventListener('click', () => {
        const card = button.closest('[data-review-card]');
        card.querySelector('.review-meaning').hidden = false;
        card.querySelector('.review-actions').hidden = false;
        button.hidden = true;
      }));
      $$('.review-actions').forEach(actions => actions.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
        const card = cards[Number(actions.dataset.wordIndex)]; button.disabled = true;
        try { await F.review.answer(uid, card.word, Number(button.dataset.quality), { pinyin: card.pinyin, meaning: card.meaning }); toast('Review saved. Nice work!'); await loadReview(); }
        catch (error) { toast(errorText(error)); button.disabled = false; }
      })));
    } catch (error) { state.reviewCount = null; updateTrailSummary(); $('#reviewList').innerHTML = `<div class="empty-state">${escape(errorText(error))}</div>`; }
  }

  const scenes = {
    market: { title:'At the fruit stand', goal:'Greet the seller, choose one fruit, then say thank you.', opening:'你好！你想买什么水果？', hints:['你好','我想要…','谢谢'], level:'beginner' },
    classmate: { title:'Meet a classmate', goal:'Say hello, share a hobby, and ask one friendly question.', opening:'你好！你喜欢什么？', hints:['你好','我喜欢…','你呢？'], level:'beginner' },
    directions: { title:'Find the library', goal:'Ask where the library is and follow one direction.', opening:'你好！图书馆在哪里？我可以帮你。', hints:['请问','图书馆在哪里？','谢谢'], level:'intermediate' }
  };
  $$('.scenario-card').forEach(card => card.addEventListener('click', () => beginRoleplay(card.dataset.scenario)));
  function beginRoleplay(key) {
    if (!requireLogin()) return;
    const scene = scenes[key]; if (!scene) return;
    state.scenario = key; state.conversationId = `world-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    $('#scenarioTitle').textContent = scene.title; $('#scenarioGoal').textContent = scene.goal;
    $('#phraseHints').innerHTML = scene.hints.map(hint => `<span class="tag">${escape(hint)}</span>`).join('');
    $('#scenarioGrid').classList.add('hidden'); $('#roleplay').classList.remove('hidden');
    $('#chatLog').innerHTML = `<div class="bubble panda">${escape(scene.opening)}</div>`; $('#roleplayInput').focus();
  }
  $('#endRoleplay').addEventListener('click', () => { $('#roleplay').classList.add('hidden'); $('#scenarioGrid').classList.remove('hidden'); state.scenario = null; });
  async function sendRoleplay(text) {
    const clean = text.trim().slice(0, 300); if (!clean || !state.scenario) return;
    const scene = scenes[state.scenario]; const log = $('#chatLog');
    const userBubble = document.createElement('div'); userBubble.className = 'bubble learner'; userBubble.textContent = clean; log.append(userBubble);
    $('#roleplayInput').value = ''; $('#sendRoleplay').disabled = true;
    const pending = document.createElement('div'); pending.className = 'bubble panda'; pending.textContent = 'Panda is thinking…'; log.append(pending); log.scrollTop = log.scrollHeight;
    try {
      const result = await api('/panda-chat', { method:'POST', body: { user_id: uid, conversation_id: state.conversationId, message: `Child-safe Mandarin roleplay scene: ${scene.title}. Goal: ${scene.goal} Phrase hints: ${scene.hints.join(', ')}. Keep your reply to one short child-friendly sentence. Gently stay in the scene, model simple Mandarin, and include a brief English meaning when helpful. Learner says: ${clean}`, level: scene.level, mode:'guided_roleplay' } });
      state.conversationId = result.conversation_id || result.conversationId || state.conversationId;
      const reply = result.reply || result.response || result.message || '很好！ Try one more short reply.'; pending.textContent = reply;
      if ('speechSynthesis' in window) { const utterance = new SpeechSynthesisUtterance(reply); utterance.lang = 'zh-CN'; window.speechSynthesis.speak(utterance); }
    } catch (error) { pending.textContent = errorText(error); }
    finally { $('#sendRoleplay').disabled = false; $('#roleplayInput').focus(); log.scrollTop = log.scrollHeight; }
  }
  $('#sendRoleplay').addEventListener('click', () => sendRoleplay($('#roleplayInput').value));
  $('#roleplayInput').addEventListener('keydown', event => { if (event.key === 'Enter') sendRoleplay(event.currentTarget.value); });
  $('#roleplayMic').addEventListener('click', () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast('Microphone input is not supported here. You can type your reply.'); return; }
    const recognizer = new Recognition(); recognizer.lang = 'zh-CN'; recognizer.interimResults = false; recognizer.maxAlternatives = 1;
    $('#voiceNote').textContent = 'Listening…'; recognizer.onresult = event => { $('#roleplayInput').value = event.results[0][0].transcript; $('#voiceNote').textContent = 'Speech added. Press Send when ready.'; };
    recognizer.onerror = () => { $('#voiceNote').textContent = 'Microphone unavailable. You can type your reply.'; }; recognizer.onend = () => { if ($('#voiceNote').textContent === 'Listening…') $('#voiceNote').textContent = 'You can type your reply or try the microphone again.'; };
    try { recognizer.start(); } catch { toast('Microphone is already listening.'); }
  });

  function renderMockBest(attempts = []) { $('#mockBest').textContent = attempts.length ? `Best scores: ${attempts.map(item => `${item.course_type} ${item.course_level}: ${item.score}%`).join(' · ')}` : 'Your best scores will appear here after a practice room.'; }
  $('#startMock').addEventListener('click', async () => {
    if (!requireLogin()) return;
    const course = $('#mockCourse').value.toLowerCase(); const level = $('#mockLevel').value; const play = $('#mockPlay'); play.classList.remove('hidden'); play.innerHTML = '<div class="loading">Preparing questions…</div>';
    try {
      const data = await api(`/world/mock/${course}/${level}`); state.mock = data; state.mockAnswers = [];
      play.innerHTML = `<div class="play-progress">${escape(data.course)} Level ${data.level} · ${data.questions.length} questions</div><form id="mockForm">${data.questions.map((question, index) => `<fieldset class="world-card" style="margin:12px 0"><legend><strong>${index + 1}. ${escape(question.prompt)}</strong></legend>${question.options.map(option => `<label class="exam-choice"><input required type="radio" name="${escape(question.id)}" value="${escape(option.id)}"><span>${escape(option.text)}</span></label>`).join('')}</fieldset>`).join('')}<button class="world-btn" type="submit">Check my answers</button><p class="feedback" id="mockResult" aria-live="polite"></p></form>`;
      $('#mockForm').addEventListener('submit', submitMock);
      play.scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) { play.innerHTML = `<div class="empty-state">${escape(errorText(error))}</div>`; }
  });
  async function submitMock(event) {
    event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    const answers = state.mock.questions.map(question => ({ questionId: question.id, choiceId: new FormData(form).get(question.id) }));
    try {
      const result = await api(`/world/mock/${state.mock.course.toLowerCase()}/${state.mock.level}/submit`, { method:'POST', body:{ answers } });
      $('#mockResult').textContent = `${result.score}% · ${result.correct} of ${result.total} correct. ${result.message}`;
      const submitted = new Map(answers.map(answer => [answer.questionId, answer.choiceId]));
      for (const answer of result.answerKey || []) {
        const field = form.querySelector(`fieldset input[name="${CSS.escape(answer.questionId)}"][value="${CSS.escape(answer.correctChoiceId)}"]`);
        const note = document.createElement('p'); note.className = 'exam-best'; note.textContent = submitted.get(answer.questionId) === answer.correctChoiceId ? '✓ Correct' : `Correct answer: ${answer.correctText}`;
        field?.closest('label')?.after(note);
      }
      form.querySelectorAll('input').forEach(input => { input.disabled = true; });
      await loadWorld();
    } catch (error) { $('#mockResult').textContent = errorText(error); submit.disabled = false; }
  }

  const decorById = id => state.world?.decor?.find(item => item.id === id);
  function renderDecor() {
    if (!state.world) return;
    $$('.select-slot').forEach(select => {
      const slot = select.dataset.slot; const available = state.world.decor.filter(item => item.slot === slot && item.unlocked);
      select.innerHTML = '<option value="">None</option>' + available.map(item => `<option value="${escape(item.id)}">${escape(item.emoji)} ${escape(item.name)}</option>`).join('');
      select.value = state.world.habitat?.[slot] || '';
    });
    $('#decorList').innerHTML = state.world.decor.map(item => `<span class="unlock-item ${item.unlocked ? '' : 'locked'}">${escape(item.emoji)} ${escape(item.name)}${item.unlocked ? '' : ` · ${item.at} XP`}</span>`).join('');
    const next = state.world.decor.filter(item => !item.unlocked).sort((a,b)=>a.at-b.at)[0];
    $('#habitatNext').textContent = next ? `${Math.max(0, next.at - state.world.xp)} more XP unlocks ${next.name}.` : 'You have unlocked every decoration. Wonderful!';
    updateHabitatPreview();
  }
  function updateHabitatPreview() { for (const slot of ['garden','sky','home']) { const item = decorById($(`.select-slot[data-slot="${slot}"]`)?.value); const node = $(`#decor${slot[0].toUpperCase()}${slot.slice(1)}`); if (node) node.textContent = item?.emoji || ''; } }
  $$('.select-slot').forEach(select => select.addEventListener('change', updateHabitatPreview));
  $('#saveHabitat').addEventListener('click', async () => {
    if (!requireLogin()) return;
    const layout = Object.fromEntries($$('.select-slot').map(select => [select.dataset.slot, select.value || null]));
    try { await api('/world/habitat', { method:'PUT', body:{ layout } }); toast('Your panda habitat is saved!'); }
    catch (error) { toast(errorText(error)); }
  });

  const activities = [
    { title:'Colour hunt', time:'5 minutes', phrase:'我喜欢红色。 (I like red.)', steps:['Choose three colours together.','Find one object for each colour.','Say the colour in Mandarin before pointing.'] },
    { title:'Fruit shop at home', time:'5 minutes', phrase:'我要一个苹果。 (I want one apple.)', steps:['Put two pieces of fruit on a table.','Take turns being the shopkeeper.','Use 你好, 我要…, and 谢谢.'] },
    { title:'Number steps', time:'5 minutes', phrase:'一、二、三！ (One, two, three!)', steps:['Count five safe steps together.','Count the same steps backwards if ready.','Let your child lead the count.'] },
    { title:'Family name circle', time:'5 minutes', phrase:'这是我的妈妈。 (This is my mother.)', steps:['Look at a family photo or draw simple faces.','Point and practise family words.','Invite your child to make one new sentence.'] },
    { title:'Toy directions', time:'5 minutes', phrase:'在桌子上。 (On the table.)', steps:['Place a favourite toy beside a chair.','Ask where it is using a gesture.','Try 上面 (on), 下面 (under), and 旁边 (beside).'] },
    { title:'Goodnight mini story', time:'5 minutes', phrase:'小熊猫晚安！ (Goodnight, little panda!)', steps:['Pick a toy panda or draw one.','Say one thing it did today.','Finish with 晚安 and a wave.'] }
  ];
  $('#familyCards').innerHTML = activities.map((item, index) => `<article class="world-card family-card"><span class="minutes">${item.time} · FAMILY ACTIVITY</span><h3>${escape(item.title)}</h3><div class="phrase">${escape(item.phrase)}</div><ol>${item.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><label class="complete-check"><input type="checkbox" data-family-check="${index}"> We tried this together</label></article>`).join('');
  $$('[data-family-check]').forEach(check => { const key = `hanverse-family-${new Date().toISOString().slice(0,10)}`; try { check.checked = (JSON.parse(localStorage.getItem(key) || '[]')).includes(Number(check.dataset.familyCheck)); } catch {} check.addEventListener('change', () => { try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); const index = Number(check.dataset.familyCheck); localStorage.setItem(key, JSON.stringify(check.checked ? [...new Set([...saved,index])] : saved.filter(x=>x!==index))); } catch {} }); });

  if (!uid) {
    ['startMock','saveHabitat'].forEach(id => { const button = $(`#${id}`); if (button) button.title = 'Sign in to save your progress'; });
  }
  updateTrailSummary(); loadWorld(); loadStories(); loadReview();
  const requestedPanel = location.hash.slice(1);
  if (['stories', 'review', 'speaking', 'exams', 'habitat', 'family'].includes(requestedPanel)) {
    $(`.world-tab[data-panel="${requestedPanel}"]`)?.click();
  }
})();
