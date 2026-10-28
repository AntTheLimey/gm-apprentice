'use strict';
// The custom properties a theme may set (#363): the one list of them. docs/theme-tokens.md prints it
// (scripts/gen-theme-hooks-doc.js writes its tables), and test/theme-tokens.test.js builds a site and fails when a listed
// token is not declared where the list says, with the default it says, or when the tool's stylesheets read a custom
// property that is neither listed here nor named private below.
//
// A token here is a promise, as a hook in theme-hooks.js is: before one changes or goes, downstream tools are told in an
// issue first. Each default is what the tool's own rule used before the value was named, so a site that sets none of
// them looks exactly as it did.
//
// Each token: `name`, `group` (a key of GROUPS), `value` (its default, as the stylesheet writes it), `what` (what it
// colours or sizes) and where it lives:
//   'root'  declared in :root of css/style.css (the default)
//   'coc'   declared on the Call of Cthulhu sheet (.coc-sheet-root and its change-request dialog), the sheet's own inks
//   'unset' declared nowhere: each rule that reads it falls back to what it used before (`value` says what); a theme
//           or a setting declares it
// `light`: the default in the light palette, when it has one of its own.

const GROUPS = [
  { id: 'palette', title: 'Palette', about: 'The colours every page is built from. A genre preset, a custom palette (theme.css) and a sheet skin all set these.' },
  { id: 'header', title: 'Header and hero', about: 'The menu bar and the landing title area stay dark in both palettes, so their words have inks of their own.' },
  { id: 'fonts', title: 'Typefaces', about: '`player_site.theme.fonts.heading`, `body` and `label` write the first three into theme.css.' },
  { id: 'size', title: 'Type sizes', about: "Sizes that recur exactly in the site's own rules. The number is the size in thousandths of a rem: `--font-size-875` is 0.875rem. The character sheets keep their own sizes." },
  { id: 'space', title: 'Spacing', about: 'Margins, padding and gaps on a quarter-rem scale, in the site\'s own rules (not the sheets). The number is thousandths of a rem.' },
  { id: 'radius', title: 'Corners', about: 'Corner radii that recur in the site\'s own rules. The number is thousandths of a rem.' },
  { id: 'surface', title: 'Pictures, buttons and small things', about: '' },
  { id: 'state', title: 'Statuses', about: 'The badges that say how a character, chapter or session stands.' },
  { id: 'lists', title: 'Bestiary, locations, factions and items', about: '' },
  { id: 'notfound', title: 'The page-not-found page', about: 'Its styles are written into the page itself, after every stylesheet, so a theme reaches its Home button through these two names rather than `--on-accent`.' },
  { id: 'hero', title: 'Landing hero', about: 'Written by the build from `player_site.landing.hero.*` on a full-bleed hero; a theme may set them instead.' },
  { id: 'gurps', title: 'GURPS sheet', about: 'Each part of the sheet has its own hue, and a tint of it for row backgrounds. A sheet skin sets these.' },
  { id: 'live', title: 'Live party board', about: 'The GURPS and Call of Cthulhu party boards and their status badges.' },
  { id: 'coc', title: 'Call of Cthulhu sheet', about: 'The parchment sheet\'s inks and faces, declared on the sheet itself (`.coc-sheet-root`), so no other page sees them. A sheet skin sets the first ten.' },
];

const T = (group, name, value, what, more = {}) => ({ group, name, value, what, scope: 'root', ...more });

const TOKENS = [
  T('palette', '--bg', '#1a1f25', 'The page background'),
  T('palette', '--bg-card', '#232830', 'Cards, panels and boxes'),
  T('palette', '--bg-header', '#0d1117', 'The menu bar'),
  T('palette', '--bg-hero', '#0d1117', 'The landing title area, and the shade behind a full-bleed hero\'s words'),
  T('palette', '--text', '#c9d1d9', 'Body text'),
  T('palette', '--text-muted', '#8b949e', 'Secondary text: captions, labels, dates'),
  T('palette', '--accent', '#58a6ff', 'Links, headings\' rules, active controls'),
  T('palette', '--accent-dim', 'rgba(88, 166, 255, 0.15)', 'A faint wash of the accent: hovered rows, badges'),
  T('palette', '--border', '#30363d', 'Lines and edges'),
  T('palette', '--danger', '#f85149', 'Warnings that matter, wounds, low numbers'),
  T('palette', '--warning', '#d29922', 'Cautions, stubs, the GM site\'s band'),
  T('palette', '--success', '#3fb950', 'Good news, live markers'),
  T('header', '--accent-on-header', 'var(--accent)', 'The accent on the dark menu bar and landing title area'),
  T('header', '--text-on-header', 'var(--text)', 'Words on the menu bar and landing title area', { scope: 'unset' }),
  T('header', '--text-muted-on-header', 'var(--text-muted)', 'Quieter words there: the menu\'s group names, the search button', { scope: 'unset' }),
  T('fonts', '--font-heading', 'system-ui, -apple-system, sans-serif', 'Headings and the site\'s name'),
  T('fonts', '--font-body', 'system-ui, -apple-system, sans-serif', 'Body text'),
  T('fonts', '--font-label', 'each element keeps the face it has: the one it inherits (the body face, or a sheet\'s, a backstory\'s or a site\'s own), or its own where a rule sets one', 'The menu, labels, table heads, badges, buttons, meta lines and date labels', { scope: 'unset' }),
  T('fonts', '--font-mono', 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, monospace', 'Numbers and code'),
  T('fonts', '--font-serif', 'Georgia, "Times New Roman", serif', 'A story page\'s prose'),
  T('fonts', '--font-reading', "Georgia, 'Iowan Old Style', 'Times New Roman', serif", 'A character\'s backstory and hook'),
  ...[650, 700, 750, 800, 850, 875, 900, 950, 1000, 1100].map((n) => T('size', `--font-size-${n}`, `${n / 1000}rem`, 'Type size')),
  ...[250, 500, 750, 1000, 1250, 1500, 2000].map((n) => T('space', `--space-${n}`, `${n / 1000}rem`, 'Margin, padding or gap')),
  ...[200, 250, 375, 500, 750].map((n) => T('radius', `--radius-${n}`, `${n / 1000}rem`, 'Corner radius')),
  T('surface', '--on-accent', 'white on the story page\'s Begin button and the change-request Send button; `var(--bg)` on the other accent-filled controls', 'Words on a control filled with the accent (a hovered pill, menu link or prop button, Begin, Send, back to top)', { scope: 'unset' }),
  T('surface', '--text-on-image', '#fff', 'Words laid over a picture: an entity page\'s banner, the lightbox'),
  T('surface', '--on-warning', '#1a1a1a', 'Words on the GM site\'s band'),
  T('surface', '--badge-draft', '#e8b84d', 'The DRAFT badge'),
  T('surface', '--story-muted', '#888', 'The story page\'s small labels (read through `--muted` when that is set)'),
  T('surface', '--quick-link-border', 'rgba(0, 0, 0, 0.15)', 'The edge of a landing quick link (read through `--color-border` when that is set)'),
  T('surface', '--search-mark-bg', 'rgba(88, 166, 255, 0.2)', 'The words a search matched'),
  T('surface', '--needs-dev-bg', 'rgba(210, 153, 34, 0.1)', 'A "needs development" box'),
  // (Spelled out as token names: the status words themselves are the settings list's, written once.)
  ...[['--status-alive', '#3fb950', 'rgba(46,160,67,0.2)'], ['--status-dead', '#f85149', 'rgba(218,54,51,0.2)'], ['--status-missing', '#d29922', 'rgba(210,153,34,0.2)'],
    ['--status-captured', '#a371f7', 'rgba(130,80,223,0.2)'], ['--status-presumed-dead', '#da6d6a', 'rgba(218,54,51,0.15)'], ['--status-retired', '#8b949e', 'rgba(110,118,129,0.2)']]
    .flatMap(([name, c, b]) => [T('state', name, c, `The words of a status badge (${name.slice(9).replace('-', ' ')})`), T('state', `${name}-bg`, b, 'Its background')]),
  T('state', '--status-kia-bg', 'rgba(248, 81, 73, 0.15)', 'A KIA badge\'s background (its words are `--danger`)'),
  T('state', '--status-mia-bg', 'rgba(210, 153, 34, 0.15)', 'An MIA badge\'s background (its words are `--warning`)'),
  T('state', '--chapter-complete', '#50c878', 'A finished chapter\'s badge, and a played session\'s tick'),
  T('state', '--chapter-complete-bg', 'rgba(80, 200, 120, 0.15)', 'A finished chapter\'s badge background'),
  T('state', '--chapter-active-bg', 'rgba(184, 150, 46, 0.15)', 'The current chapter\'s badge background'),
  T('state', '--chapter-upcoming-bg', 'rgba(150, 150, 150, 0.15)', 'A chapter to come: its badge background'),
  T('state', '--tl-session', '#3fb950', 'A session\'s label on the timeline'),
  T('state', '--tl-session-bg', 'rgba(46,160,67,0.2)', 'Its background'),
  T('lists', '--bestiary-edge', '#c0392b', 'The edge of a bestiary card'),
  ...[['extreme', '#e74c3c', '192, 57, 43'], ['high', '#e67e22', '230, 126, 34'], ['moderate', '#f1c40f', '241, 196, 15']].flatMap(([k, c, a]) => [
    T('lists', `--threat-${k}`, c, `A "${k}" threat badge's words`),
    T('lists', `--threat-${k}-bg`, `rgba(${a}, 0.2)`, 'Its background'),
    T('lists', `--threat-${k}-border`, `rgba(${a}, 0.4)`, 'Its edge')]),
  T('lists', '--threat-unknown-bg', 'rgba(150, 150, 150, 0.15)', 'An unknown threat badge\'s background'),
  T('lists', '--creature-killed', '#50c878', 'A "killed" creature badge\'s words'),
  T('lists', '--creature-killed-bg', 'rgba(80, 200, 120, 0.15)', 'Its background'),
  T('lists', '--creature-killed-border', 'rgba(80, 200, 120, 0.3)', 'Its edge'),
  T('lists', '--creature-active', '#e74c3c', 'An "active" creature badge\'s words'),
  T('lists', '--creature-active-bg', 'rgba(192, 57, 43, 0.15)', 'Its background'),
  T('lists', '--creature-active-border', 'rgba(192, 57, 43, 0.3)', 'Its edge'),
  T('lists', '--creature-unknown-bg', 'rgba(150, 150, 150, 0.1)', 'An unknown creature badge\'s background'),
  T('lists', '--bestiary-ability-bg', 'rgba(184, 150, 46, 0.12)', 'A creature\'s ability pill'),
  T('lists', '--bestiary-ability-border', 'rgba(184, 150, 46, 0.3)', 'Its edge'),
  T('lists', '--bestiary-weakness', '#50c878', 'A creature\'s weakness pill: its words'),
  T('lists', '--bestiary-weakness-bg', 'rgba(80, 200, 120, 0.1)', 'Its background'),
  T('lists', '--bestiary-weakness-border', 'rgba(80, 200, 120, 0.25)', 'Its edge'),
  T('lists', '--loc-type-bg', 'rgba(184, 150, 46, 0.12)', 'A location\'s type badge'),
  T('lists', '--loc-type-border', 'rgba(184, 150, 46, 0.25)', 'Its edge'),
  ...[['military', '#9ab856', 'rgba(107, 142, 35, 0.2)'], ['corporation', '#7ab4d9', 'rgba(70, 130, 180, 0.2)'], ['government', '#a0b0c0', 'rgba(112, 128, 144, 0.2)']]
    .flatMap(([k, c, b]) => [T('lists', `--intel-${k}`, c, `A ${k} faction's type badge: its words`), T('lists', `--intel-${k}-bg`, b, 'Its background')]),
  T('lists', '--intel-other-bg', 'rgba(139, 148, 158, 0.15)', 'Any other faction\'s type badge'),
  T('lists', '--intel-canon-bg', 'rgba(139, 148, 158, 0.1)', 'A faction\'s leadership tag'),
  T('lists', '--armory-tl', '#9ab856', 'An item\'s tech-level tag: its words'),
  T('lists', '--armory-tl-bg', 'rgba(107, 142, 35, 0.2)', 'Its background'),
  T('notfound', '--theme-accent', 'var(--accent)', 'The page-not-found message and its Home button\'s fill', { scope: 'unset' }),
  T('notfound', '--white', 'white (`#fff`)', 'The words on the page-not-found Home button (the story page\'s Begin button reads it too, after `--on-accent`)', { scope: 'unset' }),
  T('hero', '--hero-focus', 'center', 'The part of the picture a full-bleed hero keeps in view', { scope: 'unset' }),
  T('hero', '--hero-focus-narrow', 'var(--hero-focus, center)', 'The same, on a screen narrower than 768 pixels', { scope: 'unset' }),
  ...[['attr', '#4ade80', 'rgba(22, 163, 74, 0.14)', '#15803d', '#eafaf0', 'Attributes'], ['social', '#fbbf24', 'rgba(217, 119, 6, 0.14)', '#b45309', '#fdf4e7', 'Social traits'],
    ['trait', '#fb923c', 'rgba(234, 115, 23, 0.14)', '#c2410c', '#fdf1e7', 'Advantages and disadvantages'], ['skill', '#818cf8', 'rgba(99, 102, 241, 0.14)', '#4f46e5', '#eef0fe', 'Skills'],
    ['spell', '#a78bfa', 'rgba(139, 92, 246, 0.14)', '#7c3aed', '#f3eefe', 'Spells'], ['table', '#38bdf8', 'rgba(2, 132, 199, 0.14)', '#0369a1', '#e8f5fc', 'Weapon and equipment tables'],
    ['points', '#94a3b8', 'rgba(100, 116, 139, 0.12)', '#475569', '#eef1f5', 'The points summary'], ['def', '#f87171', 'rgba(220, 38, 38, 0.14)', '#b91c1c', '#fdecec', 'Defences']]
    .flatMap(([k, c, b, lc, lb, what]) => [T('gurps', `--gc-${k}`, c, `${what}: headings, labels and edges`, { light: lc }), T('gurps', `--gc-${k}-bg`, b, `${what}: row tint`, { light: lb })]),
  T('gurps', '--gc-enc-0', 'rgba(22, 163, 74, 0.10)', 'Encumbrance level 0 (level 1 has no tint)', { light: '#eafaf0' }),
  T('gurps', '--gc-enc-2', 'rgba(217, 119, 6, 0.10)', 'Encumbrance level 2', { light: '#fdf4e7' }),
  T('gurps', '--gc-enc-3', 'rgba(234, 115, 23, 0.12)', 'Encumbrance level 3', { light: '#fdf1e7' }),
  T('gurps', '--gc-enc-4', 'rgba(220, 38, 38, 0.14)', 'Encumbrance level 4', { light: '#fdecec' }),
  T('gurps', '--gc-dmg-bg', 'rgba(2, 132, 199, 0.10)', 'The damage column of a weapon table', { light: 'rgba(2, 132, 199, 0.08)' }),
  T('gurps', '--gc-reeling', '#f85149', 'The live panel\'s Reeling badge'),
  T('gurps', '--gc-reeling-bg', 'rgba(218,54,51,0.18)', 'Its background'),
  T('gurps', '--gc-tired', '#d29922', 'The live panel\'s Tired badge'),
  T('gurps', '--gc-tired-bg', 'rgba(210,153,34,0.2)', 'Its background'),
  T('live', '--live-reeling', '#ef7c3a', 'A Reeling badge on the party board'),
  T('live', '--live-reeling-bg', 'rgba(239,124,58,0.14)', 'Its background, and the tint of a reeling row'),
  T('live', '--live-tired', '#5b9bd5', 'A Tired badge on the party board'),
  T('live', '--live-tired-bg', 'rgba(91,155,213,0.15)', 'Its background, and the tint of a tired row'),
  T('live', '--live-bar-bg', 'rgba(128,128,128,0.2)', 'The track behind a points bar'),
  T('live', '--live-bar-third', 'rgba(255,255,255,0.3)', 'The one-third mark on a points bar'),
  T('live', '--live-bar-fp', '#5b9bd5', 'The fatigue bar'),
  T('live', '--live-bar-san', '#9d7bd8', 'The Sanity bar'),
  T('live', '--live-bar-mp', '#4ba3c7', 'The magic points bar'),
  ...[['insanity', '#b98be0', 'rgba(157,123,216,0.16)'], ['wound', '#e06b5c', 'rgba(192,57,43,0.18)'], ['unconscious', '#d4a017', 'rgba(212,160,23,0.18)'], ['dying', '#ff6b6b', 'rgba(192,57,43,0.28)']]
    .flatMap(([k, c, b]) => [T('live', `--live-${k}`, c, `A Call of Cthulhu "${k}" badge`), T('live', `--live-${k}-bg`, b, 'Its background')]),
  T('live', '--live-row-mad', 'rgba(157,123,216,0.14)', 'The tint of an insane investigator\'s row'),
  T('live', '--live-row-hurt', 'rgba(192,57,43,0.15)', 'The tint of a wounded investigator\'s row'),
  ...[['--paper', '#e7ddc3', 'The sheet\'s paper'], ['--paper-2', '#f3ecd8', 'Lighter paper'], ['--ink', '#241d13', 'The ink'], ['--ink-soft', '#5a4b36', 'Softer ink'],
    ['--ink-mid', '#6f5c40', 'Faded ink: hints, small numbers'], ['--rule', '#7c6a4d', 'Ruled lines and boxes'], ['--rule-soft', '#b6a483', 'Fainter rules'],
    ['--oxblood', '#6e2318', 'The red ink: headings, labels, filled marks'], ['--oxblood-2', '#8a3222', 'A second red'],
    ['--box', '#fbf6e7', 'Boxes and panels'],
    ['--didone', '"Didot","Bodoni 72","Bodoni MT","Playfair Display","Hoefler Text","Georgia",serif', 'The display face'],
    ['--body', '"Baskerville","Libre Baskerville","Hoefler Text","Georgia","Times New Roman",serif', 'The text face'],
    ['--on-oxblood', '#f3e6df', 'Words on the red: the insane badge, Send, a lit condition, the open tab'],
    ['--sheet-edge', '#100c06', 'The sheet\'s and its dialog\'s outer edge'], ['--portrait-mat', '#fbf6e7', 'The mat round the portrait'],
    ['--input-paper', '#fffdf6', 'The change-request text box'], ['--ink-live', '#3d6b3a', 'A change request the board has taken'],
    ['--oxblood-3', '#7c2a1e', 'The second stripe of the Sanity bar\'s fill'], ['--sanbar-from', '#8a3b2c22', 'The Sanity bar\'s track, left'],
    ['--sanbar-to', '#8a3b2c0a', 'The Sanity bar\'s track, right'], ['--tab-paper', '#dccfae', 'A closed folio tab, top'], ['--tab-paper-2', '#d0c3a0', 'A closed folio tab, bottom']]
    .map(([name, value, what]) => T('coc', name, value, what, { scope: 'coc' })),
];

// Custom properties the tool's stylesheets read that are not promised: each may change in any release.
const PRIVATE = [
  { match: /^--cxi?c?-/, why: 'The connections web\'s inks, worked out by its script for contrast' },
  { match: /^--cat(-bg)?$/, why: 'A GURPS sheet block\'s hue, copied from its --gc-* pair' },
  { match: /^--(sk-[\w-]+|frame)$/, why: 'A sheet skin\'s own workings' },
  { match: /^--callout-color$/, why: 'A callout\'s colour, set per callout' },
  { match: /^--(muted|surface|color-border|color-surface|color-accent)$/, why: 'Older names a rule still reads before its listed default; set the listed token instead' },
];

const isPrivate = (name) => PRIVATE.some((p) => p.match.test(name));

module.exports = { GROUPS, TOKENS, PRIVATE, isPrivate };
