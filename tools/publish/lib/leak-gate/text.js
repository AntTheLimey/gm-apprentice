'use strict';
// How text is compared by the leak gate: a note's hidden text and a finished page's text both become lowercase words in
// one Unicode form, with quotes and dashes folded, so a sentence matches however the renderer typeset it. A note's own
// private-use characters (U+E000-E002, raw on the player site) and U+FFFD (what the GM build makes of them) are taken
// out without splitting the word they stand in.
const { stripMarkdown } = require('../search-index');
const { foldQuotes, pageText } = require('../note-faults');
const { labelsForLinks } = require('../wikilink');

const MIN_WORDS = 4;
const WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

function normalize(text) {
  return foldQuotes(String(text == null ? '' : text))
    .replace(/[-�]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function wordsOf(text) {
  return normalize(text).match(WORD) || [];
}

const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const SENTENCE_END = /(?<=[.!?…]["'”’)\]]*)\s+/;

// The blocks of a note's text: each paragraph (its lines joined), each list item, each table cell, a quote or callout
// line as its text. Headings, fences and table rules end a block and are not pieces.
function blocksOf(markdown) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) blocks.push(para.join(' ')); para = []; };
  for (const raw of String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n')) {
    const quoted = raw.replace(/^\s*(?:>\s?)+/, '');
    // A callout's first line is its title: a block of its own, so it does not run into the text below it.
    if (/^\s*\[![\w-]+\]/.test(quoted)) { flush(); const title = quoted.replace(/^\s*\[![\w-]+\][+-]?\s*/, '').trim(); if (title) blocks.push(title); continue; }
    const line = quoted.trim();
    if (!line || /^(?:```|~~~)/.test(line) || /^#{1,6}\s/.test(line) || /^\|?\s*:?-{3,}/.test(line)) { flush(); continue; }
    if (line.startsWith('|')) {
      flush();
      for (const cell of line.replace(/^\||\|$/g, '').split('|')) if (cell.trim()) blocks.push(cell.trim());
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
// emphasis marks or picture embeds, an entity as its character. Hidden pieces and the published text they are compared
// with are both made here.
function textsOfMarkdown(markdown) {
  return blocksOf(markdown).map((block) => pageText(stripMarkdown(block.replace(PICTURE_EMBED, ' '))));
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

function piecesOfValue(value) {
  return stringsOfValue(value).flatMap(piecesOfText);
}

module.exports = { MIN_WORDS, normalize, wordsOf, textsOfMarkdown, piecesOfMarkdown, stringsOfValue, piecesOfValue };
