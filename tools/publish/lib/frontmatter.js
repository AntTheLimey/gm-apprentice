// tools/publish/lib/frontmatter.js
const matter = require('gray-matter');
const { markerRe } = require('./markers');

// The one way this tool splits a note into frontmatter and body.
//
// gray-matter called with no options caches by the note's exact text, and caches before
// it parses. A note whose YAML throws is therefore cached half-read: the next note with
// the same text (or the same note on a second scan in one process) comes back a silent
// "success" with empty data, and reads as a note with no `type:` instead of a broken
// one (#287). The cache also hands two identical notes the same `data` object. Passing
// options turns the cache off.
//
// A YAML value may refer to itself (`tags: &a [*a]`). Every reader below and across the
// tool walks a value to its leaves, so the reference back is cut here, once, to nothing.
//
// Frontmatter is YAML and nothing else. An opener may name a language (`---js`, `---json`),
// and gray-matter has its own reader for each; these refuse, so such a note reads as one
// whose frontmatter cannot be parsed. Every gray-matter call in the tool passes ENGINES.
const refuse = () => { throw new Error('frontmatter must be YAML'); };
const ENGINES = { javascript: refuse, json: refuse };

function parseNote(text) {
  const note = matter(text, { engines: ENGINES });
  uncycle(note.data, []);
  return note;
}

function uncycle(value, above) {
  if (!value || typeof value !== 'object' || value instanceof Date) return;
  above.push(value);
  for (const key of Object.keys(value)) {
    if (above.includes(value[key])) value[key] = null;
    else uncycle(value[key], above);
  }
  above.pop();
}

// One reading of what hides text in a frontmatter string. The value is read once, left to
// right, by the rule the body's `%%` strip follows (processor.js obsidianComments):
//
//   %% … %%                                a comment
//   <!-- … -->                             a comment
//   <!-- gm-only --> … <!-- /gm-only -->   a hidden block (spoiler too), read by markers.js
//
// Each is cut with what it holds. One that is never closed hides the rest of the value. Any
// of them inside an inline code span (backticks) is literal text and stays.
// Returns the text left and each stray: { kind, mark }. UNCLOSED is one that never closes;
// GLUED is a `%%` that closes but sits straight after a number.
function readValue(value) {
  let kept = '';
  const strays = [];
  const opener = markerRe(undefined, 'y');
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
      if (close === -1) { strays.push({ kind: 'UNCLOSED', mark: '%%' }); break; }
      if (gluedBefore(value, i)) strays.push({ kind: 'GLUED', mark: '%%' });
      i = close + 2;
      continue;
    }
    if (ch === '<' && value.startsWith('<!--', i)) {
      opener.lastIndex = i;
      const m = opener.exec(value);
      if (m && m[1] === '') {
        const name = m[2].toLowerCase();
        const stop = blockEnd(value, i + m[0].length, name);
        if (stop === -1) { strays.push({ kind: 'UNCLOSED', mark: `<!-- ${name} -->` }); break; }
        i = stop;
        continue;
      }
      const close = value.indexOf('-->', i + 4);
      if (close === -1) { strays.push({ kind: 'UNCLOSED', mark: '<!--' }); break; }
      i = close + 3;
      continue;
    }
    kept += ch;
    i++;
  }
  return { kept, strays };
}

// Where the hidden block of marker `name` whose opener ends at `from` ends: past the closer
// that matches it, a block of the same name inside it closing first. -1: it never does.
function blockEnd(value, from, name) {
  const marker = markerRe(name);
  marker.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = marker.exec(value)) !== null) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

const holdsMark = (text) => text.includes('%%') || text.includes('<!--');

// A comment or a hidden block in a frontmatter value is cut (readValue). Only strings are
// read, at any depth; a value that was nothing but hidden text goes, and the space left
// where a cut was made is closed up. Run on the parsed data of a note the site is built
// from, so no output can print the marker or its words.
function cutValueComments(value) {
  if (typeof value === 'string') {
    if (!holdsMark(value)) return value;
    const { kept } = readValue(value);
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

// The strays in one string or nested value, read the way the cut above reads them.
function valueStrays(value) {
  if (Array.isArray(value)) return value.flatMap(valueStrays);
  if (value && typeof value === 'object') return Object.values(value).flatMap(valueStrays);
  if (typeof value !== 'string' || !holdsMark(value)) return [];
  return readValue(value).strays;
}

// Every string leaf of parsed frontmatter that holds a `%%` or a `<!--`, with a path to it
// (`list[1]`, `deep.key`). Read before cutValueComments, which removes what this reports.
function commentFields(data, prefix = '') {
  const out = [];
  if (typeof data === 'string') {
    if (holdsMark(data)) out.push({ field: prefix, value: data });
  } else if (Array.isArray(data)) {
    data.forEach((v, i) => out.push(...commentFields(v, `${prefix}[${i}]`)));
  } else if (data && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
    for (const [key, v] of Object.entries(data)) out.push(...commentFields(v, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

module.exports = { ENGINES, parseNote, uncycle, cutValueComments, gluedBefore, valueStrays, commentFields };
