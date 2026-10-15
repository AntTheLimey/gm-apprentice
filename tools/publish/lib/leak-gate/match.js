'use strict';
// The finished site as words, and the four-word index the leak gate finds hidden pieces with. Each piece is filed under
// its first four words; a window of four slides over each file's words, and a hit is compared word by word to the end
// of the piece. One pass over the site.
const fs = require('fs');
const path = require('path');
const { pageText } = require('../note-faults');
const { wordsOf, MIN_WORDS } = require('./text');

const TEXT_EXT = new Set(['.html', '.htm', '.json', '.webmanifest', '.js', '.mjs', '.txt', '.md', '.csv', '.xml', '.svg']);
const MARKUP_EXT = new Set(['.xml', '.svg']);
const JSON_EXT = new Set(['.json', '.webmanifest']);
const TOOL_JS = path.join(__dirname, '..', '..', 'js');
const TOOL_CSS = path.join(__dirname, '..', '..', 'css');

function createMatcher(pieces) {
  // Pieces filed by their first four words, one map per word (no key string is made per position in a scan).
  const index = new Map();
  for (const piece of pieces) {
    if (piece.words.length < MIN_WORDS) continue;
    let level = index;
    for (let k = 0; k < MIN_WORDS - 1; k++) {
      let next = level.get(piece.words[k]);
      if (!next) { next = new Map(); level.set(piece.words[k], next); }
      level = next;
    }
    const list = level.get(piece.words[MIN_WORDS - 1]);
    if (list) list.push(piece); else level.set(piece.words[MIN_WORDS - 1], [piece]);
  }
  return {
    scan(words) {
      const hits = [];
      for (let i = 0; i + MIN_WORDS <= words.length; i++) {
        let level = index;
        for (let k = 0; level && k < MIN_WORDS; k++) level = level.get(words[i + k]);
        if (!level) continue;
        for (const piece of level) {
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

const jsonOrRaw = (raw) => { try { return jsonStrings(JSON.parse(raw), []).join('\n'); } catch (e) { return raw; } };

// What a page sends that its text does not show: each inline script (a JSON island as its strings, so an escaped line
// break does not join two words) and each data-* attribute's value.
function pageExtras(raw) {
  const out = [];
  for (const m of raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    out.push(/\stype\s*=\s*["']?application\/(?:ld\+)?json/i.test(m[1]) ? jsonOrRaw(m[2]) : m[2]);
  }
  for (const m of raw.matchAll(/\sdata-[a-z0-9-]+\s*=\s*"([^"]*)"/gi)) out.push(pageText(m[1]));
  return out;
}

// The words a visitor can be sent in one file: a page's text with the words its tags carry, its inline scripts and data
// attributes; an XML or SVG file's text and the words its tags carry; every string of a JSON file; anything else as it
// stands.
function fileText(rel, raw) {
  const ext = path.posix.extname(rel).toLowerCase();
  if (ext === '.html' || ext === '.htm') return [pageText(raw, { attributes: true }), ...pageExtras(raw)].join('\n');
  if (MARKUP_EXT.has(ext)) return pageText(raw, { attributes: true });
  if (JSON_EXT.has(ext)) return jsonOrRaw(raw);
  return raw;
}

// The tool's own copy of a script or style it ships into every site, or null.
function toolCopyOf(rel) {
  const m = /^(js|css)\/(.+)$/.exec(rel);
  if (!m) return null;
  const file = path.join(m[1] === 'js' ? TOOL_JS : TOOL_CSS, ...m[2].split('/'));
  return fs.existsSync(file) ? file : null;
}

// A script the tool itself copies into every site, byte for byte: it holds no vault text. A file of the same name that
// a build step wrote is read like any other.
const toolText = new Map();
function isToolScript(rel, raw) {
  const file = /^js\//.test(rel) ? toolCopyOf(rel) : null;
  if (!file) return false;
  if (!toolText.has(file)) toolText.set(file, fs.readFileSync(file, 'utf8'));
  return toolText.get(file) === raw;
}

// A script or style the tool ships into every site, by its name (for the name check on a copied file's address).
function isToolFile(rel) {
  return toolCopyOf(rel) !== null;
}

// Every file under the folder, whatever its kind, as posix paths relative to it.
function listFiles(dir) {
  const out = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), childRel);
      else if (e.isFile()) out.push(childRel);
    }
  }(dir, ''));
  return out.sort();
}

function readOutput(dir) {
  const out = [];
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) { walk(child, childRel); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!e.isFile() || !TEXT_EXT.has(ext)) continue;
      const raw = fs.readFileSync(child, 'utf8');
      if (isToolScript(childRel, raw)) continue;
      const text = fileText(childRel, raw);
      out.push({ rel: childRel, ext, raw, text, words: wordsOf(text) });
    }
  }(dir, ''));
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

module.exports = { createMatcher, fileText, pageExtras, readOutput, isToolScript, isToolFile, listFiles };
