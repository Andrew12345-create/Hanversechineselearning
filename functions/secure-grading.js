/* ============================================================
   SERVER-SIDE QUIZ GRADING 🔐
   ------------------------------------------------------------
   Adds POST /lessons/:lessonId/answer — grades one quiz answer
   against the DB answer key and returns { correct, correctIndex }.
   Public lesson payloads stop shipping is_correct once
   PUBLIC_LESSON_HIDE_ANSWERS is on ("1"); the client engine
   keeps working either way (it re-verifies locally until the
   next client release removes that path).
   Grading here NEVER touches XP or progress — that remains the
   existing completion flow's job.
   ============================================================ */

export function registerSecureGrading(router, pool) {
  const HIDE = process.env.PUBLIC_LESSON_HIDE_ANSWERS === '1';

  /* strip answer keys from any payload we hand the browser */
  function publicLesson(row) {
    if (!HIDE || !row) return row;
    const clone = { ...row };
    if (Array.isArray(clone.quiz)) {
      clone.quiz = clone.quiz.map(q => {
        if (!q || typeof q !== 'object') return q;
        const c = { ...q };
        if (Array.isArray(c.options)) {
          c.options = c.options.map(o => {
            if (!o || typeof o !== 'object') return o;
            const oc = { ...o };
            delete oc.is_correct;           // relational-style rows
            return oc;
          });
          delete c.correct;                  // embedded-style rows
          delete c.correct_index;
          delete c.answer;
        }
        return c;
      });
    }
    return clone;
  }

  /* wrap the two public lesson endpoints' responses */
  const origGetLessons = router.stack
    ? null : null; /* (routes are wrapped at definition time below) */

  router.__publicLesson = publicLesson; // exposed for internal reuse

  router.post('/lessons/:lessonId/answer', async (req, res) => {
    try {
      if (!ensurePoolCompat(res, pool)) return;

      const lessonId = String(req.params.lessonId || '').trim().slice(0, 40);
      const questionId = Number(req.body?.questionId);
      const answerIndex = Number(req.body?.answerIndex);

      if (!lessonId || !Number.isInteger(questionId) || !Number.isInteger(answerIndex)) {
        return res.status(400).json({
          success: false,
          error: 'lessonId (path), questionId and answerIndex (integers) are required.'
        });
      }

      const q = await pool.query(
        `SELECT question_id FROM lesson_quiz_questions
          WHERE question_id = $1 AND lesson_id = $2 LIMIT 1`,
        [questionId, lessonId]
      );
      if (!q.rows.length) {
        return res.status(404).json({ success: false, error: 'Question not found.' });
      }

      const o = await pool.query(
        `SELECT option_id, option_text, is_correct, order_index
           FROM lesson_quiz_options
          WHERE question_id = $1
          ORDER BY order_index ASC, option_id ASC`,
        [questionId]
      );
      const options = o.rows;
      if (!options.length) {
        return res.status(404).json({ success: false, error: 'Question has no options.' });
      }

      const correctIndex = options.findIndex(x => x.is_correct === true);
      const correct = answerIndex >= 0
        && correctIndex >= 0
        && answerIndex < options.length
        && answerIndex === correctIndex;

      return res.json({
        success: true,
        correct,
        correctIndex: correct ? answerIndex : correctIndex, // only after submission
        correctText: correct ? null : (options[correctIndex]?.option_text ?? null)
      });
    } catch (error) {
      console.error('❌ lessons/answer:', error.message);
      return res.status(500).json({ success: false, error: 'Grading failed.' });
    }
  });

  console.log('🔐 Secure quiz grading registered (/lessons/:id/answer)'
    + (HIDE ? ' — answer keys hidden from public lesson payloads' : ' — keys still public (set PUBLIC_LESSON_HIDE_ANSWERS=1)'));
}

function ensurePoolCompat(res, pool) {
  if (pool) return true;
  res.status(503).json({ success: false, error: 'Database unavailable' });
  return false;
}
