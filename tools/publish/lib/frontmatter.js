// tools/publish/lib/frontmatter.js
const matter = require('gray-matter');

// The one way this tool splits a note into frontmatter and body.
//
// gray-matter called with no options caches by the note's exact text, and caches before
// it parses. A note whose YAML throws is therefore cached half-read: the next note with
// the same text (or the same note on a second scan in one process) comes back a silent
// "success" with empty data, and reads as a note with no `type:` instead of a broken
// one (#287). The cache also hands two identical notes the same `data` object. Passing
// options turns the cache off.
function parseNote(text) {
  return matter(text, {});
}

// One reading of the `%%` in a frontmatter string, the way the body's strip reads a line
// (processor.js obsidianComments): a `%%` opens a comment, the next `%%` closes it, one never
// closed hides the rest of the value, and a `%%` inside an inline code span (backticks) is
// literal text. Returns the text left and the kind of each stray opener: UNCLOSED for one
// that never closes, GLUED for one that closes but sits straight after a number.
function readPercent(value) {
  let kept = '';
  const strays = [];
  for (let i = 0; i < value.length;) {
    const ch = value[i];
    if (ch === '`') {
      let run = 1;
      while (value[i + run] === '`') run++;
      const close = new RegExp('(?<!`)`{' + run + '}(?!`)').exec(value.slice(i + run));
      const stop = close ? i + run + close.index + run : i + run;
      kept += value.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '%' && value[i + 1] === '%') {
      const close = value.indexOf('%%', i + 2);
      if (close === -1) { strays.push('UNCLOSED'); break; }
      if (gluedBefore(value, i)) strays.push('GLUED');
      i = close + 2;
      continue;
    }
    kept += ch;
    i++;
  }
  return { kept, strays };
}

// A `%%` comment in a frontmatter value is cut the way the body's is. Only strings are
// read, at any depth; a value that was nothing but a comment goes, and the space left where
// a comment sat is closed up. Run on the parsed data of a note the site is built from, so
// no output can print the marker or its words.
function cutValueComments(value) {
  if (typeof value === 'string') {
    if (!value.includes('%%')) return value;
    const { kept } = readPercent(value);
    return kept === value ? value : kept.replace(/ {2,}/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    return value.map(cutValueComments).filter((v, i) => v !== '' || value[i] === '');
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const cut = cutValueComments(v);
      if (cut !== '' || v === '') out[key] = cut;
    }
    return out;
  }
  return value;
}

// Whether the character just before `index` in `text` is a digit: a `%%` there is a percent
// sign typed twice ("100%%"), not a comment opener. A `%%` straight after a letter
// ("text%%note%%") is a comment typed without its space.
function gluedBefore(text, index) {
  return /\p{N}$/u.test(String(text).slice(Math.max(0, index - 2), index));
}

// The stray `%%` in one string or nested value, read the way the cut above reads them.
function percentStrays(value) {
  if (Array.isArray(value)) return value.flatMap(percentStrays);
  if (value && typeof value === 'object') return Object.values(value).flatMap(percentStrays);
  if (typeof value !== 'string' || !value.includes('%%')) return [];
  return readPercent(value).strays;
}

// Every string leaf of parsed frontmatter that holds a `%%`, with a path to it
// (`list[1]`, `deep.key`). Read before cutValueComments, which removes what this reports.
function percentFields(data, prefix = '') {
  const out = [];
  if (typeof data === 'string') {
    if (data.includes('%%')) out.push({ field: prefix, value: data });
  } else if (Array.isArray(data)) {
    data.forEach((v, i) => out.push(...percentFields(v, `${prefix}[${i}]`)));
  } else if (data && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
    for (const [key, v] of Object.entries(data)) out.push(...percentFields(v, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

module.exports = { parseNote, cutValueComments, gluedBefore, percentStrays, percentFields };
