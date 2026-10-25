'use strict';
// How text is compared by the leak gate: a note's hidden text and a finished page's text both become lowercase words in
// one Unicode form, with quotes and dashes folded, so a sentence matches however the renderer typeset it. A note's own
// private-use characters (U+E000-E002, raw on the player site) and U+FFFD (what the GM build makes of them) are taken
// out without splitting the word they stand in.
const { stripMarkdown } = require('../search-index');
const { foldQuotes, pageText } = require('../note-faults');
const { labelsForLinks, splitTableRow } = require('../wikilink');

const MIN_WORDS = 4;
const WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

// A text folded for comparison: quotes and dashes in one form, private-use marks out, lower case.
function folded(text) {
  return foldQuotes(String(text == null ? '' : text))
    .replace(/[-�]/g, '')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase();
}

function normalize(text) {
  return folded(text).replace(/\s+/g, ' ').trim();
}

// The words of a text, as normalize reads it. Spacing does not matter to words, and a text that is plain ASCII once
// folded is read with the ASCII form of WORD (the same words, faster).
const ASCII = /^[\x00-\x7f]*$/;
const WORD_ASCII = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;
function wordsOf(text) {
  const s = folded(text);
  return s.match(ASCII.test(s) ? WORD_ASCII : WORD) || [];
}

const TABLE_RULE = /^\|?\s*:?-{3,}/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const SENTENCE_END = /(?<=[.!?…]["'”’)\]]*)\s+/;

// The blocks of a note's text: each paragraph (its lines joined), each list item, each table cell (a pipe inside a link
// or after a backslash is not a cell's edge), a quote or callout line as its text. Headings, fences and table rules end
// a block; a heading is a block of its own only with `headings` (the published side: the page prints it).
function blocksOf(markdown, { headings = false } = {}) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) blocks.push(para.join(' ')); para = []; };
  for (const raw of String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n')) {
    const quoted = raw.replace(/^\s*(?:>\s?)+/, '');
    // A callout's first line is its title: a block of its own, so it does not run into the text below it.
    if (/^\s*\[![\w-]+\]/.test(quoted)) { flush(); const title = quoted.replace(/^\s*\[![\w-]+\][+-]?\s*/, '').trim(); if (title) blocks.push(title); continue; }
    const line = quoted.trim();
    if (headings && /^#{1,6}\s/.test(line)) { flush(); blocks.push(line.replace(/^#{1,6}\s+/, '').replace(/\s#+$/, '')); continue; }
    if (!line || /^(?:```|~~~)/.test(line) || /^#{1,6}\s/.test(line) || TABLE_RULE.test(line)) { flush(); continue; }
    if (line.startsWith('|')) {
      flush();
      for (const cell of splitTableRow(line)) if (cell.trim()) blocks.push(cell.trim().replace(/\\\|/g, '|'));
      continue;
    }
    if (LIST_ITEM.test(line)) { flush(); blocks.push(line.replace(LIST_ITEM, '')); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

function piecesOfText(text) {
  return String(text).split(SENTENCE_END).map((s) => s.trim()).filter((s) => wordsOf(s).length >= MIN_WORDS);
}

// An inline picture embed: the page shows the picture (or nothing), never its file name.
const PICTURE_EMBED = /!\[\[[^\]|]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\|[^\]]*)?\]\]/gi;

// Each block of a note's text as a reader sees it: a labelled link as its label, a markdown link as its text, no tags,
// emphasis marks or picture embeds, an entity as its character, an underscore a space (a page's words part at one, and a
// link to Edmund_Courtney prints two words). Hidden pieces and the published text they are compared with are made here.
function textsOfMarkdown(markdown, options) {
  return blocksOf(markdown, options).map((block) => {
    const text = stripMarkdown(block.replace(PICTURE_EMBED, ' '));
    return /[&<]/.test(text) ? pageText(text) : text;
  });
}

// Each table of a note as a sheet prints it: the line above it (its caption) and its rows, without the header row.
function tableRunsOf(markdown) {
  const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
  const runs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!TABLE_RULE.test(lines[i].trim()) || !lines[i - 1].trim().startsWith('|')) continue;
    let k = i - 2;
    while (k >= 0 && !lines[k].trim()) k--;
    const caption = k >= 0 && !lines[k].trim().startsWith('|') ? lines[k] : '';
    let j = i + 1;
    while (j < lines.length && lines[j].trim().startsWith('|')) j++;
    runs.push(textsOfMarkdown([caption, '', ...lines.slice(i + 1, j)].join('\n'), { headings: true }).join('\n'));
    i = j;
  }
  return runs;
}

// The pieces of an HTML or SVG part (a prop file's cut runs): its text with the words its tags carry, line by line.
function piecesOfHtml(html) {
  return pageText(html, { attributes: true }).split('\n').flatMap(piecesOfText);
}

function piecesOfMarkdown(markdown) {
  return textsOfMarkdown(markdown).flatMap(piecesOfText);
}

// Every string in a value, a labelled link as its label, whole (a published value is compared as it stands).
function stringsOfValue(value) {
  const strings = [];
  (function walk(v) {
    if (typeof v === 'string') strings.push(labelsForLinks(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object' && !(v instanceof Date)) Object.values(v).forEach(walk);
  }(value));
  return strings;
}

// A published note's fields as its pages print them: each field's name and value run together ("Role Retired colonial
// officer"), and each value after the note's title (an index card: the name, the field under it). A value's parts (a
// list, sub-fields with their names) run together in order.
function fieldRunsOf(fields, title) {
  const flat = (v) => {
    if (v == null || v instanceof Date) return '';
    if (typeof v === 'string') return labelsForLinks(v);
    if (typeof v !== 'object') return String(v);
    if (Array.isArray(v)) return v.map(flat).join(' ');
    return Object.entries(v).map(([k, x]) => `${k} ${flat(x)}`).join(' ');
  };
  const runs = [];
  for (const [key, value] of Object.entries(fields || {})) {
    const text = flat(value);
    if (!text.trim()) continue;
    runs.push(`${key} ${text}`);
    if (title) runs.push(`${title} ${text}`);
  }
  return runs;
}

// The site's public names as onlyNames reads them: each name's words, and the words a name can start with.
function nameSet(names) {
  const set = new Set(names.map((n) => wordsOf(n).join(' ')).filter(Boolean));
  set.firsts = new Set([...set].map((n) => n.split(' ')[0]));
  return set;
}

// Whether a piece's words are nothing but public names of the site, one after another (a list of mentions, a cast
// list): the site prints those names wherever it links them, so they are not hidden text. The name checks look for
// secret names.
const NAMES_ONLY_MAX = 12;
function onlyNames(words, names) {
  if (words.length > NAMES_ONLY_MAX || !names.firsts.has(words[0])) return false;
  const ok = [true];
  for (let i = 1; i <= words.length; i++) {
    ok[i] = false;
    for (let j = i - 1; j >= 0 && !ok[i]; j--) if (ok[j] && names.has(words.slice(j, i).join(' '))) ok[i] = true;
  }
  return ok[words.length];
}

function piecesOfValue(value) {
  return stringsOfValue(value).flatMap(piecesOfText);
}

module.exports = { MIN_WORDS, normalize, wordsOf, textsOfMarkdown, piecesOfText, piecesOfHtml, piecesOfMarkdown, stringsOfValue, piecesOfValue, fieldRunsOf, tableRunsOf, nameSet, onlyNames };
