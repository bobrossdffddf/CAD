// Turns Whisper transcripts of radio traffic into structured CAD commands.
// Handles "seven adam twelve ten eight" -> { type: 'status', callsign: '7-ADAM-12', code: '10-8' }

import { config, TEN_CODES } from './config.js';

const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// LAPD + NATO phonetic alphabets (both are common in ERLC communities)
const PHONETIC = new Set([
  'adam','boy','charles','david','edward','frank','george','henry','ida','john','king','lincoln',
  'mary','nora','ocean','paul','queen','robert','sam','tom','union','victor','william','xray','young','zebra',
  'alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima',
  'mike','november','oscar','papa','quebec','romeo','sierra','tango','uniform','whiskey','yankee','zulu',
]);

// Convert spelled-out numbers to digits, keeping everything else as words.
function wordsToTokens(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      const next = words[i + 1];
      if (next in ONES && ONES[next] !== 0) { out.push(String(TENS[w] + ONES[next])); i++; }
      else out.push(String(TENS[w]));
    } else if (w in TEENS) out.push(String(TEENS[w]));
    else if (w in ONES) out.push(String(ONES[w]));
    else out.push(w);
  }
  return out;
}

// "10 8" / "10 dash 8" -> "10-8" when it matches a known ten-code
function joinTenCodes(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    let j = i + 1;
    if (tokens[j] === 'dash') j++;
    const b = tokens[j];
    if ((a === '10' || a === '11') && /^\d{1,2}$/.test(b ?? '') && TEN_CODES[`${a}-${b}`]) {
      out.push(`${a}-${b}`); i = j;
    } else out.push(a);
  }
  return out;
}

export function normalize(raw) {
  const text = raw.toLowerCase()
    .replace(/x-ray/g, 'xray')
    .replace(/[^a-z0-9\s-]/g, ' ')          // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
  // Split hyphenated tokens unless they're a known ten-code ("7-adam-12" -> "7 adam 12")
  const pre = [];
  for (const tok of text.split(' ')) {
    if (tok.includes('-') && !TEN_CODES[tok]) pre.push(...tok.split('-').filter(Boolean));
    else pre.push(tok);
  }
  return joinTenCodes(wordsToTokens(pre.join(' '))).join(' ');
}

// Greedily read a callsign at the start of `tokens`: mix of digits and phonetic words, e.g. "7 adam 12".
function readCallsign(tokens) {
  const parts = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (TEN_CODES[t]) break;                       // a ten-code ends the callsign
    if (/^\d{1,3}$/.test(t) || PHONETIC.has(t)) { parts.push(t); i++; }
    else break;
  }
  if (!parts.length || !parts.some(p => PHONETIC.has(p) || /^\d/.test(p))) return null;
  return { callsign: parts.map(p => p.toUpperCase()).join('-'), rest: tokens.slice(i) };
}

/**
 * Parse a normalized transcript. Returns null if the wake word is absent.
 * Command grammar (after "dispatch"):
 *   [this is] <callsign> [show me|showing] <10-code>     -> status
 *   [<callsign>] on scene | en route | code 4            -> status (mapped)
 *   new call [priority N] <description> [at <location>]  -> new_call
 *   attach|assign <callsign> to call <N>                 -> attach
 *   clear|close call <N>                                 -> close_call
 *   bolo <description>                                   -> bolo
 *   <10-code>                                            -> status for the speaker's linked unit
 */
export function parse(raw) {
  const text = normalize(raw);
  const tokens = text.split(' ').filter(Boolean);
  const wakeIdx = tokens.indexOf(config.wakeWord);
  if (wakeIdx === -1) return null;

  let rest = tokens.slice(wakeIdx + 1);
  if (rest[0] === 'this' && rest[1] === 'is') rest = rest.slice(2);
  const restStr = rest.join(' ');

  let m;
  if ((m = restStr.match(/^new call(?: priority (\d))? (.+?)(?: at (.+))?$/)))
    return { type: 'new_call', priority: m[1] ? Number(m[1]) : 3, description: m[2], location: m[3] || null };

  if ((m = restStr.match(/^(?:attach|assign) (.+?) to call (\d+)$/))) {
    const cs = readCallsign(m[1].split(' '));
    if (cs) return { type: 'attach', callsign: cs.callsign, callId: Number(m[2]) };
  }

  if ((m = restStr.match(/^(?:clear|close) call (\d+)$/)))
    return { type: 'close_call', callId: Number(m[1]) };

  if ((m = restStr.match(/^bolo (.+)$/)))
    return { type: 'bolo', description: m[1] };

  // status forms
  const cs = readCallsign(rest);
  const afterCs = cs ? cs.rest : rest;
  const afterStr = afterCs.join(' ').replace(/^(?:is |show me |showing |status )/, '');

  const PHRASE_CODES = [
    [/^on scene/, '10-23'],
    [/^en route|^enroute|^responding/, '10-97'],
    [/^code 4|^code four/, '10-8'],
    [/^traffic stop/, '10-11'],
    [/^in custody|^suspect in custody/, '10-15'],
  ];
  for (const [re, code] of PHRASE_CODES)
    if (re.test(afterStr)) return { type: 'status', callsign: cs?.callsign ?? null, code };

  const codeMatch = afterStr.match(/^(\d{2}-\d{1,2})/);
  if (codeMatch && TEN_CODES[codeMatch[1]])
    return { type: 'status', callsign: cs?.callsign ?? null, code: codeMatch[1] };

  return { type: 'unknown', text: restStr };
}
