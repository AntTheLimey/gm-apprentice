function getLatestSession(pages) {
  const played = pages.filter(
    p => p.frontmatter.type === 'session' && (p.frontmatter.status === 'played' || p.frontmatter.status === 'reviewed')
  );
  if (played.length === 0) return null;
  // "Latest" = most recently played (by play_date), not highest session_number — chapters can
  // restart numbering. Fall back to session_number only when play dates tie or are absent.
  played.sort((a, b) => {
    const da = new Date(a.frontmatter.play_date || a.frontmatter.actual_date || 0).getTime() || 0;
    const db = new Date(b.frontmatter.play_date || b.frontmatter.actual_date || 0).getTime() || 0;
    if (db !== da) return db - da;
    return (b.frontmatter.session_number || 0) - (a.frontmatter.session_number || 0);
  });
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
    p => p.frontmatter.type === 'session' && (p.frontmatter.status === 'played' || p.frontmatter.status === 'reviewed')
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

const EXPLORE_DESCRIPTIONS = {
  horror: {
    characters: 'The investigators and their allies — and the things that hunt them.',
    locations: 'From candlelit parlours to fog-shrouded ruins.',
    story: 'The unfolding mystery, session by session.',
    factions: 'Secret societies, cults, and hidden powers.',
    items: 'Artefacts, tomes, and things best left undiscovered.',
    creatures: 'Horrors lurking in the dark.',
    events: 'Key moments in the investigation.',
  },
  fantasy: {
    characters: 'Heroes, villains, and the folk who inhabit this world.',
    locations: 'Kingdoms, dungeons, and the wild places between.',
    story: 'The saga of adventure, chapter by chapter.',
    factions: 'Guilds, orders, and powers vying for influence.',
    items: 'Legendary weapons, enchanted relics, and mundane gear.',
    creatures: 'Beasts, monsters, and mythical beings.',
    events: 'Battles, discoveries, and turning points.',
  },
  noir: {
    characters: 'Scoundrels, fixers, and the desperate.',
    locations: 'Rain-slicked streets and smoke-filled back rooms.',
    story: 'The score, the job, the aftermath.',
    factions: 'Gangs, crews, and institutions.',
    items: 'Tools of the trade — from lockpicks to ledgers.',
    creatures: 'Strange entities and supernatural threats.',
    events: 'Heists, betrayals, and consequences.',
  },
  military: {
    characters: 'Operatives, contacts, and targets.',
    locations: 'Theatres of operation and safe houses.',
    story: 'Mission logs and after-action reports.',
    factions: 'Units, agencies, and hostile forces.',
    items: 'Equipment, ordnance, and intelligence assets.',
    creatures: 'Unknown threats and anomalies.',
    events: 'Operations, engagements, and incidents.',
  },
};

const DEFAULT_DESCRIPTIONS = {
  characters: 'The people who drive this story.',
  locations: 'The places where events unfold.',
  story: 'The narrative arc of the campaign.',
  factions: 'Groups and organisations at play.',
  items: 'Notable objects and equipment.',
  creatures: 'Monsters and non-human entities.',
  events: 'Key moments and turning points.',
};

function getExploreDescriptions(genre, overrides) {
  const base = (genre && EXPLORE_DESCRIPTIONS[genre]) || DEFAULT_DESCRIPTIONS;
  return { ...base, ...(overrides || {}) };
}

function getRecentEvents(pages, max) {
  return pages
    .filter(p => p.frontmatter.type === 'event' && (p.frontmatter.in_game_date || p.frontmatter.date))
    .sort((a, b) => {
      const da = new Date(a.frontmatter.in_game_date || a.frontmatter.date);
      const db = new Date(b.frontmatter.in_game_date || b.frontmatter.date);
      return db - da;
    })
    .slice(0, max || 4);
}

function getLatestWrapUp(pages, session) {
  if (!session) return null;
  const wrapTypes = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);
  const wrapUps = pages.filter(p => wrapTypes.has(p.frontmatter.type));
  const num = session.frontmatter.session_number;
  if (num != null) {
    for (const wu of wrapUps) {
      if (wu.frontmatter.session_number === num) return wu;
    }
  }
  const sessionTitle = session.title || '';
  if (sessionTitle) {
    for (const wu of wrapUps) {
      const ref = String(wu.frontmatter.session || wu.title || '');
      if (ref === sessionTitle || ref.includes(sessionTitle)) return wu;
    }
  }
  return null;
}

module.exports = { getLatestSession, getLatestWrapUp, extractRecap, getInitials, getPCs, scoreNPCs, inferNPCRole, getRecentEvents, getExploreDescriptions };
