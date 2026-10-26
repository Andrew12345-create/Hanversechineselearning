/* ============================================================
   AI-ENHANCED PARENT DIGEST 📧🧠
   ------------------------------------------------------------
   upgradeParentDigestEmail(rows) — takes the REAL weekly stats
   rows already computed by the /parents/digest/send flow
   ([{name, weeklyXp, lessons, streakDays}, ...]) and returns a
   short friendly paragraph for the email. Grounded strictly in
   the provided numbers (never invents history). Falls back to
   a deterministic paragraph when the AI is unavailable.
   ============================================================ */

import { aiChat } from './ai-helpers.js';

export async function upgradeParentDigestEmail(rows) {
  const facts = rows.map(r =>
    `${r.name}: ${r.weeklyXp} XP this week, ${r.lessons} lesson${r.lessons === 1 ? '' : 's'} completed, ${r.streakDays} day streak`
  ).join('\n');

  const deterministic =
    "Here's how your learner did this week:\n" +
    rows.map(r =>
      `• ${r.name}: ${r.weeklyXp} XP, ${r.lessons} lesson${r.lessons === 1 ? '' : 's'}, ${r.streakDays}-day streak`
    ).join('\n') +
    "\nA few minutes of practice a few times a week keeps the streak (and the learning) alive!";

  try {
    const r = await aiChat({
      tier: 'fast',
      maxTokens: 160,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `You write the warm opening paragraph of a weekly learning digest
email from HanVerse (a children's Mandarin app) to a PARENT.

STRICT RULES:
- Use ONLY the statistics provided below. Never invent progress, lessons,
  XP, or dates that are not in the data.
- 2-3 friendly sentences. Practical, encouraging, never pushy.
- If a child's numbers are low, be gentle and suggest a small next step
  (e.g. one short lesson). No shaming.
- Do not include data tables in your reply — the email adds its own.
- Plain text only (no markdown).`
        },
        {
          role: 'user',
          content: `This week's real stats:\n${facts}\n\nWrite the digest opening paragraph.`
        }
      ]
    });

    if (r.ok && r.text && r.text.length > 20 && r.text.length < 900) return r.text;
    return deterministic;
  } catch {
    return deterministic;
  }
}
