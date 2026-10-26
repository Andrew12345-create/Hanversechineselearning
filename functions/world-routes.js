import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

const STORYBOOK = {
  market: {
    title: 'HanPan at the Night Market', icon: '🏮', level: 1,
    summary: 'Help HanPan choose a tasty snack and greet a new friend.',
    chapters: [
      { scene: 'Lanterns glow above the market. HanPan sees a fruit seller.', line: 'HanPan: 你好！', question: 'What is a friendly reply?', hint: 'Say hello back.', choices: [['hello', '你好！'], ['bye', '再见。'], ['thanks', '不客气。']], answer: 'hello' },
      { scene: 'The seller points to a basket of apples.', line: 'Seller: 你喜欢苹果吗？', question: 'Which answer means “Yes, I like apples”?', hint: '我喜欢 means “I like”.', choices: [['like', '我喜欢苹果。'], ['water', '我要水。'], ['rice', '这是米饭。']], answer: 'like' },
      { scene: 'HanPan finds a little coin purse and returns it to its owner.', line: 'Friend: 谢谢你！', question: 'What can HanPan say?', hint: 'A polite reply to thanks.', choices: [['welcome', '不客气！'], ['morning', '早上好！'], ['name', '你叫什么名字？']], answer: 'welcome' }
    ]
  },
  festival: {
    title: 'The Lantern Festival', icon: '🏮', level: 2,
    summary: 'Follow clues, practise colours, and light the biggest lantern.',
    chapters: [
      { scene: 'A puzzle card is tied to a red lantern.', line: '谜语：我是什么颜色？', question: 'Which word means red?', hint: 'Look for the word with 色.', choices: [['red', '红色'], ['blue', '蓝色'], ['green', '绿色']], answer: 'red' },
      { scene: 'A child asks HanPan to count three lanterns.', line: '孩子：有几个灯笼？', question: 'How do you say three?', hint: '三 is the number three.', choices: [['three', '三个'], ['two', '两个'], ['five', '五个']], answer: 'three' },
      { scene: 'The lanterns are ready. Everyone asks where to meet.', line: '朋友：我们在哪里见面？', question: 'Which answer means “Meet at the park”?', hint: '公园 means park.', choices: [['park', '在公园见面。'], ['home', '我喜欢苹果。'], ['school', '今天星期一。']], answer: 'park' }
    ]
  },
  rescue: {
    title: 'The Little Panda Rescue', icon: '🐼', level: 3,
    summary: 'Use clear Mandarin clues to help a lost panda find its family.',
    chapters: [
      { scene: 'A tiny panda is waiting beside a bamboo path.', line: '小熊猫：我找不到妈妈。', question: 'What does the panda say?', hint: '找不到 means cannot find.', choices: [['lost', 'I cannot find my mother.'], ['hungry', 'I would like some water.'], ['happy', 'Today is very sunny.']], answer: 'lost' },
      { scene: 'A forest guide asks when the panda last saw its family.', line: '向导：你在哪里看见妈妈？', question: 'Which answer means “Near the river”?', hint: '河边 means beside the river.', choices: [['river', '在河边。'], ['mountain', '我正在吃饭。'], ['school', '他每天早上跑步。']], answer: 'river' },
      { scene: 'The family is found. The guide gives the panda a warm blanket.', line: '向导：你现在安全了。', question: 'How can we say “Thank you for helping me”?', hint: '帮助 means help.', choices: [['thank', '谢谢你帮助我。'], ['question', '图书馆在哪里？'], ['weather', '明天会下雨。']], answer: 'thank' }
    ]
  }
};

const MOCKS = {
  1: [
    ['m1', '你好 means…', [['a','Hello'],['b','Goodbye'],['c','Please'],['d','Sorry']], 'a'],
    ['m2', 'Which character means “I / me”?', [['a','你'],['b','我'],['c','他'],['d','她']], 'b'],
    ['m3', '谢谢 means…', [['a','Good morning'],['b','Excuse me'],['c','Thank you'],['d','Goodbye']], 'c'],
    ['m4', 'Which number is 三?', [['a','1'],['b','2'],['c','3'],['d','4']], 'c'],
    ['m5', '再见 means…', [['a','See you'],['b','Welcome'],['c','Good night'],['d','I am fine']], 'a']
  ],
  2: [
    ['m1', '红色 is which colour?', [['a','Blue'],['b','Green'],['c','Red'],['d','Yellow']], 'c'],
    ['m2', '我喜欢吃米饭 means…', [['a','I like to eat rice'],['b','I drink tea'],['c','I see a panda'],['d','I go to school']], 'a'],
    ['m3', '妈妈 means…', [['a','Father'],['b','Mother'],['c','Teacher'],['d','Friend']], 'b'],
    ['m4', 'Which phrase asks “How old are you?”', [['a','你叫什么名字？'],['b','你几岁？'],['c','你好吗？'],['d','你去哪儿？']], 'b'],
    ['m5', '星期一 is…', [['a','Monday'],['b','Friday'],['c','Sunday'],['d','Tuesday']], 'a']
  ],
  3: [
    ['m1', '我每天坐公共汽车去学校 means…', [['a','I take the bus to school every day'],['b','I walk home at night'],['c','I like reading books'],['d','I play football on Sunday']], 'a'],
    ['m2', '图书馆 is a…', [['a','Restaurant'],['b','Library'],['c','Hospital'],['d','Station']], 'b'],
    ['m3', 'Which word means “because”?', [['a','所以'],['b','但是'],['c','因为'],['d','如果']], 'c'],
    ['m4', '我比哥哥高 means…', [['a','My older brother is taller than me'],['b','I am taller than my older brother'],['c','We are the same age'],['d','My brother is at school']], 'b'],
    ['m5', '请问，洗手间在哪里？ asks…', [['a','Where is the restroom?'],['b','What time is it?'],['c','How much is it?'],['d','What is your name?']], 'a']
  ],
  4: [
    ['m1', '虽然今天下雨，但是我们还是去公园了 means…', [['a','Although it rained, we still went to the park'],['b','It was sunny so we stayed home'],['c','We went to school before the rain'],['d','We will visit the park tomorrow']], 'a'],
    ['m2', '如果你有时间，我们一起去看电影吧 means…', [['a','If you have time, let’s go see a movie together'],['b','I watched a movie yesterday'],['c','The movie starts at seven'],['d','You should finish your homework']], 'a'],
    ['m3', '除了中文以外，她还会说英文 means…', [['a','She only speaks Chinese'],['b','Besides Chinese, she can also speak English'],['c','She is learning to write'],['d','She speaks more slowly']], 'b'],
    ['m4', '请把这本书放在桌子上 means…', [['a','Please put this book on the table'],['b','Please buy a book at the store'],['c','The table is beside the book'],['d','I read the book on the bus']], 'a'],
    ['m5', '他已经做完作业了 means…', [['a','He has already finished his homework'],['b','He forgot his homework'],['c','He is starting his homework'],['d','He wants more homework']], 'a']
  ]
};

// Distinct HSK practice set: the same course selector must not relabel YCT
// questions as HSK. These are original HanVerse checkpoints, not official papers.
const HSK_MOCKS = {
  1: [
    ['h1-1', '我 means…', [['a','I / me'],['b','you'],['c','he'],['d','we']], 'a'],
    ['h1-2', 'Which word means “teacher”?', [['a','学生'],['b','老师'],['c','朋友'],['d','医生']], 'b'],
    ['h1-3', 'Which number is 七?', [['a','5'],['b','6'],['c','7'],['d','8']], 'c'],
    ['h1-4', '你好吗？ is asking…', [['a','What is your name?'],['b','How are you?'],['c','Where are you going?'],['d','How old are you?']], 'b'],
    ['h1-5', '再见 means…', [['a','Good morning'],['b','Thank you'],['c','Goodbye'],['d','Please']], 'c']
  ],
  2: [
    ['h2-1', '昨天 means…', [['a','tomorrow'],['b','yesterday'],['c','today'],['d','weekend']], 'b'],
    ['h2-2', '我觉得这本书很有意思 means…', [['a','I think this book is interesting'],['b','I bought a new book'],['c','I finished reading today'],['d','This book is too difficult']], 'a'],
    ['h2-3', '因为下雨，所以我坐车去学校 expresses…', [['a','a choice'],['b','a reason and result'],['c','a question'],['d','a comparison']], 'b'],
    ['h2-4', 'Which phrase asks for the price?', [['a','你住在哪里？'],['b','现在几点？'],['c','这个多少钱？'],['d','你喜欢什么？']], 'c'],
    ['h2-5', '我比妹妹高 means…', [['a','My younger sister is taller than me'],['b','I am taller than my younger sister'],['c','We are the same height'],['d','I am younger than my sister']], 'b']
  ],
  3: [
    ['h3-1', '我已经学了两年中文 means…', [['a','I have studied Chinese for two years'],['b','I will study Chinese next year'],['c','I studied Chinese twice today'],['d','I have two Chinese books']], 'a'],
    ['h3-2', '终于 means…', [['a','carefully'],['b','finally'],['c','immediately'],['d','usually']], 'b'],
    ['h3-3', '如果明天下雨，我们就不去公园 means…', [['a','We went to the park yesterday'],['b','It is raining at the park'],['c','If it rains tomorrow, we will not go to the park'],['d','We will go to the park after school']], 'c'],
    ['h3-4', '打算 is closest in meaning to…', [['a','to plan to'],['b','to forget'],['c','to arrive'],['d','to borrow']], 'a'],
    ['h3-5', '请把这张桌子搬到房间里 asks someone to…', [['a','clean the room'],['b','move the table into the room'],['c','open the window'],['d','put a book on the table']], 'b']
  ],
  4: [
    ['h4-1', '尽管很累，他还是把作业做完了 means…', [['a','Although tired, he still finished his homework'],['b','He was tired because he forgot his homework'],['c','He finished before he became tired'],['d','He asked someone else to do his homework']], 'a'],
    ['h4-2', '只要你认真练习，就会慢慢进步 expresses…', [['a','a condition and result'],['b','a past event'],['c','a contrast'],['d','a comparison']], 'a'],
    ['h4-3', '负责这个项目 means…', [['a','to cancel the project'],['b','to be responsible for this project'],['c','to explain the project'],['d','to finish the project early']], 'b'],
    ['h4-4', '讨论问题以后，我们决定先休息一会儿 means…', [['a','We discussed the problem, then decided to rest for a while'],['b','We rested before discussing the problem'],['c','We decided not to discuss the problem'],['d','We finished the project without a break']], 'a'],
    ['h4-5', '无论遇到什么困难，他都没有放弃 means…', [['a','He gave up when he met a difficulty'],['b','No matter what difficulty he met, he did not give up'],['c','He avoided every difficult task'],['d','He asked a friend to solve everything']], 'b']
  ]
};

const mockQuestions = (course, level) => (course === 'HSK' ? HSK_MOCKS : MOCKS)[level];

const DECOR = [
  { id: 'bamboo', name: 'Bamboo Garden', emoji: '🎋', at: 0, slot: 'garden' },
  { id: 'pond', name: 'Lily Pond', emoji: '🪷', at: 100, slot: 'garden' },
  { id: 'lantern', name: 'Festival Lanterns', emoji: '🏮', at: 250, slot: 'sky' },
  { id: 'cloud', name: 'Lucky Clouds', emoji: '☁️', at: 500, slot: 'sky' },
  { id: 'tea', name: 'Tea House', emoji: '🫖', at: 1000, slot: 'home' },
  { id: 'pagoda', name: 'Moon Pagoda', emoji: '🏯', at: 2000, slot: 'home' },
  { id: 'fireflies', name: 'Golden Fireflies', emoji: '✨', at: 3500, slot: 'sky' },
  { id: 'bamboo-house', name: 'Bamboo House', emoji: '🏡', at: 5000, slot: 'home' }
];

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const ok = (res, data) => res.json({ success: true, ...data });

export function registerWorldRoutes(router, pool, { requireUser } = {}) {
  if (!pool || typeof requireUser !== 'function') throw new Error('HanVerse World routes require the shared pool and authenticator.');
  const limiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
  const auth = (req, res, next) => {
    Promise.resolve(requireUser(req, res)).then(user => {
      if (!user) return;
      req.worldUserId = Number(user.user_id);
      if (!Number.isInteger(req.worldUserId) || req.worldUserId < 1) return fail(res, 401, 'Please sign in again.');
      next();
    }).catch(error => {
      console.error('world auth:', error.message);
      if (!res.headersSent) fail(res, 500, 'Authentication failed.');
    });
  };
  let schemaPromise;
  const ensureSchema = () => schemaPromise ||= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS hanverse_story_progress (
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      story_key VARCHAR(30) NOT NULL,
      chapter INTEGER NOT NULL,
      best_score INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, story_key, chapter)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS hanverse_mock_attempts (
      attempt_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      course_type VARCHAR(8) NOT NULL,
      course_level INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hanverse_mock_best ON hanverse_mock_attempts(user_id, course_type, course_level, score DESC)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS hanverse_habitat (
      user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      layout JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  })().catch(error => { schemaPromise = null; throw error; });

  router.get('/world/state', auth, async (req, res) => {
    try {
      await ensureSchema();
      const userId = req.worldUserId;
      const [user, stories, mocks, habitat] = await Promise.all([
        pool.query('SELECT xp FROM users WHERE user_id = $1', [userId]),
        pool.query('SELECT story_key, chapter, best_score FROM hanverse_story_progress WHERE user_id = $1', [userId]),
        pool.query(`SELECT DISTINCT ON (course_type, course_level) course_type, course_level, score, total
                    FROM hanverse_mock_attempts WHERE user_id=$1
                    ORDER BY course_type, course_level, score DESC, created_at DESC`, [userId]),
        pool.query('SELECT layout FROM hanverse_habitat WHERE user_id=$1', [userId])
      ]);
      if (!user.rows.length) return fail(res, 404, 'Learner not found.');
      const xp = Number(user.rows[0].xp) || 0;
      return ok(res, {
        xp,
        stories: stories.rows,
        bestMocks: mocks.rows,
        decor: DECOR.map(item => ({ ...item, unlocked: xp >= item.at })),
        habitat: habitat.rows[0]?.layout || {}
      });
    } catch (error) {
      console.error('world state:', error.message);
      return fail(res, 500, 'Could not load your HanVerse World.');
    }
  });

  router.get('/world/review-calendar', auth, async (req, res) => {
    try {
      await ensureSchema();
      const rows = await pool.query(`
        SELECT CASE WHEN due_at::date < CURRENT_DATE THEN 'overdue'
                    ELSE to_char(due_at::date, 'YYYY-MM-DD') END AS day,
               COUNT(*)::int AS cards
        FROM review_queue
        WHERE user_id=$1 AND due_at < CURRENT_DATE + INTERVAL '7 days'
        GROUP BY 1 ORDER BY 1`, [req.worldUserId]);
      return ok(res, { days: rows.rows });
    } catch (error) {
      console.error('world review calendar:', error.message);
      return fail(res, 500, 'Could not load the review planner.');
    }
  });

  router.get('/world/stories', auth, async (req, res) => {
    try {
      await ensureSchema();
      const completed = await pool.query('SELECT story_key, chapter, best_score FROM hanverse_story_progress WHERE user_id=$1', [req.worldUserId]);
      return ok(res, { stories: Object.entries(STORYBOOK).map(([id, story]) => ({ id, title: story.title, icon: story.icon, level: story.level, summary: story.summary, chapters: story.chapters.length, progress: completed.rows.filter(row => row.story_key === id) })) });
    } catch (error) {
      console.error('world stories:', error.message);
      return fail(res, 500, 'Could not load adventures.');
    }
  });

  router.get('/world/stories/:storyKey/:chapter', auth, (req, res) => {
    const story = STORYBOOK[req.params.storyKey];
    const chapterIndex = Number(req.params.chapter);
    if (!story || !Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= story.chapters.length) return fail(res, 404, 'Adventure chapter not found.');
    const chapter = story.chapters[chapterIndex];
    return ok(res, { id: req.params.storyKey, title: story.title, icon: story.icon, level: story.level, chapter: chapterIndex, total: story.chapters.length, scene: chapter.scene, line: chapter.line, question: chapter.question, hint: chapter.hint, choices: chapter.choices.map(([id, text]) => ({ id, text })) });
  });

  router.post('/world/stories/:storyKey/:chapter/complete', auth, limiter, async (req, res) => {
    const story = STORYBOOK[req.params.storyKey];
    const chapterIndex = Number(req.params.chapter);
    if (!story || !Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= story.chapters.length) return fail(res, 404, 'Adventure chapter not found.');
    const chapter = story.chapters[chapterIndex];
    const choice = String(req.body?.choice || '');
    if (!chapter.choices.some(([id]) => id === choice)) return fail(res, 400, 'Choose one of the story answers.');
    try {
      await ensureSchema();
      const client = await pool.connect();
      let earnedXp = 0;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [req.worldUserId, `${req.params.storyKey}:${chapterIndex}`]);
        const correct = choice === chapter.answer;
        if (correct) {
          const inserted = await client.query(`INSERT INTO hanverse_story_progress (user_id,story_key,chapter,best_score)
            VALUES ($1,$2,$3,100) ON CONFLICT (user_id,story_key,chapter) DO NOTHING RETURNING chapter`,
            [req.worldUserId, req.params.storyKey, chapterIndex]);
          if (inserted.rowCount) {
            earnedXp = 5;
            await client.query('UPDATE users SET xp=COALESCE(xp,0)+$1, updated_at=NOW() WHERE user_id=$2', [earnedXp, req.worldUserId]);
            await client.query('INSERT INTO xp_logs (user_id, amount, source) VALUES ($1,$2,$3)', [req.worldUserId, earnedXp, `story:${req.params.storyKey}:${chapterIndex + 1}`]);
          } else {
            await client.query(`UPDATE hanverse_story_progress SET best_score=GREATEST(best_score,100), completed_at=NOW()
                                WHERE user_id=$1 AND story_key=$2 AND chapter=$3`, [req.worldUserId, req.params.storyKey, chapterIndex]);
          }
        }
        await client.query('COMMIT');
        return ok(res, {
          correct,
          feedback: correct ? 'Great clue-solving! The adventure moves on.' : `Not quite—try again. ${chapter.hint}`,
          earnedXp,
          nextChapter: correct && chapterIndex + 1 < story.chapters.length ? chapterIndex + 1 : null,
          storyComplete: correct && chapterIndex + 1 === story.chapters.length
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    } catch (error) {
      console.error('world story completion:', error.message);
      return fail(res, 500, 'Could not save your story progress.');
    }
  });

  router.get('/world/mock/:course/:level', auth, (req, res) => {
    const course = String(req.params.course || '').toUpperCase();
    const level = Number(req.params.level);
    if (!['YCT', 'HSK'].includes(course) || !Number.isInteger(level) || level < 1 || level > 4) return fail(res, 400, 'Choose a YCT or HSK level from 1 to 4.');
    const questions = mockQuestions(course, level).map(([id, prompt, options]) => {
      const shuffled = options.map(([choiceId, text]) => ({ id: choiceId, text }));
      for (let i = shuffled.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      return { id, prompt, options: shuffled };
    });
    return ok(res, { course, level, questions, passingScore: 80 });
  });

  router.post('/world/mock/:course/:level/submit', auth, limiter, async (req, res) => {
    const course = String(req.params.course || '').toUpperCase();
    const level = Number(req.params.level);
    const answers = req.body?.answers;
    if (!['YCT', 'HSK'].includes(course) || !Number.isInteger(level) || level < 1 || level > 4) return fail(res, 400, 'Choose a YCT or HSK level from 1 to 4.');
    const questions = mockQuestions(course, level);
    if (!Array.isArray(answers) || answers.length !== questions.length) return fail(res, 400, 'Answer every mock-exam question.');
    const byId = new Map(questions.map(([id, , , correct]) => [id, correct]));
    const seen = new Set();
    for (const answer of answers) {
      if (!answer || !byId.has(String(answer.questionId)) || !['a','b','c','d'].includes(String(answer.choiceId)) || seen.has(String(answer.questionId))) return fail(res, 400, 'One or more exam answers are invalid.');
      seen.add(String(answer.questionId));
    }
    const correct = answers.reduce((score, answer) => score + (byId.get(String(answer.questionId)) === String(answer.choiceId) ? 1 : 0), 0);
    const total = questions.length;
    const score = Math.round(correct / total * 100);
    try {
      await ensureSchema();
      await pool.query('INSERT INTO hanverse_mock_attempts (user_id,course_type,course_level,score,total) VALUES ($1,$2,$3,$4,$5)', [req.worldUserId, course, level, score, total]);
      const answerKey = questions.map(([questionId, , options, correctChoiceId]) => ({
        questionId,
        correctChoiceId,
        correctText: options.find(([choiceId]) => choiceId === correctChoiceId)?.[1] || ''
      }));
      return ok(res, { correct, total, score, passed: score >= 80, answerKey, message: score >= 80 ? 'Wonderful work — you passed this practice room!' : 'Good practice. Review a few words and try again.' });
    } catch (error) {
      console.error('world mock submit:', error.message);
      return fail(res, 500, 'Could not save your practice result.');
    }
  });

  router.put('/world/habitat', auth, limiter, async (req, res) => {
    const layout = req.body?.layout;
    const slots = ['garden', 'sky', 'home'];
    if (!layout || typeof layout !== 'object' || Array.isArray(layout) || Object.keys(layout).some(slot => !slots.includes(slot))) return fail(res, 400, 'Choose habitat decorations for the available spaces.');
    try {
      await ensureSchema();
      const user = (await pool.query('SELECT xp FROM users WHERE user_id=$1', [req.worldUserId])).rows[0];
      if (!user) return fail(res, 404, 'Learner not found.');
      const xp = Number(user.xp) || 0;
      const allowed = new Set(DECOR.filter(item => xp >= item.at).map(item => item.id));
      const clean = {};
      for (const slot of slots) {
        const value = layout[slot] == null ? null : String(layout[slot]);
        if (value && !DECOR.some(item => item.id === value && item.slot === slot && allowed.has(value))) return fail(res, 403, 'Earn more XP to unlock that decoration.');
        clean[slot] = value;
      }
      await pool.query(`INSERT INTO hanverse_habitat (user_id,layout) VALUES ($1,$2::jsonb)
        ON CONFLICT (user_id) DO UPDATE SET layout=EXCLUDED.layout, updated_at=NOW()`, [req.worldUserId, JSON.stringify(clean)]);
      return ok(res, { layout: clean });
    } catch (error) {
      console.error('world habitat:', error.message);
      return fail(res, 500, 'Could not save your habitat.');
    }
  });

  console.log('✅ HanVerse World routes registered (stories, review planner, mock exams, habitat)');
}
