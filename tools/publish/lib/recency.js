const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const TERMINAL_STATUSES = new Set(['dead', 'deceased', 'destroyed', 'kia', 'dissolved']);

function extractMentions(markdown) {
  const mentions = new Set();
  let match;
  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(markdown)) !== null) {
    mentions.add(match[1].trim());
  }
  return mentions;
}

function scoreByRecency(entities, sessions, chapters, options = {}) {
  const window = options.window || 3;
  const max = options.max || 6;
  const type = options.type;

  const played = sessions
    .filter(s => s.frontmatter.type === 'session' && (s.frontmatter.status === 'played' || s.frontmatter.status === 'reviewed'))
    .sort((a, b) => (b.frontmatter.session_number || 0) - (a.frontmatter.session_number || 0));

  const recentSessions = played.slice(0, window);
  if (recentSessions.length === 0) return [];

  const currentChapter = chapters
    .filter(c => c.frontmatter.type === 'chapter')
    .sort((a, b) => (b.frontmatter.sort_order || 0) - (a.frontmatter.sort_order || 0))[0];

  const filtered = entities.filter(e => {
    if (type && e.frontmatter.type !== type) return false;
    const status = String(e.frontmatter.status || '').toLowerCase();
    return !TERMINAL_STATUSES.has(status);
  });

  const scored = filtered.map(entity => {
    let score = 0;
    const names = [entity.title, ...(entity.frontmatter.aliases || [])];

    for (const session of recentSessions) {
      const mentions = extractMentions(session.markdown || '');
      const fm = session.frontmatter;
      const fmMentions = new Set();
      if (fm.participants) {
        for (const p of fm.participants) {
          const m = String(p).match(/\[\[([^\]|]+)/);
          if (m) fmMentions.add(m[1].trim());
        }
      }
      if (fm.location) {
        const m = String(fm.location).match(/\[\[([^\]|]+)/);
        if (m) fmMentions.add(m[1].trim());
      }

      for (const name of names) {
        if (mentions.has(name) || fmMentions.has(name)) {
          score += 2;
          break;
        }
      }
    }

    if (currentChapter) {
      const chapterMentions = extractMentions(currentChapter.markdown || '');
      for (const name of names) {
        if (chapterMentions.has(name)) {
          score += 1;
          break;
        }
      }
    }

    return { page: entity, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

module.exports = { scoreByRecency };
