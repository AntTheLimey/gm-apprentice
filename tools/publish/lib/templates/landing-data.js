function getLatestSession(pages) {
  const played = pages.filter(
    p => p.frontmatter.type === 'session' && p.frontmatter.status === 'played'
  );
  if (played.length === 0) return null;
  played.sort((a, b) => (b.frontmatter.session_number || 0) - (a.frontmatter.session_number || 0));
  return played[0];
}

function stripWikiLinks(text) {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
}

function extractRecap(page) {
  if (!page) return null;
  const md = page.markdown;
  if (!md) return null;

  const recapMatch = md.match(/^## Narrative Recap\s*$/m);
  let paragraph;

  if (recapMatch) {
    const after = md.slice(recapMatch.index + recapMatch[0].length);
    const nextHeading = after.search(/^## /m);
    const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
    const paragraphs = section.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    paragraph = paragraphs[0] || null;
  } else {
    const withoutH1 = md.replace(/^# .+\n+/, '');
    const paragraphs = withoutH1.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    paragraph = paragraphs[0] || null;
  }

  if (!paragraph) return null;

  paragraph = stripWikiLinks(paragraph);

  if (paragraph.length > 500) {
    const truncated = paragraph.slice(0, 500);
    const lastSpace = truncated.lastIndexOf(' ');
    paragraph = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return paragraph;
}

function getInitials(name) {
  if (!name) return '';
  const words = name.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function getPCs(pages) {
  return pages
    .filter(p => p.frontmatter.type === 'pc')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

const PATRON_TAGS = new Set(['employer', 'patron']);
const ANTAGONIST_TAGS = new Set(['villain', 'antagonist']);
const COMPANION_TAGS = new Set(['companion', 'ally']);
const THREAT_TAGS = new Set(['super', 'fragment-empowered']);
const IMPORTANCE_TAGS = new Set([
  'employer', 'patron', 'villain', 'antagonist', 'rival',
  'companion', 'ally', 'recurring', 'boss',
]);

function inferNPCRole(npc, sessionCount) {
  const tags = new Set(npc.frontmatter.tags || []);
  const rels = npc.frontmatter.relationships || [];

  if ([...PATRON_TAGS].some(t => tags.has(t)) || rels.some(r => r.type === 'employs')) return 'Patron';
  if ([...ANTAGONIST_TAGS].some(t => tags.has(t))) return 'Antagonist';
  if ([...COMPANION_TAGS].some(t => tags.has(t))) return 'Companion';
  if ([...THREAT_TAGS].some(t => tags.has(t))) return 'Threat';
  if (rels.some(r => r.type === 'leads' || r.type === 'commands')) return 'Leader';
  if (sessionCount >= 2) return 'Recurring';
  return 'NPC';
}

function scoreNPCs(allPages) {
  const npcs = allPages.filter(p => p.frontmatter.type === 'npc');
  const sessions = allPages.filter(
    p => p.frontmatter.type === 'session' && p.frontmatter.status === 'played'
  );

  const scored = npcs.map(npc => {
    let score = 0;
    let sessionCount = 0;
    const names = [npc.title, ...(npc.frontmatter.aliases || [])];

    for (const session of sessions) {
      const md = session.markdown || '';
      const mentioned = names.some(name => md.includes(`[[${name}]]`));
      if (mentioned) {
        score += 2;
        sessionCount++;
      }
    }

    const rels = npc.frontmatter.relationships || [];
    score += rels.length;

    const tags = npc.frontmatter.tags || [];
    for (const tag of tags) {
      if (IMPORTANCE_TAGS.has(tag)) score += 3;
    }

    if (rels.some(r => r.type === 'leads' || r.type === 'commands')) score += 2;

    if (tags.some(t => THREAT_TAGS.has(t))) score += 2;

    const role = inferNPCRole(npc, sessionCount);

    return { page: npc, score, role };
  });

  return scored
    .filter(s => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

module.exports = { getLatestSession, extractRecap, getInitials, getPCs, scoreNPCs, inferNPCRole };
