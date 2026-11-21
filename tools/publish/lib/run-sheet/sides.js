'use strict';
// A row's starting side on the run sheet: ally or foe. The first rule that applies wins:
//   (b) the GM's words: the Plan's ally words, then `as an ally` in the stat block;
//   (c) the vault's facts: the affiliation, then the note's relationships to this session's party;
//   (d) otherwise a foe.
// (The side the GM last set for a note is the page's own and is read before any of this.)
// `allyBy` tells the players' view how sure the sheet is: an inferred ally (`affiliation`,
// `relationships`) starts unseen unless `seenFrom` holds it.

const { edgesOf, targetRef } = require('../connections');
const { ontology } = require('../ontology');

// The Plan's words, whole words, case-insensitive. A who line takes these; the NPC Quick Reference
// row also takes a bare `ally` or `allies` (it is the Plan's own note on that person, where a who
// line's "ally" is as likely to be a rival's or a stranger's).
const WHO_WORDS = /\bwith the party\b|\bwith (?:the )?coalition\b|\bas an ally\b|\bon their side\b/i;
const QUICK_REF_WORDS = /\bwith the party\b|\bwith (?:the )?coalition\b|\bas an ally\b|\bon their side\b|\ballies\b|\bally\b/i;
const STATS_WORDS = /\bas an ally\b/i;
// An affiliation counts only when it names the party or holds one of these. "Allied with the Order"
// names neither.
const AFFILIATION = /\bloyal to (?:the )?party\b|\bthe party\b|\bcommitted ally\b/i;

// Tones come from the ontology's `tones` (and `tone_near`, which folds a near word into one of
// them), so the sheet keeps no list of its own. The approved lists differed from the ontology in
// three places, and the ontology wins:
//   - `fearful` and `tense` are negative in the ontology (the approved list left them at 0);
//   - `wary` is `cautious` in `tone_near`, and `cautious` is neutral, so a wary tie counts 0
//     (the approved list had it negative);
//   - `tone_near` folds in many more words (cordial, adversarial, suspicious...) than the list had.
const familyOf = new Map();
for (const [family, words] of Object.entries(ontology.tones)) for (const w of words) familyOf.set(w, family);
for (const [near, tone] of Object.entries(ontology.tone_near || {})) if (!familyOf.has(near) && familyOf.has(tone)) familyOf.set(near, familyOf.get(tone));
const SIGN = { positive: 1, negative: -1 };
const signOf = (tone) => SIGN[familyOf.get(String(tone || '').trim().toLowerCase())] || 0;

const found = (re, text) => { const m = re.exec(String(text || '')); return m ? m[0] : null; };

// The note's relationships to this session's party, summed: each one's `strength` (1 when it has
// none or an unusable one), signed by its tone. `resolve` turns a target name into a note path.
function relationshipsTotal(fm, partyNotes, resolve) {
  const party = new Set(partyNotes || []);
  let total = 0;
  for (const e of edgesOf(fm)) {
    const ref = targetRef(e.target);
    const note = ref.links > 1 || !ref.name || !resolve ? null : resolve(ref.name);
    if (!note || !party.has(note)) continue;
    const n = Number(e.strength);
    total += signOf(e.tone) * (Number.isFinite(n) && n > 0 ? n : 1);
  }
  return total;
}

function startingSide({ whoText = '', quickRefText = '', statsText = '', fm = {}, partyNotes = [], resolve = null } = {}) {
  const said = found(WHO_WORDS, whoText) || found(QUICK_REF_WORDS, quickRefText);
  if (said) return { ally: true, allyFrom: `the Plan: "${said.toLowerCase()}"`, allyBy: 'plan' };
  if (found(STATS_WORDS, statsText)) return { ally: true, allyFrom: 'the stat block: "as an ally"', allyBy: 'stats' };
  const aff = [].concat((fm && fm.affiliation) || []).filter((x) => typeof x === 'string');
  const held = found(AFFILIATION, aff.join('; '));
  if (held) return { ally: true, allyFrom: `affiliation: ${held.toLowerCase()}`, allyBy: 'affiliation' };
  const total = relationshipsTotal(fm, partyNotes, resolve);
  if (total > 0) return { ally: true, allyFrom: `relationships: +${total} with this party`, allyBy: 'relationships' };
  return { ally: false, allyFrom: null, allyBy: null };
}

module.exports = { startingSide };
