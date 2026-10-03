const { publishedSource } = require('./processor');
const { canonicalNfc } = require('./unicode');
const { wikilinkRe, parseWikilink, firstWikilinkTarget } = require('./wikilink');
const TERMINAL_STATUSES = new Set(['dead', 'deceased', 'destroyed', 'kia', 'dissolved']);
// A session counts as "played" once it has been run — including the post-wrap-up, pre-reconcile
// `wrap-up` state — so a freshly wrapped session still drives "recent" before it's reviewed.
const PLAYED_STATUSES = new Set(['played', 'reviewed', 'wrap-up']);

// Mentions/recency must reflect only what readers can see, so prefer each page's published
// view (gm-only + excluded sections stripped) over its raw markdown when available (B6).
const publishedText = publishedSource;

// Mention names are NFC (#139) on the way in, and every membership test below compares them
// against a canonicalized entity title. These are Set/Map comparisons, which `nfcLookupTable`
// cannot wrap, so both sides are normalized at the call site: an accented NPC mentioned in the
// latest session would otherwise never score, and never appear on the landing page.
function extractMentions(markdown) {
  const mentions = new Set();
  for (const match of markdown.matchAll(wikilinkRe())) {
    mentions.add(canonicalNfc(parseWikilink(match[1]).raw.trim()));
  }
  return mentions;
}

// All entity names mentioned "in" a session: its own body, its frontmatter participants/location,
// and — because the narrative recap lives in the wrap-up, not the thin index stub — the body of
// its paired wrap-up. `wrapUpFor` is the build's hub -> Wrap-Up map (session-hub.js pairHubs);
// recency never pairs on its own.
function sessionMentions(session, wrapUpFor) {
  const names = extractMentions(publishedText(session));
  const fm = session.frontmatter || {};
  if (Array.isArray(fm.participants)) {
    for (const p of fm.participants) {
      const t = firstWikilinkTarget(p);
      if (t !== null) names.add(canonicalNfc(t.trim()));
    }
  }
  if (fm.location) {
    const t = firstWikilinkTarget(fm.location);
    if (t !== null) names.add(canonicalNfc(t.trim()));
  }
  const wu = wrapUpFor.get(session);
  if (wu) {
    for (const n of extractMentions(publishedText(wu))) names.add(n);
  }
  return names;
}

function scoreByRecency(entities, sessions, chapters, options = {}) {
  const window = options.window || 3;
  const max = options.max || 6;
  const type = options.type;
  const wrapUpFor = options.wrapUpFor || new Map();

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

  // Mentions per recent session, recency-weighted (the most recent session counts most).
  const recent = recentSessions.map((session, i) => ({
    mentions: sessionMentions(session, wrapUpFor),
    weight: window - i,
  }));
  const latestMentions = recent[0].mentions;

  const currentChapter = chapters
    .filter(c => c.frontmatter.type === 'chapter')
    .sort((a, b) => (b.frontmatter.sort_order || 0) - (a.frontmatter.sort_order || 0))[0];
  const chapterMentions = currentChapter ? extractMentions(publishedText(currentChapter)) : new Set();

  const scored = entities.map(entity => {
    if (type && entity.frontmatter.type !== type) return null;
    const names = [entity.title, ...(entity.frontmatter.aliases || [])].map(canonicalNfc);

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
    // Title is a real secondary key, not decoration. Array.prototype.sort is
    // stable, so with score alone a cluster of equally-scoring entities kept
    // vault scan order — meaning `.slice(0, max)` below chose by where the
    // files happened to sit on disk. Deterministic, but invisible to the GM and
    // unchangeable by anything they could author (#169). Alphabetical is not
    // more "relevant", but it is explainable, and `featured_*` is the supported
    // way to override it.
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
    .slice(0, max);
}

module.exports = { scoreByRecency };
