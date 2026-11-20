'use strict';
// The run sheet's sessions: which a vault holds, in story order, what records each has, and which
// one is tonight's. One rule for "played" and for a session's Table Log, shared with the reader's
// walk back through earlier sessions (read.js readCarried).

const path = require('node:path');
const pt = require('./plan-text');
const { buildIndex, stemOf } = require('./notes');
const { orderedSessions } = require('../story-spine');
const { displayTitleOf } = require('../scanner');
const { canonicalNfc } = require('../unicode');
const { SESSION_PLAYED, WRAP_UP_TYPES } = require('../shared-lists');

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

// Has this session been played: a played status, or any record of it.
function isPlayed(index, sessionPath) {
  return SESSION_PLAYED.has(low(fmOf(index, sessionPath).status)) || RECORDS.some((k) => fmTarget(docsOf(index, sessionPath)[k]));
}

// The session's Table Log: `documents.table_log`, else the one session-table-log note naming the session.
// A link that is dead or names another type gives no log and a warning.
function tableLogOf(index, sessionPath) {
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
  return { log, warning: null };
}

// A record of one kind: the `documents.<key>` link when it resolves, else the one note of `types`
// whose `session:` names the session.
function recordOf(index, sessionPath, key, types) {
  const t = fmTarget(docsOf(index, sessionPath)[key]);
  const hit = t ? index.resolve(t) : null;
  if (hit) return hit;
  const named = index.notes().filter((n) => types.has(low(fmOf(index, n).type)) && index.resolve(fmTarget(fmOf(index, n).session) || null) === sessionPath);
  return named.length === 1 ? named[0] : null;
}

const numberOf = (fm, stem) => {
  const v = fm.session_number;
  const n = Number(v);
  if (v !== undefined && v !== null && v !== '' && Number.isInteger(n)) return n;
  const m = /\bsession\s+0*(\d+)\b/i.exec(stem);
  return m ? Number(m[1]) : null;
};

function listSessions(vaultPath, { deps, index } = {}) {
  const idx = index || buildIndex(vaultPath, { deps });
  const pages = idx.notes().map((p) => ({
    title: stemOf(p), displayTitle: displayTitleOf(fmOf(idx, p), stemOf(p)), frontmatter: fmOf(idx, p), sourcePath: path.join(vaultPath, p), rel: p,
  }));
  const planTypes = new Set(['session-plan']);
  return orderedSessions(pages).map((pg) => {
    const p = pg.rel;
    const fm = fmOf(idx, p);
    const chapterTarget = fmTarget(fm.chapter);
    const number = numberOf(fm, stemOf(p));
    const title = pg.displayTitle || stemOf(p);
    const plan = recordOf(idx, p, 'plan', planTypes);
    const wrapUp = recordOf(idx, p, 'wrap_up', WRAP_UP_TYPES);
    return {
      index: p,
      title,
      number,
      chapter: chapterTarget ? idx.resolve(chapterTarget) : null,
      plan,
      wrapUp,
      tableLog: tableLogOf(idx, p).log,
      played: isPlayed(idx, p),
      open: plan !== null && wrapUp === null,
      label: number !== null ? `Session ${number}` : title,
    };
  });
}

// Which session to run. `asked` is an index stem, an index path, a Plan path, or a name two sessions may share.
function pickSession(sessions, asked) {
  if (asked) {
    const q = low(asked).replace(/\.md$/, '');
    const norm = (s) => low(s).replace(/\.md$/, '').replace(/\bsession\s+0*(\d+)\b/, 'session $1');
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
    if (s.wrapUp) return { error: `${s.label} is wrapped up; its record is the Table Log note.` };
    if (!s.plan) return { error: `${s.label} has no Plan yet: prep it first.` };
    return { session: s, others: [] };
  }
  const open = sessions.filter((s) => s.open);
  if (open.length === 0) return { error: 'No session is open for play: every session with a Plan has a Wrap-Up. Prep the next one first.' };
  const going = open.filter((s) => s.tableLog);
  if (going.length) return { session: going[0], others: going.slice(1) };
  return { session: open[0], others: [] };
}

const slug = (s) => canonicalNfc(String(s || '')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

// The state file's name: chapter stem and session index stem, so two Session 01s in two chapters differ.
function stateIdOf(session) {
  return `${session.chapter ? slug(stemOf(session.chapter)) : 'no-chapter'}--${slug(stemOf(session.index))}`;
}

module.exports = { listSessions, pickSession, tableLogOf, isPlayed, stateIdOf };
