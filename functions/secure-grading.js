/* ============================================================
   SERVER-SIDE QUIZ GRADING 🔐
   ------------------------------------------------------------
   Adds an authenticated POST /lessons/:lessonId/answer route.
   It returns only whether the submitted option is correct; answer
   keys remain on the server. Progress and XP are verified separately.
   ============================================================ */

import rateLimit from 'express-rate-limit';

export function registerSecureGrading(router, pool, { requireUser } = {}) {
  if (typeof requireUser !== 'function') {
    throw new Error('Secure quiz grading requires the shared user authenticator.');
  }
  const answerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    keyGenerator: req => String(req.quizUserId),
    standardHeaders: true,
    legacyHeaders: false
  });
  const requireSession = (req, res, next) => {
    Promise.resolve(requireUser(req, res)).then(user => {
      if (!user) return;
      req.quizUserId = Number(user.user_id);
      if (!Number.isInteger(req.quizUserId) || req.quizUserId < 1) {
        return res.status(401).json({ success: false, error: 'Session expired — please sign in again.' });
      }
      next();
    }).catch(error => {
      console.error('Quiz grading auth:', error.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Authentication failed.' });
    });
  };

  router.post('/lessons/:lessonId/answer', requireSession, answerLimiter, async (req, res) => {
    try {
      if (!ensurePoolCompat(res, pool)) return;

      const lessonId = String(req.params.lessonId || '').trim().slice(0, 40);
      const questionId = Number(req.body?.questionId);
      const answerOptionId = Number(req.body?.answerOptionId);
      const answerOptionIds = req.body?.answerOptionIds;

      if (!lessonId || !Number.isInteger(questionId)) {
        return res.status(400).json({
          success: false, error: 'lessonId and questionId are required.'
        });
      }

      const q = await pool.query(
        `SELECT question_id, question_type FROM lesson_quiz_questions
          WHERE question_id = $1 AND lesson_id = $2 LIMIT 1`,
        [questionId, lessonId]
      );
      if (!q.rows.length) {
        return res.status(404).json({ success: false, error: 'Question not found.' });
      }

      const o = await pool.query(
        `SELECT option_id, is_correct, order_index
           FROM lesson_quiz_options
          WHERE question_id = $1
          ORDER BY order_index ASC, option_id ASC`,
        [questionId]
      );
      const options = o.rows;
      if (!options.length) {
        return res.status(404).json({ success: false, error: 'Question has no options.' });
      }

      let correct = false;
      if (q.rows[0].question_type === 'sentence_build') {
        if (!Array.isArray(answerOptionIds) || answerOptionIds.length !== options.length ||
            answerOptionIds.some(id => !Number.isInteger(Number(id))) ||
            new Set(answerOptionIds.map(Number)).size !== options.length) {
          return res.status(400).json({ success: false, error: 'Submit the complete sentence order.' });
        }
        const expected = options.slice().sort((a, b) =>
          Number(a.order_index) - Number(b.order_index) || Number(a.option_id) - Number(b.option_id)
        ).map(option => Number(option.option_id));
        const selected = answerOptionIds.map(Number);
        correct = selected.every((id, index) => id === expected[index]);
      } else {
        if (!Number.isInteger(answerOptionId)) {
          return res.status(400).json({ success: false, error: 'Choose an answer option.' });
        }
        correct = options.some(option =>
          Number(option.option_id) === answerOptionId && option.is_correct === true
        );
      }

      return res.json({ success: true, correct });
    } catch (error) {
      console.error('❌ lessons/answer:', error.message);
      return res.status(500).json({ success: false, error: 'Grading failed.' });
    }
  });

  console.log('🔐 Authenticated server-side quiz grading registered (/lessons/:id/answer)');
}

function ensurePoolCompat(res, pool) {
  if (pool) return true;
  res.status(503).json({ success: false, error: 'Database unavailable' });
  return false;
}
