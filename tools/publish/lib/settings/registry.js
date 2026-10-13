'use strict';
// The one declared list of every setting the publish tool reads. Each entry says what the
// setting is called, what it takes, what it is when left out, and the sentences the
// settings page uses. Nothing here may require this file back (no cycle).
//
// Entry fields: name, type (a key of TYPES), values / aliases / integer / min / max / of /
// shape (what the type needs), default, fallback (the word used when an unset setting is still needed; read as unset), guards (the hiding side), onFault, open, json /
// jsonKind / jsonMerge (the old name in vault.config.json), oldNames (each { name, in: 'site' for
// the site file, read: false when the old name is reported but its value is not read }), retired, state,
// container (a parent that holds only other settings), keepOnFault (an unreadable value is
// kept as written), keys (the only keys a map may hold), settable, group, does, left_out,
// same (how the build decides two entries of a list are one: 'heading', 'folder', 'callout'
// or 'name'; absent means exact text).
// The entries that carry `json` stay in the order of the old moved-key table.

const { SKINS, FRAME_IDS } = require('../skins');
const { RENDERER_IDS } = require('../templates/pc-registry');
const { VALID_PRESETS, GENRE_ALIASES } = require('../theme');

// The skin a sheet wears when neither the character nor the campaign names one. The setting reads
// as unset then (it has no `default`), so the sheet code asks for this word, `fallback`, instead.
const SKIN_FALLBACK = 'plain';

const GROUPS = [
  { id: 'site', title: 'The site itself' },
  { id: 'published', title: 'What gets published' },
  { id: 'theme', title: 'Theme' },
  { id: 'sheets', title: 'Character sheets' },
  { id: 'live', title: 'Live play' },
  { id: 'landing', title: 'The landing page' },
  { id: 'lists', title: 'Lists and pictures' },
];

const ON_OFF = { true: 'on', yes: 'on', false: 'off', no: 'off' };

const REGISTRY = [
  // The site itself
  {
    name: 'publish.site', type: 'switch', onFault: false, group: 'site',
    does: 'Whether this vault has a site',
    left_out: 'On when a site folder is set (`publish.site_dir`), otherwise off',
  },
  {
    name: 'publish.site_dir', type: 'text', group: 'site',
    shape: 'a folder path',
    does: 'The folder on this computer that holds the site',
    left_out: 'Setting up a site writes it',
  },
  {
    name: 'publish.site_title', type: 'text', json: 'siteTitle', jsonKind: 'scalar', group: 'site',
    does: 'The name in the menu bar and the browser tab',
    left_out: 'No title; setting up a site writes one',
  },
  {
    name: 'publish.footer', type: 'text', json: 'footer', jsonKind: 'scalar', group: 'site',
    does: 'A line at the foot of every page',
    left_out: 'No footer',
  },
  {
    name: 'publish.search', type: 'switch', default: true, json: 'searchEnabled', jsonKind: 'scalar', group: 'site',
    does: 'The search box',
    left_out: 'On',
  },
  {
    name: 'publish.link_previews', type: 'choice', values: ['on', 'desktop', 'off'], aliases: ON_OFF, default: 'on', group: 'site',
    does: 'The small card that opens when a reader rests on a link to another page, or taps it once on a phone. `on` shows it everywhere; `desktop` keeps it to a mouse and keyboard, so on a phone a tap goes straight to the page',
    left_out: '`on`',
  },
  {
    name: 'publish.connections', type: 'choice', values: ['tree', 'web', 'cards', 'off'],
    aliases: { true: 'tree', on: 'tree', yes: 'tree', false: 'off', no: 'off' }, default: 'tree', group: 'site',
    does: "How the Connections section on a page is drawn: what the page's subject is tied to, in tabs by kind (people, places, organisations and so on), with pages that only mention it in a last tab. `tree` is a branching list, readable on a phone; `web` puts the subject in the middle with names around it; `cards` gives a card for each; `off` leaves out the section and the list of mentions. `on`, `yes` and `true` read as `tree`; `no` and `false` as `off`",
    left_out: '`tree`',
  },
  {
    name: 'publish.four_oh_four.message', type: 'text', default: 'This page is not available.', group: 'site',
    does: 'The words a reader sees after following a link to a page that is not there',
    left_out: '"This page is not available."',
  },

  // What gets published
  {
    name: 'publish.mode', type: 'choice', values: ['player', 'full'], default: 'player', guards: true, onFault: 'player', group: 'published',
    does: '`player` leaves out any note still marked as prep (a planned session, a draft or outline, a scene that was cut) and, when the vault has a publish list, publishes only the notes on it. `full` publishes those too, for a private copy of your own',
    left_out: '`player`',
  },
  {
    name: 'publish.folder_map', type: 'map', open: true, default: {}, json: 'folderMap', jsonKind: 'map', group: 'published',
    shape: 'a vault folder and its address, one pair to a line',
    does: 'Which vault folders are published, and the web address each gets',
    left_out: 'Nothing is mapped; setting up a site writes the standard map',
  },
  {
    name: 'publish.attachments_dir', type: 'text', default: '_attachments', json: 'attachmentsDir', jsonKind: 'scalar', group: 'published',
    shape: 'a folder name',
    does: 'The vault folder that holds pictures',
    left_out: '`_attachments`',
  },
  {
    name: 'publish.system', type: 'choice', values: RENDERER_IDS, keepOnFault: true, json: 'system', jsonKind: 'scalar', group: 'site',
    shape: '`coc-7e` (Call of Cthulhu), `coc-7e-regency` (Regency Cthulhu), `gurps-4e`, `dnd-5e-2024`, `pf2e` (Pathfinder), `fitd` (Forged in the Dark); the short names `coc`, `regency-cthulhu`, `gurps`, `dnd-5e`, `dnd`, `blades`, `pathfinder-2e` and `pathfinder` work too',
    does: 'The game system, which decides how a character sheet is drawn',
    left_out: "A plain character page with no system's sheet",
  },
  {
    name: 'setting_year', type: 'text', group: 'site',
    shape: 'a year',
    does: 'An in-game year, shown on the landing page when the campaign overview gives no current date, and on a Call of Cthulhu sheet beside its era. Write it at the left edge of the file, beside `publish:`, not under it',
    left_out: 'Nothing shown',
  },
  {
    name: 'publish.exclude_dirs', type: 'list', same: 'folder', of: 'folders', default: ['_meta', '_Templates'], guards: true,
    json: 'excludeDirs', jsonKind: 'list', jsonMerge: 'union', group: 'published',
    does: 'Vault folders never published',
    left_out: '`_meta`, `_Templates`',
  },
  {
    name: 'publish.exclude_sections', type: 'list', same: 'heading', of: 'headings',
    default: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile'],
    guards: true, json: 'excludeSections', jsonKind: 'list', jsonMerge: 'union', group: 'published',
    does: 'Headings whose text is never published, on any page, however the heading is dressed (bold, a colon, a link)',
    left_out: '`GM Notes`, `DM Notes`, `Player Notes`, `Source References`, `Reconciliation Context`, `Handoff to Reconcile`',
  },
  {
    name: 'publish.exclude_fields', type: 'list', of: 'field names',
    default: ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability'],
    guards: true, json: 'excludeFields', jsonKind: 'list', jsonMerge: 'union', group: 'published',
    does: 'Fields in the block at the top of a note (between its `---` lines) that are never shown',
    left_out: '`secrets`, `current_plan`, `plan_progress`, `gm_notes`, `prep_notes`, `reliability`',
  },
  {
    name: 'publish.exclude_callouts', type: 'switchOrList', same: 'callout', of: 'callout types', default: false, onFault: true, guards: true,
    json: 'excludeCallouts', jsonKind: 'scalar', jsonMerge: 'stricter', group: 'published',
    does: 'Whether Obsidian callouts (`> [!note]`) are left out',
    left_out: 'Off; a site set up by the apprentice starts with it on',
  },
  {
    name: 'publish.exclude_drafts', type: 'switch', default: false, onFault: true, guards: true, group: 'published',
    does: 'Whether a note with `canon_status: DRAFT` at its top is left off the site',
    left_out: 'Off: drafts publish with a "Draft" badge',
  },
  {
    name: 'publish.overrides', type: 'map', guards: true, group: 'published',
    does: 'Exceptions to what is hidden. Only `fields` is read; any other key under it has no effect',
    left_out: 'No exceptions',
  },
  {
    name: 'publish.overrides.fields', type: 'map', open: true, default: {}, guards: true, group: 'published',
    shape: "a note's path from the top of the vault, in quotes, then `include:` and the field names",
    does: 'Lets one note show a field that `exclude_fields` hides everywhere else',
    left_out: 'No exceptions',
  },

  // Theme
  {
    name: 'publish.theme.genre', type: 'choice', values: [...VALID_PRESETS], aliases: GENRE_ALIASES, group: 'theme',
    does: 'A ready-made look: colours, lettering and section names. A genre the tool does not know is reported, and the site keeps the plain dark look',
    left_out: 'No preset',
  },
  {
    name: 'publish.theme.palette.primary', type: 'text', default: '#1a2f3a', group: 'theme',
    shape: 'a colour',
    does: "The main colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a2f3a`",
  },
  {
    name: 'publish.theme.palette.accent', type: 'text', default: '#3d8a7a', group: 'theme',
    shape: 'a colour',
    does: "The accent colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#3d8a7a`",
  },
  {
    name: 'publish.theme.palette.background', type: 'text', default: '#e8f0f3', group: 'theme',
    shape: 'a colour',
    does: "The page background colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#e8f0f3`",
  },
  {
    name: 'publish.theme.palette.text', type: 'text', default: '#1a1a1a', group: 'theme',
    shape: 'a colour',
    does: "The text colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a1a1a`",
  },
  {
    name: 'publish.theme.fonts.heading', type: 'text', default: 'system-ui', group: 'theme',
    shape: "a typeface's name",
    does: 'The lettering for headings',
    left_out: "The preset's lettering, or the reader's own system font",
  },
  {
    name: 'publish.theme.fonts.body', type: 'text', default: 'system-ui', group: 'theme',
    shape: "a typeface's name",
    does: 'The lettering for body text',
    left_out: "The preset's lettering, or the reader's own system font",
  },
  {
    name: 'publish.theme.fonts.source', type: 'choice', values: ['google', 'self-host', 'local'], default: 'google', group: 'theme',
    does: 'Where the lettering comes from: `self-host` (the site downloads the typefaces once and serves them itself), `google` (the reader\'s browser fetches them from Google Fonts) or `local` (your own font files). With `self-host` a reader\'s browser never contacts Google. A source the tool does not know is reported, and `google` is used',
    left_out: '`google`: what a vault that never set a source gets',
  },
  {
    name: 'publish.theme.fonts.files', type: 'any', default: [], group: 'theme',
    shape: 'a list of font files, each with a `family`, a `path`, and optionally a `weight` and `style`',
    does: 'Your own font files, each listed with its `family` (the typeface\'s name) and `path` (the file\'s place in the vault); used when the source is `local`',
    left_out: 'No files',
  },
  {
    name: 'publish.theme.campaign_image', type: 'text', group: 'theme',
    shape: "a picture's path in the vault",
    does: 'The large picture at the top of the landing page',
    left_out: 'No picture',
  },
  {
    name: 'publish.theme.default_mode', type: 'choice', values: ['system', 'dark', 'light'], default: 'system', group: 'theme',
    does: 'Whether a reader starts in light or dark',
    left_out: "`system`: follows the reader's device",
  },
  {
    name: 'publish.theme.tagline', type: 'text', oldNames: [{ name: 'landingTagline', in: 'site', read: false }], group: 'theme',
    does: 'One sentence under the title on the landing page',
    left_out: 'No tagline',
  },
  {
    name: 'publish.section_titles', type: 'map', default: {}, keys: ['locations', 'factions', 'items', 'creatures', 'documents'], group: 'theme',
    shape: '`locations`, `factions`, `items`, `creatures`, `documents`, each a title',
    does: 'Your own headings for the lists of locations, factions, items, creatures and documents',
    left_out: "Plain titles, or the genre's own",
  },

  // Character sheets
  {
    name: 'publish.character_sheets', type: 'switch', default: true, onFault: false, group: 'sheets',
    does: "Whether a character's page carries its sheet",
    left_out: 'On',
  },
  {
    name: 'publish.pc_prose_sections', type: 'list', same: 'heading', of: 'headings', default: [], group: 'sheets',
    does: "With sheets off, extra sections of a character's note that are still published",
    left_out: 'Only the built-in ones: Background, Current Status, Notes, Relationships, Appearances, Fellow Investigators, Encounters with Strange Entities, Friends & Rivals and Long-Term Projects',
  },
  {
    name: 'publish.sheet_skin', type: 'choice', values: Object.keys(SKINS), fallback: SKIN_FALLBACK, group: 'sheets',
    does: 'The look of every character sheet',
    left_out: `\`${SKIN_FALLBACK}\``,
  },
  {
    name: 'publish.sheet_frame', type: 'choice', values: ['none', ...FRAME_IDS], group: 'sheets',
    does: 'The ornament round each portrait',
    left_out: "The skin's own frame",
  },
  {
    name: 'publish.sheet_crest', type: 'text', json: 'sheet_crest', jsonKind: 'scalar', group: 'sheets',
    shape: "a picture's path in the vault",
    does: 'A crest or wax seal at the head of a Call of Cthulhu sheet',
    left_out: 'No crest',
  },
  {
    name: 'publish.tohit_calculator', type: 'choice', values: ['on', 'off'], aliases: ON_OFF, default: 'on', group: 'sheets',
    does: "The to-hit calculator on a GURPS character's Combat tab",
    left_out: '`on`',
  },
  {
    name: 'publish.dndbeyond_sync', type: 'choice', values: ['build', 'manual'], default: 'manual', group: 'sheets',
    does: 'When D&D characters that carry a D&D Beyond link are brought up to date: `build` before each site update, or `manual` only when you ask',
    left_out: '`manual`',
  },

  // Live play
  {
    name: 'publish.live_stats', type: 'switch', default: false, onFault: false, group: 'live',
    oldNames: [{ name: 'publish.backend.statusBar', in: 'vault' }, { name: 'backend.statusBar', in: 'site' }],
    does: 'Players change hit points, spent resources and conditions on their own sheet during a session, and the party board follows. For Call of Cthulhu, GURPS and D&D; it does nothing for Pathfinder or Forged in the Dark',
    left_out: 'Off',
  },
  {
    name: 'publish.inbox', type: 'switch', default: false, onFault: false, group: 'live',
    oldNames: [{ name: 'publish.backend.inbox', in: 'vault' }, { name: 'backend.inbox', in: 'site' }],
    does: 'A box on each character page for sending the GM a request or a question',
    left_out: 'Off',
  },

  // The landing page (the whole `landing` map is one old-file key, merged key by key)
  { name: 'publish.landing', type: 'map', container: true, json: 'landing', jsonKind: 'map', jsonMerge: 'perKey' },
  {
    name: 'publish.landing.max_npcs', type: 'number', integer: true, min: 0, default: 6, group: 'landing',
    does: 'How many people appear under "NPCs in Play"; `0` shows none',
    left_out: '`6`',
  },
  {
    name: 'publish.landing.max_locations', type: 'number', integer: true, min: 0, default: 4, group: 'landing',
    does: 'How many places appear under "Latest Locations"; `0` shows none',
    left_out: '`4`',
  },
  {
    name: 'publish.landing.max_events', type: 'number', integer: true, min: 0, default: 4, group: 'landing',
    does: 'How many events appear under "Latest Events"; `0` shows none',
    left_out: '`4`',
  },
  {
    name: 'publish.landing.recency_window', type: 'number', integer: true, min: 0, default: 3, group: 'landing',
    does: 'How many recent sessions decide who and what is "in play"; `0` counts none',
    left_out: '`3`',
  },
  {
    name: 'publish.landing.featured_npcs', type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'People pinned to the front of their row, in your order',
    left_out: 'Nobody pinned',
  },
  {
    name: 'publish.landing.featured_locations', type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'The same, for places',
    left_out: 'Nothing pinned',
  },
  {
    name: 'publish.landing.quick_links', type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'A short row of links on the page',
    left_out: 'No row',
  },
  {
    name: 'publish.landing.explore_descriptions', type: 'map', open: true, group: 'landing',
    shape: '`characters`, `locations`, `story`, `factions`, `items`, `creatures`, `events`, each a sentence',
    does: 'Your own line under each card in the "Explore the World" row',
    left_out: "The genre's lines, or plain ones",
  },

  // Lists and pictures
  { name: 'publish.images', type: 'map', container: true, json: 'images', jsonKind: 'map', jsonMerge: 'perKey' },
  {
    name: 'publish.images.optimize', type: 'switch', default: false, group: 'lists',
    does: 'Shrinks pictures as the site is built, which can cut a picture-heavy site to a fraction of its size',
    left_out: 'Off: pictures are copied as they are',
  },
  {
    name: 'publish.images.format', type: 'choice', values: ['webp'], default: 'webp', keepOnFault: true, group: 'lists',
    does: 'The format pictures are converted to. Only `webp` is available; any other is reported, and pictures are left as they are',
    left_out: '`webp`',
  },
  {
    name: 'publish.images.max_width', type: 'number', integer: true, min: 0, default: 1600,
    oldNames: [{ name: 'publish.images.maxWidth', in: 'vault' }], group: 'lists',
    does: 'The widest a shrunk picture may be, in pixels; `0` for no limit',
    left_out: '`1600`',
  },
  {
    name: 'publish.images.quality', type: 'number', min: 0, default: 82, group: 'lists',
    does: 'The quality of shrunk pictures: 0 is the smallest file, 100 the best picture, and anything above 100 counts as 100',
    left_out: '`82`',
  },
  {
    name: 'publish.banners', type: 'map', open: true, default: {}, json: 'banners', jsonKind: 'map', jsonMerge: 'perKey', group: 'lists',
    shape: "a section's web address, with a picture's path, or with `image`, `link` and `alt`",
    does: "A picture or map at the top of a section's list",
    left_out: "A picture named `_banner` in the section's vault folder is used if there is one",
  },
  { name: 'publish.locations', type: 'map', container: true, json: 'locations', jsonKind: 'map', jsonMerge: 'perKey' },
  {
    name: 'publish.locations.group_by', type: 'any', group: 'lists',
    shape: 'a kind of location, or `false`',
    does: 'Splits the list of locations into one block, under its own heading, for each place of a kind, such as each star system',
    left_out: 'Off, except the `scifi` genre, which groups by `system`',
  },
  {
    name: 'publish.locations.ungrouped_label', type: 'text', group: 'lists',
    does: 'The heading for places that fall in no block',
    left_out: 'A standard heading',
  },

  // Read by nothing: listed so a vault that still has them is told, not left guessing
  { name: 'publish.four_oh_four.style', type: 'any', retired: true },
  { name: 'publish.total_sessions', type: 'any', retired: true },
  { name: 'publish.wrap_up', type: 'any', retired: true },

  // The old container of the two live-play switches; its children are old names above
  { name: 'publish.backend', type: 'map', container: true },

  // Tool bookkeeping
  { name: 'publish.setup_progress', type: 'any', state: true, settable: false },
];

const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));

const entry = (name) => BY_NAME.get(name);
const names = () => REGISTRY.map((e) => e.name);

module.exports = { REGISTRY, entry, names, GROUPS };
