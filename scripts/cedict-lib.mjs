/* CC-CEDICT parsing — pure functions, no database and no network.

   Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
   Licence: Creative Commons Attribution-ShareAlike 4.0 International
            https://creativecommons.org/licenses/by-sa/4.0/

   Line format:  Traditional Simplified [pin1 yin1] /sense one/sense two/
*/
import { plainPinyin } from '../functions/dictionary.js';

const VOWELS = 'aeiouüAEIOUÜ';
const MARKS = {
  a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ',
  A: 'ĀÁǍÀ', E: 'ĒÉĚÈ', I: 'ĪÍǏÌ', O: 'ŌÓǑÒ', U: 'ŪÚǓÙ', 'Ü': 'ǕǗǙǛ'
};

function markSyllable(syllable) {
  const match = /^([A-Za-zÜü:]+?)([1-5])$/.exec(syllable);
  if (!match) return syllable;
  const body = match[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
  const tone = Number(match[2]);
  if (tone === 5) return body;

  let at = -1;
  const lower = body.toLowerCase();
  if (lower.includes('a')) at = lower.indexOf('a');
  else if (lower.includes('e')) at = lower.indexOf('e');
  else if (lower.includes('ou')) at = lower.indexOf('o');
  else {
    for (let i = body.length - 1; i >= 0; i--) {
      if (VOWELS.includes(body[i])) { at = i; break; }
    }
  }
  if (at < 0) return syllable;
  const ch = body[at];
  const marked = MARKS[ch] ? MARKS[ch][tone - 1] : ch;
  return body.slice(0, at) + marked + body.slice(at + 1);
}

export function numberedToMarked(numbered) {
  return String(numbered).trim().split(/\s+/).map(markSyllable).join(' ');
}

function convertBracketedPinyin(text) {
  return text.replace(/\[([^\]]+)\]/g, (_all, inner) => `[${numberedToMarked(inner)}]`);
}

const LINE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;

export function parseCedictLine(line) {
  if (!line || line.startsWith('#')) return null;
  const match = LINE.exec(line);
  if (!match) return null;
  const [, traditional, simplified, numbered, rawSenses] = match;
  const senses = rawSenses.split('/').map(s => s.trim()).filter(Boolean).map(convertBracketedPinyin);
  if (!senses.length) return null;
  const pinyin = numberedToMarked(numbered);
  return {
    hanzi: simplified,
    traditional: traditional !== simplified ? traditional : null,
    pinyin,
    pinyinPlain: plainPinyin(pinyin),
    meaning: senses.join('; ')
  };
}

/* Merges lines that share the same simplified form and the same reading, so
   (hanzi, pinyin) is unique. Different readings stay as separate rows. */
export function parseCedict(text) {
  const byKey = new Map();
  let lines = 0;
  let skipped = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    lines++;
    const entry = parseCedictLine(line);
    if (!entry) { skipped++; continue; }
    const key = `${entry.hanzi}\u0000${entry.pinyin}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry, traditionalForms: entry.traditional ? [entry.traditional] : [] });
      continue;
    }
    if (!existing.meaning.split('; ').includes(entry.meaning)) {
      existing.meaning = `${existing.meaning}; ${entry.meaning}`;
    }
    if (entry.traditional && !existing.traditionalForms.includes(entry.traditional)) {
      existing.traditionalForms.push(entry.traditional);
    }
  }
  const entries = [...byKey.values()].map(({ traditionalForms, ...rest }) => ({
    ...rest,
    traditional: traditionalForms.length ? traditionalForms.join('/') : null
  }));
  return { entries, lines, skipped };
}
