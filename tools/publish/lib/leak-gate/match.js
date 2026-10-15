'use strict';
// The finished site as words, and the four-word index the leak gate finds hidden pieces with. Each piece is filed under
// its first four words; a window of four slides over each file's words, and a hit is compared word by word to the end
// of the piece. One pass over the site.
const fs = require('fs');
const path = require('path');
const { pageText } = require('../note-faults');
const { wordsOf, MIN_WORDS } = require('./text');

const TEXT_EXT = new Set(['.html', '.htm', '.json', '.js', '.txt']);
const TOOL_JS = path.join(__dirname, '..', '..', 'js');

function createMatcher(pieces) {
  const index = new Map();
  for (const piece of pieces) {
    if (piece.words.length < MIN_WORDS) continue;
    const key = piece.words.slice(0, MIN_WORDS).join(' ');
    const list = index.get(key);
    if (list) list.push(piece); else index.set(key, [piece]);
  }
  return {
    scan(words) {
      const hits = [];
      for (let i = 0; i + MIN_WORDS <= words.length; i++) {
        const list = index.get(`${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`);
        if (!list) continue;
        for (const piece of list) {
          const n = piece.words.length;
          if (i + n > words.length) continue;
          let k = MIN_WORDS;
          while (k < n && words[i + k] === piece.words[k]) k++;
          if (k === n) hits.push({ piece, at: i });
        }
      }
      return hits;
    },
  };
}

function jsonStrings(value, into) {
  if (typeof value === 'string') into.push(value.includes('<') ? pageText(value, { attributes: true }) : value);
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => jsonStrings(v, into));
  return into;
}

// The words a visitor can be sent in one file: a page's text with the words its tags carry and its inline scripts;
// every string of a JSON file; a script or text file as it stands.
function fileText(rel, raw) {
  const ext = path.posix.extname(rel).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    const scripts = [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
    return [pageText(raw, { attributes: true }), ...scripts].join('\n');
  }
  if (ext === '.json') {
    try { return jsonStrings(JSON.parse(raw), []).join('\n'); } catch (e) { return raw; }
  }
  return raw;
}

// A script the tool itself copies into every site: it holds no vault text.
function isToolScript(rel) {
  return /^js\//.test(rel) && fs.existsSync(path.join(TOOL_JS, ...rel.slice(3).split('/')));
}

function readOutput(dir) {
  const out = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) { walk(child, childRel); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!e.isFile() || !TEXT_EXT.has(ext) || isToolScript(childRel)) continue;
      const raw = fs.readFileSync(child, 'utf8');
      out.push({ rel: childRel, ext, raw, words: wordsOf(fileText(childRel, raw)) });
    }
  }(dir, ''));
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

module.exports = { createMatcher, fileText, readOutput, isToolScript };
