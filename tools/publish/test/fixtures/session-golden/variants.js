'use strict';

// Vaults of recap-in-hub sessions (no Wrap-Ups: the hub body is the session's record),
// written fresh for each build. Shared by generate.js, which records what the publish
// tool at 1.10.17 (before #276) rendered, and test/integration/session-golden.test.js,
// which requires the current tool to render the same thing.
const fs = require('fs');
const path = require('path');

const sess = (n, title, extra = '') => `---\ntype: session\nsession_number: ${n}\nplay_date: "2026-0${n}-01"\nstatus: played\nstage: complete\n${extra}---\n\n# ${title}\n\nThe party fought [[Ghoul King]] in the ruins. Full prose recap here.\n\n## What the Party Learned\n\n- The crater glows\n- The Queen lies\n`;

const VARIANTS = {
  flat: {
    'Sessions/Session 01 - Arrival.md': sess(1, 'Session 01 - Arrival'),
    'Sessions/Session 02 - Crater.md': sess(2, 'Session 02 - Crater'),
    'Sessions/Session 03 - Queen.md': sess(3, 'Session 03 - Queen'),
  },
  sortorder: {
    'Sessions/Session 01 - Arrival.md': sess(1, 'Session 01 - Arrival', 'sort_order: 3\n'),
    'Sessions/Session 02 - Crater.md': sess(2, 'Session 02 - Crater', 'sort_order: 1\n'),
    'Sessions/Session 03 - Queen.md': sess(3, 'Session 03 - Queen', 'sort_order: 2\n'),
  },
  ties: {
    'Sessions/Session A.md': sess(1, 'Session A'),
    'Sessions/Session B.md': sess(1, 'Session B'),
    'Sessions/Session C.md': '---\ntype: session\nstatus: played\n---\n\n# C\n\ntext\n',
  },
  // Chapters restart numbering; #276 regroups prev/next by chapter, so this variant's
  // story-nav differs from 1.10.17 on purpose and the test compares everything else.
  chapters: {
    'Chapters/Ch1/Ch1.md': '---\ntype: chapter\nsort_order: 1\n---\n\n# Ch1\n',
    'Chapters/Ch2/Ch2.md': '---\ntype: chapter\nsort_order: 2\n---\n\n# Ch2\n',
    'Chapters/Ch1/Session 01 - A.md': sess(1, 'Session 01 - A', 'chapter: "[[Ch1]]"\n'),
    'Chapters/Ch1/Session 02 - B.md': sess(2, 'Session 02 - B', 'chapter: "[[Ch1]]"\n'),
    'Chapters/Ch2/Session 01 - C.md': sess(1, 'Session 01 - C', 'chapter: "[[Ch2]]"\n'),
  },
};

// Build `variant` with the publish tool at `libRoot` into `work`; returns the docs dir.
function buildVariant(libRoot, work, variant) {
  const { build } = require(path.join(path.resolve(libRoot), 'lib', 'build'));
  const vault = path.join(work, 'vault');
  const docs = path.join(work, 'docs');
  fs.rmSync(work, { recursive: true, force: true });
  const files = Object.assign({}, VARIANTS[variant], {
    'Characters/NPCs/Ghoul King.md': '---\ntype: npc\n---\n\n# Ghoul King\n\nBig.\n',
  });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(vault, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const configPath = path.join(work, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault, outputDir: docs,
    excludeDirs: ['_meta'],
    folderMap: { Sessions: 'sessions', Chapters: 'chapters', 'Characters/NPCs': 'characters/npcs' },
  }));
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
  return docs;
}

// The `<main class="content">` block of every session page: badges, the page-title H1,
// the body with its "What the Party Learned" list, and the story-nav.
function mainBlocks(docs) {
  const blocks = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/^session-.*\.html$/.test(e.name)) {
        const html = fs.readFileSync(full, 'utf8');
        const m = html.match(/<main class="content">[\s\S]*?<\/main>/);
        blocks[path.relative(docs, full).split(path.sep).join('/')] = m ? m[0] : null;
      }
    }
  };
  walk(docs);
  return blocks;
}

module.exports = { VARIANTS, buildVariant, mainBlocks };
