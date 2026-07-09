const { publishedSource } = require('./processor');
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const TERMINAL_STATUSES = new Set(['dead', 'deceased', 'destroyed', 'kia', 'dissolved']);
// A session counts as "played" once it has been run — including the post-wrap-up, pre-reconcile
// `wrap-up` state — so a freshly wrapped session still drives "recent" before it's reviewed.
const PLAYED_STATUSES = new Set(['played', 'reviewed', 'wrap-up']);

// Mentions/recency must reflect only what readers can see, so prefer each page's published
// view (gm-only + excluded sections stripped) over its raw markdown when available (B6).
const publishedText = publishedSource;

function extractMentions(markdown) {
  const mentions = new Set();
  let match;
  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(markdown)) !== null) {
    mentions.add(match[1].trim());
  }
  return mentions;
}

// All entity names mentioned "in" a session: its own body, its frontmatter participants/location,
// and — because the narrative recap lives in the wrap-up, not the thin index stub — the body of
// its paired wrap-up.
function sessionMentions(session, wrapUpByTitle) {
  const names = extractMentions(publishedText(session));
  const fm = session.frontmatter || {};
  if (Array.isArray(fm.participants)) {
    for (const p of fm.participants) {
      const m = String(p).match(/\[\[([^\]|]+)/);
      if (m) names.add(m[1].trim());
    }
  }
  if (fm.location) {
    const m = String(fm.location).match(/\[\[([^\]|]+)/);
    if (m) names.add(m[1].trim());
  }
  const wu = wrapUpByTitle.get(session.title);
  if (wu) {
    for (const n of extractMentions(publishedText(wu))) names.add(n);
  }
  return names;
}

function scoreByRecency(entities, sessions, chapters, options = {}) {
  const window = options.window || 3;
  const max = options.max || 6;
  const type = options.type;
  const wrapUps = options.wrapUps || [];

  // Most recently *played* first. session_number restarts per chapter, so it can't identify the
  // recent sessions — sort by play_date and fall back to session_number only when dates tie/absent.
  const played = sessions
    .filter(s => s.frontmatter.type === 'session' && PLAYED_STATUSES.has(String(s.frontmatter.status || '').toLowerCase()))
    .sort((a, b) => {
      const da = new Date(a.frontmatter.play_date || a.frontmatter.actual_date || 0).getTime() || 0;
      const db = new Date(b.frontmatter.play_date || b.frontmatter.actual_date || 0).getTime() || 0;
      if (db !== da) return db - da;
      return (b.frontmatter.session_number || 0) - (a.frontmatter.session_number || 0);
    });

  const recentSessions = played.slice(0, window);
  if (recentSessions.length === 0) return [];

  // Pair each session with its wrap-up via the wrap-up's `session` wiki-link. session_number is
  // not unique once a chapter restarts numbering, so it can't key the pairing.
  const wrapUpByTitle = new Map();
  for (const w of wrapUps) {
    const ref = w.frontmatter && w.frontmatter.session;
    if (!ref) continue;
    const target = String(ref).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    if (target && !wrapUpByTitle.has(target)) wrapUpByTitle.set(target, w);
  }

  // Mentions per recent session, recency-weighted (the most recent session counts most).
  const recent = recentSessions.map((session, i) => ({
    mentions: sessionMentions(session, wrapUpByTitle),
    weight: window - i,
  }));
  const latestMentions = recent[0].mentions;

  const currentChapter = chapters
    .filter(c => c.frontmatter.type === 'chapter')
    .sort((a, b) => (b.frontmatter.sort_order || 0) - (a.frontmatter.sort_order || 0))[0];
  const chapterMentions = currentChapter ? extractMentions(publishedText(currentChapter)) : new Set();

  const scored = entities.map(entity => {
    if (type && entity.frontmatter.type !== type) return null;
    const names = [entity.title, ...(entity.frontmatter.aliases || [])];

    // Terminal-status entities (dead, destroyed, …) are retired from "in play" — unless they
    // feature in the latest session (e.g. an NPC who died there is still current news).
    const isTerminal = TERMINAL_STATUSES.has(String(entity.frontmatter.status || '').toLowerCase());
    const inLatest = names.some(n => latestMentions.has(n));
    if (isTerminal && !inLatest) return null;

    let score = 0;
    for (const rs of recent) {
      if (names.some(n => rs.mentions.has(n))) score += 2 * rs.weight;
    }
    if (names.some(n => chapterMentions.has(n))) score += 1;

    return { page: entity, score };
  }).filter(Boolean);

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

module.exports = { scoreByRecency };
