'use strict';
// The run sheet's sessions: which a vault holds, in story order, what records each has, and which
// one is tonight's. One rule for "played" and for a session's Table Log, shared with the reader's
// walk back through earlier sessions (read.js readCarried).

const fs = require('node:fs');
const path = require('node:path');
const pt = require('./plan-text');
const { buildIndex, stemOf } = require('./notes');
const { orderedSessions, chapterOfSession } = require('../story-spine');
const { publishedWrapUpFor } = require('../session-hub');
const { displayTitleOf } = require('../scanner');
const { canonicalNfc } = require('../unicode');
const { SESSION_PLAYED, WRAP_UP_TYPES } = require('../shared-lists');
const { recordBodyOf, isEmptySkeleton } = require('./record');

const low = (s) => canonicalNfc(String(s == null ? '' : s)).trim().toLowerCase();
const RECORDS = ['play_notes', 'export', 'table_log', 'wrap_up'];

// A frontmatter link field as one target, or ''.
const fmTarget = (v) => {
  const x = Array.isArray(v) ? v[0] : v;
  const s = x == null ? '' : String(x);
  return pt.links(s)[0] || s.trim();
};
const fmOf = (index, p) => (index.has(p) ? index.read(p).fm || {} : {});
const docsOf = (index, p) => {
  const d = fmOf(index, p).documents;
  return d && typeof d === 'object' ? d : {};
};

// Has the table run this session: a played status, a Wrap-Up, or a play record with something in it (#855). A record
// filed but empty (a Table Log a look filed before game night, under the old open-time filing) is no play.
const written = (body) => String(body || '').split('\n').some((l) => {
  const t = l.trim();
  return t && !t.startsWith('#') && !/^<!--.*-->$/.test(t);
});
function recordHasContent(index, key, target) {
  if (key === 'wrap_up' || key === 'export') return true;
  const p = index.resolve(target);
  if (!p || !index.has(p)) return false;
  const { body } = index.read(p);
  return key === 'table_log' ? !isEmptySkeleton(recordBodyOf(String(body || ''))) : written(body);
}
function isPlayed(index, sessionPath) {
  if (SESSION_PLAYED.has(low(fmOf(index, sessionPath).status))) return true;
  const docs = docsOf(index, sessionPath);
  return RECORDS.some((k) => fmTarget(docs[k]) && recordHasContent(index, k, fmTarget(docs[k])));
}

// The session's Table Log: `documents.table_log`, else the one session-table-log note naming the session.
// A link that is dead or names another type gives no log and a warning.
function tableLogOf(index, sessionPath) {
  if (sessionPath === null || sessionPath === undefined) return { log: null, warning: null }; // no session yet: no log is its own [B2]
  const t = fmTarget(docsOf(index, sessionPath).table_log);
  if (!t) {
    const named = index.notes().filter((n) => low(fmOf(index, n).type) === 'session-table-log' && index.resolve(fmTarget(fmOf(index, n).session) || null) === sessionPath);
    return { log: named.length === 1 ? named[0] : null, warning: null };
  }
  const log = index.resolve(t);
  if (log === null) {
    const why = (index.linkProblem(t) || {}).text || `[[${t}]] matches no note in the vault`;
    return { log: null, warning: { kind: 'table-log', note: sessionPath, text: `its documents.table_log ${why}: allies start from their notes` } };
  }
  if (low(fmOf(index, log).type) !== 'session-table-log') {
    return { log: null, warning: { kind: 'table-log', note: sessionPath, text: `its documents.table_log links ${log}, which is not type: session-table-log: it is not read for the allies` } };
  }
  // A log whose `session:` names another session (an index copied from the last one) is that
  // session's record: never read or written as this one's.
  const backlink = fmTarget(fmOf(index, log).session);
  const owner = backlink ? index.resolve(backlink) : null;
  if (owner !== null && owner !== sessionPath) {
    return { log: null, warning: { kind: 'table-log', note: sessionPath, text: `its documents.table_log links ${log}, whose session: is ${owner}: fix the link to this session's own Table Log; it is not read or written` } };
  }
  return { log, warning: null };
}

// The notes of `types` whose `session:` names the session.
const claimants = (index, sessionPath, types) => index.notes()
  .filter((n) => types.has(low(fmOf(index, n).type)) && index.resolve(fmTarget(fmOf(index, n).session) || null) === sessionPath);

// The session's Play Notes: the `documents.play_notes` link when it resolves to a play-notes note whose
// `session:` names this session or nothing (as tableLogOf reads its link), else the one note of a
// play-notes type whose `session:` names the session. A link to a Plan, or to another session's notes, is
// not this session's record. No warning: the session's other records still read.
const PLAY_NOTES_TYPES = new Set(['session-play-notes', 'session_play_notes']);
function playNotesOf(index, sessionPath) {
  const t = fmTarget(docsOf(index, sessionPath).play_notes);
  const hit = t ? index.resolve(t) : null;
  if (hit && PLAY_NOTES_TYPES.has(low(fmOf(index, hit).type))) {
    const backlink = fmTarget(fmOf(index, hit).session);
    const owner = backlink ? index.resolve(backlink) : null;
    if (owner === null || owner === sessionPath) return hit;
  }
  const named = claimants(index, sessionPath, PLAY_NOTES_TYPES);
  return named.length === 1 ? named[0] : null;
}

// The session's Plan: the `documents.plan` link when it resolves, else the one session-plan note naming the session.
function planOf(index, sessionPath) {
  const t = fmTarget(docsOf(index, sessionPath).plan);
  const hit = t ? index.resolve(t) : null;
  if (hit) return hit;
  const named = claimants(index, sessionPath, new Set(['session-plan']));
  return named.length === 1 ? named[0] : null;
}

// The session's Wrap-Up, by the build's own pairing rule (lib/session-hub.js, the one rule), run over every
// Wrap-Up in the vault whether it publishes or not. Two Wrap-Ups naming one session leave the pairing
// unsure which is the record, not whether the session is wrapped up: it still counts, by the first.
function wrapUpOf(index, sessionPath, pages) {
  const page = pages.find((pg) => pg.rel === sessionPath);
  const paired = page ? publishedWrapUpFor(page, pages) : null;
  if (paired) return paired.rel;
  const t = fmTarget(docsOf(index, sessionPath).wrap_up);
  const hit = t ? index.resolve(t) : null;
  if (hit) return hit;
  return claimants(index, sessionPath, WRAP_UP_TYPES)[0] || null;
}

const numberOf = (fm, stem) => {
  const v = fm.session_number;
  const n = Number(v);
  if (v !== undefined && v !== null && v !== '' && Number.isInteger(n)) return n;
  const m = /\bsession\s+0*(\d+)\b/i.exec(stem);
  return m ? Number(m[1]) : null;
};

const playDateOf = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = v == null ? '' : String(v).trim();
  return t || null;
};

function listSessions(vaultPath, { deps, index } = {}) {
  const idx = index || buildIndex(vaultPath, { deps });
  const pages = idx.notes().map((p) => ({
    title: stemOf(p), vaultPath: p.replace(/\.md$/i, ''), displayTitle: displayTitleOf(fmOf(idx, p), stemOf(p)), frontmatter: fmOf(idx, p), sourcePath: path.join(vaultPath, p), rel: p,
  }));
  return orderedSessions(pages).map((pg) => {
    const p = pg.rel;
    const fm = fmOf(idx, p);
    const chapterPage = chapterOfSession(pg, pages);
    const number = numberOf(fm, stemOf(p));
    const title = pg.displayTitle || stemOf(p);
    const plan = planOf(idx, p);
    const wrapUp = wrapUpOf(idx, p, pages);
    return {
      index: p,
      title,
      number,
      chapter: chapterPage ? chapterPage.rel : null,
      plan,
      wrapUp,
      tableLog: tableLogOf(idx, p).log,
      played: isPlayed(idx, p),
      playDate: playDateOf(fm.play_date),
      open: plan !== null && wrapUp === null,
      label: number !== null ? `Session ${number}` : title,
    };
  });
}

// A session with no Plan, opened from the record. `s` is the vault's session whose index it is (its index already
// exists: prep --upcoming, or one the GM named), or null for one not filed yet. `after` is the latest session with a Wrap-Up.
function recordSession(sessions, s, number = null) {
  const wrapped = sessions.map((x, i) => (x.wrapUp ? i : -1)).filter((i) => i >= 0);
  const last = wrapped.length ? sessions[wrapped[wrapped.length - 1]] : null;
  const n = s ? s.number : number;
  const chapter = s ? s.chapter : (last ? last.chapter : null);
  const label = n !== null && n !== undefined ? `Session ${n}` : (s ? s.label : 'Session');
  return {
    index: s ? s.index : null,
    title: s ? s.title : label,
    number: n === undefined ? null : n,
    chapter: chapter || null,
    plan: null,
    wrapUp: null,
    tableLog: s ? s.tableLog : null,
    played: s ? Boolean(s.played) : false,
    playDate: (s && s.playDate) || null,
    open: false,
    fromRecord: true,
    after: last ? last.index : null,
    label,
    planVault: sessions.some((x) => x.plan),
  };
}

// The session after the latest one with a Wrap-Up, in story order. If its index exists with no Plan and no Wrap-Up it is
// the session, played or not (a night played but not wrapped up reopens); else a session not filed yet, numbered by the
// one before it (by count when that has no number).
function nextFromRecord(sessions) {
  let at = -1;
  sessions.forEach((x, i) => { if (x.wrapUp) at = i; });
  const cand = sessions[at + 1];
  if (cand && !cand.plan && !cand.wrapUp) return recordSession(sessions, cand);
  let number = 1;
  if (at >= 0) number = sessions[at].number !== null ? sessions[at].number + 1 : sessions.length + 1;
  return recordSession(sessions, null, number);
}

// Which session to run. `asked` is an index stem, an index path, a Plan path, or a name two sessions may share.
// `vaultPath`, when given, lets an absolute path name a session inside the vault.
function pickSession(sessions, asked, vaultPath) {
  if (asked) {
    let wanted = String(asked).trim().replace(/\\/g, '/');
    if (vaultPath && (path.posix.isAbsolute(wanted) || path.win32.isAbsolute(wanted))) {
      const rel = path.relative(vaultPath, wanted.replace(/\//g, path.sep)).split(path.sep).join('/');
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) wanted = rel;
    }
    const q = low(wanted).replace(/\.md$/, '');
    const norm = (s) => low(s).replace(/\\/g, '/').replace(/\.md$/, '').replace(/\bsession\s+0*(\d+)\b/, 'session $1');
    const exact = sessions.filter((s) => [s.index, s.plan, stemOf(s.index)].some((v) => v && norm(v) === norm(q)));
    const near = sessions.filter((s) => {
      const stem = norm(stemOf(s.index));
      const nq = norm(q);
      return stem.startsWith(`${nq} -`) || norm(s.label) === nq;
    });
    const hits = exact.length ? exact : near;
    if (hits.length === 0) return { error: `No session matches "${asked}".` };
    if (hits.length > 1) return { error: `"${asked}" names more than one session: ${hits.map((s) => s.index).join(' and ')}. Name one by its path.` };
    const s = hits[0];
    if (s.wrapUp) return { error: `${s.label} is wrapped up; its record is the Wrap-Up${s.tableLog ? ', with its Table Log' : ''}.` };
    // Ant, 2026-11-27: a session with no Plan opens from the record; it is no longer refused.
    if (!s.plan) return { session: recordSession(sessions, s), others: [] };
    return { session: s, others: [] };
  }
  const open = sessions.filter((s) => s.open);
  // Ant, 2026-11-27: every Plan wrapped up (or none made) opens the next session from the record.
  if (open.length === 0) return { session: nextFromRecord(sessions), others: [] };
  const going = open.filter((s) => s.tableLog);
  if (going.length) return { session: going[0], others: going.slice(1) };
  return { session: open[0], others: [] };
}

const slug = (s) => canonicalNfc(String(s || '')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

// The state file's name: chapter stem (the session's folder when it has no chapter) and session index stem, so two Session 01s in two chapters differ.
// A session opened from the record is named by its number, before filing and after (D1): the folder changes with the filing.
const noPlanIdOf = (session) => `${session.chapter ? slug(stemOf(session.chapter)) : 'vault'}--session-${session.number !== null && session.number !== undefined ? session.number : slug(session.index ? stemOf(session.index) : session.label)}`;
function stateIdOf(session) {
  if (!session.plan && session.fromRecord) return noPlanIdOf(session);
  const where = session.chapter ? slug(stemOf(session.chapter)) : slug(path.posix.dirname(session.index));
  return `${where}--${slug(stemOf(session.index))}`;
}

// The state file and its id. A Plan session with no state of its own name takes, in order: the state whose saved
// `filed.index` is this session's index (the no-Plan sheet filed it, whatever its folder was then), then the one named
// by its number (prep ran mid-play, then a restart) (D1).
function stateFileFor(vaultPath, session, { exists = fs.existsSync, readDir = fs.readdirSync, readFile = fs.readFileSync } = {}) {
  const dir = path.join(vaultPath, '_meta', 'table');
  const at = (id) => path.join(dir, `${id}.json`);
  let stateId = stateIdOf(session);
  if (session.plan && !exists(at(stateId))) {
    let found = null;
    if (session.index) {
      const matches = [];
      let names = [];
      try { names = readDir(dir); } catch { names = []; }
      for (const name of names.filter((n) => /--session-.*\.json$/.test(n)).sort()) {
        try {
          const saved = JSON.parse(String(readFile(path.join(dir, name), 'utf8')));
          if (saved && saved.filed && saved.filed.index === session.index) matches.push(name.replace(/\.json$/, ''));
        } catch { /* an unreadable state file is not this session's */ }
      }
      // two states with one filed index: the number-named one is the sheet's own
      found = matches.includes(noPlanIdOf(session)) ? noPlanIdOf(session) : (matches[0] || null);
    }
    if (!found && session.number !== null && session.number !== undefined) {
      const byNumber = noPlanIdOf(session);
      if (exists(at(byNumber))) found = byNumber;
    }
    if (found) stateId = found;
  }
  return { file: at(stateId), stateId };
}

module.exports = { listSessions, pickSession, nextFromRecord, stateFileFor, tableLogOf, isPlayed, stateIdOf, wrapUpOf, playNotesOf };
