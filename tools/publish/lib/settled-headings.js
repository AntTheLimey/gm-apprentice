'use strict';
// Headings gm-leak (vault_check.py) flags as Keeper-looking that the GM reviewed and means for players (#453). Each is
// a record in the publish list's `accepted` list, beside the leak gate's accepted findings, so one list settles every
// leak finding: `page` is the note's vault path, `text` the heading as written, `note` this marker. The leak gate
// leaves them alone; `explain --all` hands them to gm-leak, which skips a heading whose note and text both still match.
const fs = require('fs');
const path = require('path');

const HEADING_NOTE = 'gm-leak.heading';
const isSettledHeading = (a) => Boolean(a) && a.note === HEADING_NOTE;
const settledHeadingsOf = (list) => ((list && list.accepted) || []).filter(isSettledHeading).map((a) => ({ page: a.page, heading: a.text }));

// A note's heading titles as gm-leak's rows show them (vault_check HEADING_RE, atx_title, _shown_title): the ATX
// closing sequence dropped and emphasis wrapping the whole title unwrapped.
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const EMPHASIS_RE = /^(\*\*|\*|__|_)(.+?)\1$/;
function headingTitles(text) {
  const titles = new Set();
  for (const line of text.split('\n')) {
    const m = HEADING_RE.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    const raw = m[2].trim().replace(/\s+#+$/, '').trim();
    const e = EMPHASIS_RE.exec(raw);
    titles.add((e ? e[2].trim() : raw).normalize('NFC'));
  }
  return titles;
}

// A settled heading that no longer means anything: its note is gone, or the note has no such heading now.
function settledHeadingGone(vaultPath, record) {
  let text;
  try { text = fs.readFileSync(path.join(vaultPath, ...record.page.split('/')), 'utf8'); } catch { return true; }
  return !headingTitles(text).has(String(record.text).normalize('NFC'));
}

module.exports = { HEADING_NOTE, isSettledHeading, settledHeadingsOf, settledHeadingGone };
