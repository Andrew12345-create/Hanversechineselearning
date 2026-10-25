/* ============================================================
   HANVERSE AI ROUTES 🧠
   ------------------------------------------------------------
   Registers all AI-assisted endpoints on the existing router.
   - Reuses existing auth: requireUser (JWT) / verifyAdminToken
   - Reuses existing PG pool (lesson context comes from the DB,
     never from the client)
   - All model calls go through ./ai-helpers.js (provider
     selection, caps, caching, injection hardening)
   - The LLM never awards XP, never sees answer keys before
     submission, and never mutates progress. Grading stays with
     the existing deterministic engine.
   ============================================================ */

import {
  aiChat, askJSON, sanitizeUserText, fenceUserContent,
  underLimit, markUsage, usageSummary, cacheGet, cacheSet, hashKey, DAILY_LIMITS
} from './ai-helpers.js';

const kidSafeRules = `
SAFETY RULES (always apply):
- You speak with children aged 5-12 learning Mandarin Chinese.
- Stay on topic: Chinese language learning for this lesson.
- Never ask for real names, addresses, phone numbers, passwords,
  photos, or any personal/private information.
- No romance, violence, scary content, politics, or adult themes.
- If the learner seems upset or unsafe, suggest telling a parent
  or teacher. Never try to handle it alone.
- Do not claim to be human. You are Panda, a friendly panda character.
`;

function levelGuidance(level, courseType) {
  const lv = Number(level) || 1;
  const track = String(courseType || 'YCT').toUpperCase();
  if (lv <= 1) {
    return `Learner level: ${track} 1 (absolute beginner).
- Use only very simple Chinese words/sentences (roughly YCT 1 vocabulary).
- Always show pinyin with tone marks next to Chinese characters.
- Explain in very simple, short English sentences.`;
  }
  if (lv === 2) {
    return `Learner level: ${track} 2 (beginner).
- Use simple Chinese suitable for ${track} 2; may add one useful extra word with a gloss.
- Always show pinyin with tone marks.
- Keep English explanations short and friendly.`;
  }
  return `Learner level: ${track} ${lv}.
- Chinese suitable for ${track} level ${lv}.
- Always show pinyin with tone marks for any new or tricky word.
- English explanations clear and encouraging.`;
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

export function registerAIRoutes(router, pool, { requireUser, verifyAdminToken }) {

  /* requireUser(req,res) returns user|null (existing style).
     Wrap it as true middleware for the AI routes. */
  const auth = (req, res, next) => {
    requireUser(req, res).then(u => u ? next() : undefined).catch(e => {
      console.error('ai auth:', e.message);
      if (!res.headersSent) fail(res, 500, 'Authentication failed.');
    });
  };

  /* ------------------------------------------------------------
     Context loader: lesson facts from the DB (trusted source).
     Sends ONLY the lesson's own vocabulary/examples to the model.
  ------------------------------------------------------------ */
  async function lessonContext(lessonId) {
    const cacheKey = 'ctx:' + hashKey(String(lessonId));
    const hit = cacheGet(cacheKey);
    if (hit) return hit;

    const l = await pool.query(
      `SELECT lesson_id, title, description, level, course_type
         FROM lessons WHERE lesson_id = $1 AND is_published = TRUE LIMIT 1`,
      [String(lessonId)]
    );
    if (!l.rows.length) return null;
    const lesson = l.rows[0];

    const [vocab, examples] = await Promise.all([
      pool.query(
        `SELECT chinese, pinyin, english FROM lesson_vocabulary
          WHERE lesson_id = $1 ORDER BY order_index ASC, vocabulary_id ASC LIMIT 25`,
        [lesson.lesson_id]
      ),
      pool.query(
        `SELECT chinese, pinyin, english FROM lesson_examples
          WHERE lesson_id = $1 ORDER BY order_index ASC, example_id ASC LIMIT 10`,
        [lesson.lesson_id].map(String)
      ).catch(() => ({ rows: [] }))
    ]);

    const ctx = {
      id: lesson.lesson_id,
      title: lesson.title,
      description: lesson.description || '',
      level: lesson.level,
      courseType: lesson.course_type || 'YCT',
      vocabulary: vocab.rows,
      examples: examples.rows
    };
    cacheSet(cacheKey, ctx);
    return ctx;
  }

  /* ============================================================
     1) ASK PANDA — lesson-aware helper ("What does 再见 mean?")
     POST /ai/lesson-help { lessonId, question }
  ============================================================ */
  router.post('/ai/lesson-help', auth, async (req, res) => {
    try {
      const userId = req.authUser?.user_id;
      const body = req.body || {};
      const question = sanitizeUserText(body.question, 300);
      const lessonId = String(body.lessonId || '').trim().slice(0, 40);

      if (!question) return fail(res, 400, 'Ask Panda a question first.');
      if (!lessonId) return fail(res, 400, 'Lesson ID is required.');

      if (!underLimit(userId, 'lessonHelp')) {
        return fail(res, 429, 'Panda needs a rest — try again tomorrow. 🐼');
      }

      const ctx = await lessonContext(lessonId);
      if (!ctx) return fail(res, 404, 'Lesson not found.');

      const cacheKey = 'lh:' + hashKey(lessonId + '|' + question.toLowerCase());
      const cached = cacheGet(cacheKey);
      if (cached) {
        return res.json({ success: true, reply: cached, cached: true, usage: usageSummary() });
      }

      const vocabBlock = ctx.vocabulary.length
        ? ctx.vocabulary.map(v => `${v.chinese} (${v.pinyin || '?'}) — ${v.english || '?'}`).join('\n')
        : '(no vocabulary list recorded for this lesson)';

      const exampleBlock = ctx.examples.length
        ? ctx.examples.map(e => `${e.chinese} (${e.pinyin || '?'}) — ${e.english || '?'}`).join('\n')
        : '(no example sentences recorded)';

      const answer = await aiChat({
        tier: 'fast',
        messages: [
          {
            role: 'system',
            content: `You are Panda 🐼, the learning companion inside a HanVerse lesson.
Answer the child's question about THIS lesson only.

LESSON (trusted curriculum data):
Title: ${ctx.title}
Course: ${ctx.courseType}
${levelGuidance(ctx.level, ctx.courseType)}

Vocabulary in this lesson:
${vocabBlock}

Example sentences in this lesson:
${exampleBlock}

STYLE:
- At most 80 words. Short friendly sentences.
- Chinese characters + pinyin (with tone marks) + English meaning.
- If the question is not about this lesson or its words, say kindly that
  you can only help with this lesson's Chinese, and suggest asking a
  parent, teacher, or trying the Talk page.
- If the lesson data above does not contain the answer, say so honestly.
- Never invent that a word belongs to a YCT level.
${kidSafeRules}`
          },
          { role: 'user', content: fenceUserContent(question) }
        ]
      });

      markUsage(userId, 'lessonHelp');
      if (!answer.ok) {
        return res.json({
          success: true,
          reply: 'Panda is having a little rest right now 🐼💤 Try again in a moment!',
          degraded: true, reason: answer.reason
        });
      }

      cacheSet(cacheKey, answer.text);
      return res.json({ success: true, reply: answer.text, provider: answer.provider, usage: usageSummary() });

    } catch (error) {
      console.error('❌ ai/lesson-help:', error.message);
      return fail(res, 500, 'Panda could not answer right now.');
    }
  });

  /* ============================================================
     2) QUIZ EXPLANATION — post-submission feedback ("why?")
     POST /ai/quiz-explain { lessonId, questionId, userAnswerIndex }
     The server reads the answer key from the DB, grades again,
     and only then asks Panda to explain. No keys leak pre-submit;
     XP/scoring are untouched (existing engine stays the judge).
  ============================================================ */
  router.post('/ai/quiz-explain', auth, async (req, res) => {
    try {
      const userId = req.authUser?.user_id;
      const body = req.body || {};
      const lessonId = String(body.lessonId || '').trim().slice(0, 40);
      const questionId = Number(body.questionId);
      const userAnswerIndex = Number(body.userAnswerIndex);

      if (!lessonId || !questionId || Number.isNaN(userAnswerIndex)) {
        return fail(res, 400, 'lessonId, questionId and userAnswerIndex are required.');
      }

      if (!underLimit(userId, 'quizExplain')) {
        return fail(res, 429, 'That is a lot of questions for one day! Try again tomorrow. 🐼');
      }

      const q = await pool.query(
        `SELECT question_text FROM lesson_quiz_questions
          WHERE question_id = $1 AND lesson_id = $2 LIMIT 1`,
        [questionId, lessonId]
      );
      if (!q.rows.length) return fail(res, 404, 'Question not found.');

      const o = await pool.query(
        `SELECT option_id, option_text, is_correct FROM lesson_quiz_options
          WHERE question_id = $1 ORDER BY order_index ASC, option_id ASC`,
        [questionId]
      );
      const options = o.rows;
      if (!options.length) return fail(res, 404, 'Question options not found.');

      /* The lesson client (lesson.html) identifies the chosen option by its
         DISPLAY index (button.dataset.option), with options sorted by
         (order_index, option_id) — the same order queried here. So the
         answer key comparison is index-based. */
      const correctIdx = options.findIndex(x => x.is_correct === true);
      const chosen = options[userAnswerIndex];
      const wasCorrect = userAnswerIndex >= 0 && correctIdx >= 0 && userAnswerIndex === correctIdx;

      const questionText = q.rows[0].question_text || '(question text unavailable)';

      /* Deterministic first: correct answers get instant praise, no AI needed. */
      if (wasCorrect) {
        markUsage(userId, 'quizExplain');
        return res.json({
          success: true,
          wasCorrect: true,
          explanation: 'Yes! 🎉 ' + (correctOpt.option_text || '') + ' is right. Nice work!',
          provider: 'deterministic'
        });
      }

      /* Wrong answer: AI explanation grounded in the real key. */
      const cacheKey = 'qe:' + hashKey(questionId + '|' + userAnswerIndex);
      const cached = cacheGet(cacheKey);
      if (cached) {
        markUsage(userId, 'quizExplain');
        return res.json({ success: true, wasCorrect: false, explanation: cached, cached: true });
      }

      const optionLines = options
        .map(x => `${x.is_correct ? '✓' : '•'} ${x.option_text}`)
        .join('\n');

      const answer = await aiChat({
        tier: 'fast',
        messages: [
          {
            role: 'system',
            content: `You are Panda 🐼 in a HanVerse lesson for a child learning Mandarin.
The child just answered a quiz question WRONGLY and you are explaining, kindly.

Question: ${questionText}
Options (✓ = correct):
${optionLines}

RULES:
- At most 60 words. Warm, never shaming.
- Say what the correct answer is and WHY, in very simple English.
- Add pinyin if Chinese characters are involved.
- Do not mention that you were given an answer key.
${kidSafeRules}`
          },
          { role: 'user', content: fenceUserContent(`I picked: ${chosen ? chosen.option_text : '(no answer)'}. Why is that not right?`) }
        ]
      });

      markUsage(userId, 'quizExplain');
      if (!answer.ok) {
        const fallback = 'Not quite — the right answer is "' + (correctOpt?.option_text || '?') + '". You will get the next one! 💪';
        return res.json({ success: true, wasCorrect: false, explanation: fallback, degraded: true });
      }

      cacheSet(cacheKey, answer.text);
      return res.json({ success: true, wasCorrect: false, explanation: answer.text, provider: answer.provider });

    } catch (error) {
      console.error('❌ ai/quiz-explain:', error.message);
      return fail(res, 500, 'Panda could not explain right now.');
    }
  });

  /* ============================================================
     3) PRACTICE SHEET — AI practice from approved lesson words.
     POST /ai/practice-sheet { lessonId, kind }
     kind: mcq | fill-blank | story
     Output is PRACTICE (clearly labelled), never curriculum.
     Validated against a strict schema; one corrective retry.
  ============================================================ */
  const KINDS = {
    'mcq': 5,
    'fill-blank': 5,
    'story': 1
  };

  router.post('/ai/practice-sheet', auth, async (req, res) => {
    try {
      const userId = req.authUser?.user_id;
      const body = req.body || {};
      const lessonId = String(body.lessonId || '').trim().slice(0, 40);
      const kind = KINDS.hasOwnProperty(body.kind) ? body.kind : 'mcq';

      if (!lessonId) return fail(res, 400, 'Lesson ID is required.');
      if (!underLimit(userId, 'practice')) {
        return fail(res, 429, 'Practice maker is out of ink for today! Come back tomorrow. 🐼');
      }

      const ctx = await lessonContext(lessonId);
      if (!ctx) return fail(res, 404, 'Lesson not found.');
      if (!ctx.vocabulary.length) return fail(res, 400, 'This lesson has no vocabulary to practise yet.');

      const vocabBlock = ctx.vocabulary
        .map(v => `${v.chinese} (${v.pinyin || '?'}) — ${v.english || '?'}`).join('\n');

      const schema =
        kind === 'story'
          ? `{"story":"a short story in simple Chinese + English","lines":[{"chinese":"...","pinyin":"...","english":"..."}],"questions":[{"q":"...","answer":"..."}]}`
          : `{"items":[{"question":"...","options":["a","b","c"],"answer":"full text of the correct option","pinyin":"... if used"}]}`;

      const count = KINDS[kind];
      const result = await askJSON({
        tier: 'json',
        system: `You create PRACTICE material for a child learning Mandarin in HanVerse.
Use ONLY the vocabulary below. Match the learner level.
${levelGuidance(ctx.level, ctx.courseType)}
${kidSafeRules}`,
        user: `Lesson: ${ctx.title}
Vocabulary (use only these):
${vocabBlock}

Create ${count} ${kind === 'story' ? 'a short story (3-6 lines) with ' + count + ' comprehension question(s)' : kind + ' practice items'}.
JSON schema: ${schema}
Every "answer" must be copied exactly from the options when options exist.
Do not use vocabulary outside the list.`,
        validate: (d) => {
          if (!d || typeof d !== 'object') return false;
          if (kind === 'story') {
            return typeof d.story === 'string' && d.story.length > 10
              && Array.isArray(d.questions) && d.questions.every(q => q && typeof q.q === 'string' && typeof q.answer === 'string');
          }
          return Array.isArray(d.items) && d.items.length > 0 && d.items.every(it =>
            it && typeof it.question === 'string' && it.question.length > 1
            && Array.isArray(it.options) && it.options.length >= 2
            && typeof it.answer === 'string' && it.options.includes(it.answer)
          );
        }
      });

      if (!result.ok) {
        return fail(res, 503, 'Practice maker is busy right now — try again soon.');
      }
      markUsage(userId, 'practice');

      return res.json({
        success: true,
        kind,
        lesson: { id: ctx.id, title: ctx.title, level: ctx.level },
        isDraftPractice: true,
        label: 'AI practice — generated from this lesson\'s words',
        data: result.data,
        provider: result.provider,
        usage: usageSummary()
      });

    } catch (error) {
      console.error('❌ ai/practice-sheet:', error.message);
      return fail(res, 500, 'Practice maker failed.');
    }
  });

  /* ============================================================
     4) ADMIN DRAFT TOOLS — admins only, drafts never auto-published
     POST /admin/ai/draft { lessonId, task }
     task: quiz | examples | comprehension
  ============================================================ */
  router.post('/admin/ai/draft', verifyAdminToken, async (req, res) => {
    try {
      const body = req.body || {};
      const lessonId = String(body.lessonId || '').trim().slice(0, 40);
      const task = ['quiz', 'examples', 'comprehension'].includes(body.task) ? body.task : 'quiz';
      if (!lessonId) return fail(res, 400, 'Lesson ID is required.');

      const ctx = await lessonContext(lessonId);
      if (!ctx) return fail(res, 404, 'Lesson not found.');
      const vocabBlock = ctx.vocabulary
        .map(v => `${v.chinese} (${v.pinyin || '?'}) — ${v.english || '?'}`).join('\n') || '(none)';

      const result = await askJSON({
        tier: 'admin',
        system: `You are a curriculum assistant for HanVerse teachers.
Draft material for lesson "${ctx.title}" (${ctx.courseType} level ${ctx.level}).
Use only the vocabulary listed. YCT-appropriate difficulty.
${kidSafeRules}`,
        user: `Vocabulary:
${vocabBlock}

Task: ${task === 'quiz' ? 'Draft 3 multiple-choice quiz questions.' : task === 'examples' ? 'Draft 4 example sentences.' : 'Draft 3 reading-comprehension questions for a short story you invent from these words.'}
JSON schema: ${task === 'examples' ? '{"items":[{"chinese":"...","pinyin":"...","english":"..."}]}' : '{"items":[{"question":"...","options":["a","b","c"],"answer":"exact text of correct option"}]}'}`,
        validate: (d) => d && Array.isArray(d.items) && d.items.length > 0
      });

      if (!result.ok) return fail(res, 503, 'Draft generation failed — try again.');
      markUsage('admin:' + (req.authUser?.user_id || 'x'), 'adminDraft');

      return res.json({
        success: true,
        isDraft: true,
        needsReview: true,
        label: 'DRAFT — admin review required before publishing',
        lesson: { id: ctx.id, title: ctx.title },
        task,
        data: result.data,
        provider: result.provider,
        usage: usageSummary()
      });

    } catch (error) {
      console.error('❌ admin/ai/draft:', error.message);
      return fail(res, 500, 'Draft generation failed.');
    }
  });

  /* ------------------------------------------------------------
     Observability: self-usage for the signed-in user.
     GET /ai/usage
  ------------------------------------------------------------ */
  router.get('/ai/usage', auth, (req, res) => {
    const userId = req.authUser?.user_id;
    const rec = usageFor(userId);
    return res.json({
      success: true,
      date: rec.date,
      limits: DAILY_LIMITS,
      used: rec.counts,
      instance: usageSummary()
    });
  });
}
