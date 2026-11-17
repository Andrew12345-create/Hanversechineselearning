// E2E acceptance for Phase 2 classrooms (run against local server):
//   node scripts/e2e-classroom.cjs
// Walks: teacher create -> student join -> quest progress -> roster ->
// aggregate -> outsider privacy checks -> teacher removes member ->
// student re-join + self-leave. Exits non-zero on any failed expectation.
'use strict';
const BASE = process.env.E2E_BASE || 'http://localhost:4001';
const PASS = 'HvE2e-Test2026!';

let failures = 0;
const check = (name, cond, extra) => {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${mark}  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
};

async function call(method, path, token, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON */ }
  return { status: res.status, json };
}

async function login(email) {
  const r = await call('POST', '/login', null, { email, password: PASS });
  if (r.status !== 200) throw new Error('login failed for ' + email + ': ' + JSON.stringify(r.json));
  return r.json.token;
}

(async () => {
  const teacherTok = await login('hv_teacher_e2e@test.hanverse');
  const studentTok = await login('hv_student_e2e@test.hanverse');
  const outsiderTok = await login('hv_outsider_e2e@test.hanverse');
  check('all three accounts log in', true);

  // Unauthenticated request is rejected
  const noAuth = await call('GET', '/classroom/mine', null);
  check('unauthenticated /classroom/mine -> 401', noAuth.status === 401, noAuth.status);

  // Student cannot create a class (teacher gate)
  const studentCreate = await call('POST', '/classroom/create', studentTok, { className: 'Nope Class' });
  check('student cannot create a class (403)', studentCreate.status === 403, studentCreate.status);

  // Teacher creates a class
  const created = await call('POST', '/classroom/create', teacherTok, { className: 'E2E Panda Class' });
  check('teacher creates class', created.status === 200 && created.json.classCode, created.json.classCode);
  const code = created.json.classCode;

  // Student joins with the code
  const joined = await call('POST', '/classroom/join', studentTok, { classCode: code });
  check('student joins with class code', joined.status === 200, joined.json && joined.json.className);

  // Teacher sets the class quest (YCT 1 Lesson 3 target)
  const quest = await call('POST', '/classroom/quest', teacherTok, {
    classCode: code,
    title: 'Everyone finish YCT 1 Lesson 3 this week',
    targetLessonId: 'lesson_3',
    targetLevel: 1
  });
  check('teacher sets class quest', quest.status === 200 && quest.json.quest, quest.json.quest && quest.json.quest.title);

  // Student cannot set a quest
  const badQuest = await call('POST', '/classroom/quest', studentTok, { classCode: code, title: 'x' });
  check('student cannot set a quest (403)', badQuest.status === 403, badQuest.status);

  // Quest progress: 1 member, 0 done yet
  const qp = await call('GET', '/classroom/quest-progress/' + code, teacherTok);
  check('quest progress members=1 done=0',
    qp.status === 200 && qp.json.progress.members === 1 && qp.json.progress.done === 0,
    qp.json.progress);

  // Roster visible to teacher and member
  const rosterT = await call('GET', '/classroom/roster/' + code, teacherTok);
  const rosterS = await call('GET', '/classroom/roster/' + code, studentTok);
  check('teacher sees roster of 1', rosterT.status === 200 && rosterT.json.students.length === 1);
  check('member sees roster of 1', rosterS.status === 200 && rosterS.json.students.length === 1);
  check('roster exposes only safe fields',
    rosterT.json.students.every(s => !('email' in s) && !('class_code' in s)));

  // Aggregate shows totals only
  const agg = await call('GET', '/classroom/aggregate/' + code, teacherTok);
  check('aggregate has lessons/xp/streak totals',
    agg.status === 200 && 'lessons_completed' in agg.json.aggregate &&
    'total_xp' in agg.json.aggregate && 'streak_days' in agg.json.aggregate &&
    !('students' in agg.json.aggregate), agg.json.aggregate);

  // Outsider sees nothing
  const outRoster = await call('GET', '/classroom/roster/' + code, outsiderTok);
  const outAgg = await call('GET', '/classroom/aggregate/' + code, outsiderTok);
  const outQP = await call('GET', '/classroom/quest-progress/' + code, outsiderTok);
  const badJoin = await call('POST', '/classroom/join', outsiderTok, { classCode: 'HVDOESNOTEXIST' });
  check('outsider roster -> 403', outRoster.status === 403, outRoster.status);
  check('outsider aggregate -> 403', outAgg.status === 403, outAgg.status);
  check('outsider quest-progress -> 403', outQP.status === 403, outQP.status);
  check('joining a bad code -> 404', badJoin.status === 404, badJoin.status);

  // Student marks the quest lesson complete through the real progress route,
  // then quest progress updates.
  const prog = await call('POST', '/progress', studentTok, {
    userId: 95, lessonId: 'lesson_3', courseType: 'YCT', courseLevel: 1,
    completed: true, score: 90, xpEarned: 10, timeSpent: 60, attempts: 1,
    quizAnswers: [], quizScore: 90
  });
  console.log('INFO progress write status:', prog.status, JSON.stringify(prog.json).slice(0, 120));
  const qp2 = await call('GET', '/classroom/quest-progress/' + code, teacherTok);
  check('quest progress updates to done=1',
    qp2.status === 200 && qp2.json.progress.done === 1, qp2.json.progress);

  // Teacher removes the member
  const removed = await call('POST', '/classroom/remove-member', teacherTok, { classCode: code, targetUserId: 95 });
  check('teacher removes member', removed.status === 200, removed.status);
  const roster2 = await call('GET', '/classroom/roster/' + code, teacherTok);
  check('roster empty after removal', roster2.json.students.length === 0);

  // Student re-joins and leaves on their own
  await call('POST', '/classroom/join', studentTok, { classCode: code });
  const left = await call('POST', '/classroom/leave', studentTok, {});
  check('student leaves class', left.status === 200, left.status);

  // Teacher overview lists the class with member count
  const mine = await call('GET', '/classroom/mine', teacherTok);
  check('teacher overview lists class', mine.status === 200 &&
    mine.json.classes.some(c => c.class_code === code), mine.json.classes && mine.json.classes.length);

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
