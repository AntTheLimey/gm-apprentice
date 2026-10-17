'use strict';
// The one declared list of every setting the publish tool reads. Each entry says what the
// setting is called, what it takes, what it is when left out, and the sentences the
// settings page uses. Nothing here may require this file back (no cycle).
//
// Entry fields: name (the new name), type (a key of TYPES), values / aliases / integer / min / max /
// of / shape (what the type needs), default, fallback (the word used when an unset setting is still
// needed; read as unset), guards (the hiding side), onFault, open, was (the names this setting had
// in the old layout, in order of precedence: each { name, in: 'vault' for _meta/vault-config.md or
// 'site' for the site's vault.config.json, read: false when the old name is reported but its value
// is not read, carryOnly: true when the reader neither reads nor reports it and only the move carries it, shows: the plain words for what that value changes on the site, told when the move carries it }; the first 'vault' one is where the old file holds it), legacyKind (scalar, list or
// map: the setting is also a key of the site file, named by its 'site' was), legacyMerge (how the
// two old files combine: union, stricter or perKey), legacyOnly (exists only in the old file; its
// name stays the old one), retired (read by nothing: a vault that writes it is warned; `retiredSays` finishes the sentence "<name> ..."), state, container (a parent that holds only other settings),
// keepOnFault (an unreadable value is kept as written), keys (the only keys a map may hold),
// onWhenSet (the switch is on when the setting this names holds text), defaultFromVaultFolder (unset, the
// value is the vault folder's name), settable, group, does, left_out, same (how the build decides two entries of a list are one:
// 'heading', 'folder', 'callout' or 'name'; for a `listOfMaps`, the field two entries are told apart by; absent means exact text),
// fields (a `listOfMaps` entry's keys: { key: { required?: true } }, each text), siteFallback (also a key of the site
// folder's vault.config.json that is read while the vault sets none), stepsFrom (the site's package.json script a build-steps list was; the move carries it), check ('output' or 'keep': a rule on the value
// beyond its type, folders.js) and stopOnFault (an unreadable value stops the build, as a hiding setting does).
// The entries that carry `legacyKind` stay in the order of the old moved-key table.

const { SKINS, FRAME_IDS } = require('../skins');
const { SYSTEM_IDS, SYSTEM_NAMES, SYSTEM_ALIASES } = require('../shared-lists');
const { VALID_PRESETS, GENRE_ALIASES } = require('../theme');

// The skin a sheet wears when neither the character nor the campaign names one. The setting reads
// as unset then (it has no `default`), so the sheet code asks for this word, `fallback`, instead.
const SKIN_FALLBACK = 'plain';

// The game systems the setting takes, from the shared list: each id with its name, then the aliases.
const SYSTEM_SHAPE = `${SYSTEM_IDS.map((id) => `\`${id}\` (${SYSTEM_NAMES[id]})`).join(', ')}; the short names ${
  Object.keys(SYSTEM_ALIASES).map((a) => `\`${a}\``).join(', ').replace(/, ([^,]*)$/, ' and $1')} work too`;

const GROUPS = [
  { id: 'vault', title: 'The vault' },
  { id: 'site', title: 'The site itself' },
  { id: 'published', title: 'What gets published' },
  { id: 'theme', title: 'Theme' },
  { id: 'sheets', title: 'Character sheets' },
  { id: 'live', title: 'Live play' },
  { id: 'landing', title: 'The landing page' },
  { id: 'lists', title: 'Lists and pictures' },
  { id: 'limits', title: 'Limits' },
  { id: 'gm', title: 'The GM site' },
];

const ON_OFF = { true: 'on', yes: 'on', false: 'off', no: 'off' };

const REGISTRY = [
  // The vault itself
  {
    name: 'vault.kept_by', type: 'choice', values: ['gm', 'player'], default: 'gm', group: 'vault',
    does: 'Who keeps this vault: `gm` for the game master, `player` for a player keeping notes on a campaign they are in',
    left_out: '`gm`',
  },
  {
    name: 'vault.campaign', type: 'text', defaultFromVaultFolder: true, group: 'vault',
    shape: "the campaign's name",
    does: "The campaign's name",
    left_out: "The vault folder's name",
  },

  // The status words a note's `status:` is compared with. A word in a note is trimmed and lower-cased first.
  { name: 'vault.statuses', type: 'map', container: true },
  {
    name: 'vault.statuses.out_of_play', type: 'list', of: 'status words', group: 'vault',
    default: ['dead', 'deceased', 'kia', 'retired', 'departed', 'missing', 'unknown', 'inactive', 'npc', 'destroyed', 'dissolved'],
    does: 'The statuses that take a character out of play. A character with one leaves the party board and the active team on the landing page, and is listed under "In Memoriam" instead; their sheet page stays. An empty list means nobody is ever out of play',
    left_out: '`dead`, `deceased`, `kia`, `retired`, `departed`, `missing`, `unknown`, `inactive`, `npc`, `destroyed`, `dissolved`',
  },
  {
    name: 'vault.statuses.fallen', type: 'list', of: 'status words', group: 'vault',
    default: ['dead', 'deceased', 'kia', 'missing', 'unknown'],
    does: 'The statuses that put a character under "Fallen" on the Story page. Each must also be in `vault.statuses.out_of_play`; one that is not is left out, with a warning. `retired` always has its own group',
    left_out: '`dead`, `deceased`, `kia`, `missing`, `unknown`',
  },
  {
    name: 'vault.statuses.gone', type: 'list', of: 'status words', group: 'vault',
    default: ['dead', 'deceased', 'destroyed', 'kia', 'dissolved'],
    does: 'The statuses of things that no longer exist. A note with one is left off the landing page\'s "NPCs in Play" and "Latest Locations" unless the latest session mentions it. An empty list drops nothing',
    left_out: '`dead`, `deceased`, `destroyed`, `kia`, `dissolved`',
  },

  // Numbers the vault scripts (not the site build) read
  {
    name: 'vault.stale_after_sessions', type: 'number', integer: true, min: 1, default: 3, group: 'vault',
    does: 'How many sessions a draft note, or a character\'s open thread, can go untouched before the checks call it stale',
    left_out: '`3`',
  },
  {
    name: 'vault.name_match', type: 'number', min: 0, max: 1, default: 0.85, group: 'vault',
    does: 'How alike two note names must be, from `0` (anything) to `1` (identical), before the name check lists them as too close. The check\'s `--threshold` option overrides it for one run',
    left_out: '`0.85`',
  },
  { name: 'vault.index', type: 'map', container: true },
  {
    name: 'vault.index.recent_changes', type: 'number', integer: true, min: 0, default: 20, group: 'vault',
    does: 'How many lines the "Recent Changes" list in `_meta/index.md` keeps when the index is rebuilt, counting the line for the rebuild itself; `0` and `1` both keep only that line',
    left_out: '`20`',
  },
  {
    name: 'vault.index.description_chars', type: 'number', integer: true, min: 1, default: 80, group: 'vault',
    does: 'How many characters of a note\'s description the index shows beside its link',
    left_out: '`80`',
  },

  // The site itself
  {
    name: 'player_site.publish', was: [{ name: 'publish.site', in: 'vault' }], type: 'switch', onFault: false, onWhenSet: 'player_site.folder', group: 'site',
    does: 'Whether this vault has a site',
    left_out: 'On when a site folder is set (`player_site.folder`), otherwise off',
  },
  {
    name: 'player_site.folder', was: [{ name: 'publish.site_dir', in: 'vault' }], type: 'text', group: 'site',
    shape: 'a folder path',
    does: 'The folder on this computer that holds the site',
    left_out: 'Setting up a site writes it',
  },
  {
    name: 'player_site.title', was: [{ name: 'publish.site_title', in: 'vault' }, { name: 'siteTitle', in: 'site' }], type: 'text', legacyKind: 'scalar', group: 'site',
    does: 'The name in the menu bar and the browser tab',
    left_out: 'No title; setting up a site writes one',
  },
  {
    name: 'player_site.footer', was: [{ name: 'publish.footer', in: 'vault' }, { name: 'footer', in: 'site' }], type: 'text', legacyKind: 'scalar', group: 'site',
    does: 'A line at the foot of every page',
    left_out: 'No footer',
  },
  {
    name: 'player_site.features.search', was: [{ name: 'publish.search', in: 'vault' }, { name: 'searchEnabled', in: 'site' }], type: 'switch', default: true, legacyKind: 'scalar', group: 'site',
    does: 'The search box',
    left_out: 'On',
  },
  {
    name: 'player_site.features.link_previews', was: [{ name: 'publish.link_previews', in: 'vault' }], type: 'choice', values: ['on', 'desktop', 'off'], aliases: ON_OFF, default: 'on', group: 'site',
    does: 'The small card that opens when a reader rests on a link to another page, or taps it once on a phone. `on` shows it everywhere; `desktop` keeps it to a mouse and keyboard, so on a phone a tap goes straight to the page',
    left_out: '`on`',
  },
  {
    name: 'player_site.features.connections', was: [{ name: 'publish.connections', in: 'vault' }], type: 'choice', values: ['tree', 'web', 'cards', 'off'],
    aliases: { true: 'tree', on: 'tree', yes: 'tree', false: 'off', no: 'off' }, default: 'tree', group: 'site',
    does: "How the Connections section on a page is drawn: what the page's subject is tied to, in tabs by kind (people, places, organisations and so on), with pages that only mention it in a last tab. `tree` is a branching list, readable on a phone; `web` puts the subject in the middle with names around it; `cards` gives a card for each; `off` leaves out the section and the list of mentions. `on`, `yes` and `true` read as `tree`; `no` and `false` as `off`",
    left_out: '`tree`',
  },
  {
    name: 'player_site.not_found', was: [{ name: 'publish.four_oh_four.message', in: 'vault' }, { name: 'fourOhFour.message', in: 'site', carryOnly: true, shows: "Your site's 'page not found' message" }], type: 'text', default: 'This page is not available.', group: 'site',
    does: 'The words a reader sees after following a link to a page that is not there',
    left_out: '"This page is not available."',
  },
  // The five keys the site folder's vault.config.json used to hold. `siteFallback` reads the site file's key while
  // the vault sets none (legacy.js, read.js); `check` and `stopOnFault` keep a build from cleaning a folder it is
  // unsure of.
  {
    name: 'player_site.url', was: [{ name: 'siteUrl', in: 'site' }], type: 'text', legacyKind: 'scalar', siteFallback: true, group: 'site',
    shape: 'a web address',
    does: "The site's public address. A site that lives in a sub-folder of its host, such as a project page on GitHub, takes its base path from this",
    left_out: 'No address; a Cloudflare site is then taken to be at `https://<project>.pages.dev`',
  },
  {
    name: 'player_site.host', was: [{ name: 'host', in: 'site' }], type: 'choice', values: ['github-pages', 'cloudflare-pages'], default: 'github-pages', legacyKind: 'scalar', siteFallback: true, group: 'site',
    does: 'Where the site is hosted: `github-pages` or `cloudflare-pages`. Any other word is reported, and `github-pages` is used',
    left_out: '`github-pages`',
  },
  {
    name: 'player_site.output', was: [{ name: 'outputDir', in: 'site' }], type: 'text', check: 'output', stopOnFault: true, default: 'docs', legacyKind: 'scalar', siteFallback: true, group: 'site',
    shape: 'a folder inside the site folder',
    does: "The folder the finished pages are written to, inside the site folder. Each build empties it first (except what `player_site.keep` names), so it can be neither the site folder itself nor a folder outside it; a setting that breaks this stops the build",
    left_out: '`docs`',
  },
  {
    name: 'player_site.cloudflare_project', was: [{ name: 'cloudflarePagesProject', in: 'site' }], type: 'text', legacyKind: 'scalar', siteFallback: true, group: 'site',
    does: "The site's project name on Cloudflare, when it differs from the site folder's name",
    left_out: "The site folder's name",
  },
  {
    name: 'player_site.keep', was: [{ name: 'preserveDirs', in: 'site' }], type: 'list', of: 'folder names', check: 'keep', stopOnFault: true, default: [], legacyKind: 'list', siteFallback: true, group: 'site',
    does: 'Folders inside the output folder that a rebuild must leave alone, each a plain folder name (no slashes). A setting that breaks this stops the build',
    left_out: 'None: a rebuild empties the output folder',
  },
  {
    name: 'player_site.before_build', type: 'list', of: 'commands', default: [], stepsFrom: 'prebuild', group: 'site',
    does: 'Commands the publish tool runs, in order, in the site folder, before it builds. A command that fails stops the build and nothing is published',
    left_out: 'None',
  },
  {
    name: 'player_site.after_build', type: 'list', of: 'commands', default: [], stepsFrom: 'postbuild', group: 'site',
    does: 'Commands the publish tool runs, in order, in the site folder, after every page is written (image tidying, extra pages). A command that fails stops the build and nothing is published',
    left_out: 'None',
  },
  {
    name: 'player_site.menu_extra', type: 'listOfMaps', fields: { label: { required: true }, link: { required: true }, group: {} }, same: 'label', default: [], group: 'site',
    does: "Extra entries in the site's menu. `link` is the name of a page, a web address (`https://…`), or an address on the site (`gazetteer/index.html`). `group` puts the entry under one of the menu's groups (`Story`, `Characters`, `World`, `Reference`) or makes a new one; with none it stands on its own after the groups. A link to a note that has no page is left out, with a warning",
    left_out: 'No extra entries',
  },

  // The GM site: a second copy of the site for the GM, never put online. Its own entries; every other per-site
  // player_site setting also has a twin under gm_site (generated below).
  {
    name: 'gm_site.publish', type: 'switch', default: false, group: 'gm',
    does: 'Whether this vault has a GM site: a second copy of the site with every note and every hidden part shown and marked, for you at the table. It is never put online',
    left_out: 'Off',
  },
  {
    name: 'gm_site.folder', type: 'text', group: 'gm',
    shape: 'a folder path',
    does: "The folder the GM site's pages are written to. It holds built pages only, and cannot be the player site's folder, inside it, or hold it. Turning the GM site on with this unset makes one beside the player site's folder",
    left_out: "A folder beside the player site's, made when the GM site is turned on",
  },
  { name: 'gm_site.show', type: 'map', container: true },
  {
    name: 'gm_site.show.notes', type: 'switch', default: true, group: 'gm',
    does: 'Notes the player site leaves out (prep, drafts, the ones held back by the publish list) get a page, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.sections', type: 'switch', default: true, group: 'gm',
    does: 'Sections the player site hides (by heading) are shown, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.fields', type: 'switch', default: true, group: 'gm',
    does: 'Frontmatter fields the player site hides are listed in a panel at the top of the page, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.relationships', type: 'switch', default: true, group: 'gm',
    does: 'Relationships the player site hides (GM-only ones) are shown, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.gm_only_blocks', type: 'switch', default: true, group: 'gm',
    does: 'GM-only blocks (`<!-- gm-only -->`) are shown, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.spoilers', type: 'switch', default: true, group: 'gm',
    does: 'Spoiler blocks (`<!-- spoiler -->`) are shown, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.callouts', type: 'switch', default: true, group: 'gm',
    does: 'Callouts the player site hides are shown, marked',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.withheld_names', type: 'switch', default: true, group: 'gm',
    does: 'Names the player site prints as "someone" or "somewhere" are printed in full, marked with what players see',
    left_out: 'On',
  },
  {
    name: 'gm_site.show.comments', type: 'switch', default: false, group: 'gm',
    does: 'Comments in a note (`%% ... %%`) are shown, marked. They are off by default: most are notes to yourself, not things to run',
    left_out: 'Off',
  },

  // What gets published
  {
    name: 'player_site.hide.mode', was: [{ name: 'publish.mode', in: 'vault' }], type: 'any', retired: true, group: 'published',
    retiredSays: 'is no longer used: the GM site is what `full` was; the update removes it, or moves a `full` vault to a GM site',
  },
  {
    name: 'player_site.folder_map', was: [{ name: 'publish.folder_map', in: 'vault' }, { name: 'folderMap', in: 'site' }], type: 'map', open: true, default: {}, legacyKind: 'map', group: 'published',
    shape: 'a vault folder and its address, one pair to a line',
    does: 'Which vault folders are published, and the web address each gets',
    left_out: 'Nothing is mapped; setting up a site writes the standard map',
  },
  {
    name: 'vault.attachments', was: [{ name: 'publish.attachments_dir', in: 'vault' }, { name: 'attachmentsDir', in: 'site' }], type: 'text', default: '_attachments', legacyKind: 'scalar', group: 'published',
    shape: 'a folder name',
    does: 'The vault folder that holds pictures',
    left_out: '`_attachments`',
  },
  {
    name: 'vault.system', was: [{ name: 'publish.system', in: 'vault' }, { name: 'system', in: 'site' }], type: 'choice', values: SYSTEM_IDS, aliases: SYSTEM_ALIASES, keepOnFault: true, legacyKind: 'scalar', group: 'site',
    shape: SYSTEM_SHAPE,
    does: 'The game system, which decides how a character sheet is drawn',
    left_out: "A plain character page with no system's sheet",
  },
  {
    name: 'vault.setting_year', was: [{ name: 'setting_year', in: 'vault' }], type: 'text', group: 'site',
    shape: 'a year',
    does: 'An in-game year, shown on the landing page when the campaign overview gives no current date, and on a Call of Cthulhu sheet beside its era.',
    left_out: 'Nothing shown',
  },
  {
    name: 'player_site.hide.folders', was: [{ name: 'publish.exclude_dirs', in: 'vault' }, { name: 'excludeDirs', in: 'site' }], type: 'list', same: 'folder', of: 'folders', default: ['_meta', '_Templates'], guards: true,
 legacyKind: 'list', legacyMerge: 'union', group: 'published',
    does: 'Vault folders never published',
    left_out: '`_meta`, `_Templates`',
  },
  {
    name: 'player_site.hide.sections', was: [{ name: 'publish.exclude_sections', in: 'vault' }, { name: 'excludeSections', in: 'site' }], type: 'list', same: 'heading', of: 'headings',
    default: ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile'],
    guards: true, legacyKind: 'list', legacyMerge: 'union', group: 'published',
    does: 'Headings whose text is never published, on any page, however the heading is dressed (bold, a colon, a link)',
    left_out: '`GM Notes`, `DM Notes`, `Player Notes`, `Source References`, `Reconciliation Context`, `Handoff to Reconcile`',
  },
  {
    name: 'player_site.hide.fields', was: [{ name: 'publish.exclude_fields', in: 'vault' }, { name: 'excludeFields', in: 'site' }], type: 'list', of: 'field names',
    default: ['secrets', 'current_plan', 'plan_progress', 'gm_notes', 'prep_notes', 'reliability'],
    guards: true, legacyKind: 'list', legacyMerge: 'union', group: 'published',
    does: 'Fields in the block at the top of a note (between its `---` lines) that are never shown',
    left_out: '`secrets`, `current_plan`, `plan_progress`, `gm_notes`, `prep_notes`, `reliability`',
  },
  {
    name: 'player_site.hide.callouts', was: [{ name: 'publish.exclude_callouts', in: 'vault' }, { name: 'excludeCallouts', in: 'site' }], type: 'switchOrList', same: 'callout', of: 'callout types', default: false, onFault: true, guards: true,
 legacyKind: 'scalar', legacyMerge: 'stricter', group: 'published',
    does: 'Whether Obsidian callouts (`> [!note]`) are left out',
    left_out: 'Off; a site set up by the apprentice starts with it on',
  },
  {
    name: 'player_site.hide.drafts', was: [{ name: 'publish.exclude_drafts', in: 'vault' }], type: 'switch', default: false, onFault: true, guards: true, group: 'published',
    does: 'Whether a note with `canon_status: DRAFT` at its top is left off the site',
    left_out: 'Off: drafts publish with a "Draft" badge',
  },
  {
    name: 'publish.overrides', legacyOnly: true, type: 'map', guards: true,
  },
  {
    name: 'player_site.hide.field_exceptions', was: [{ name: 'publish.overrides.fields', in: 'vault' }], type: 'map', open: true, default: {}, guards: true, group: 'published',
    shape: "a note's path from the top of the vault, in quotes, then `include:` and the field names",
    does: 'Lets one note show a field that `player_site.hide.fields` hides everywhere else',
    left_out: 'No exceptions',
  },

  // Theme
  {
    name: 'player_site.theme.genre', was: [{ name: 'publish.theme.genre', in: 'vault' }], type: 'choice', values: [...VALID_PRESETS], aliases: GENRE_ALIASES, group: 'theme',
    does: 'A ready-made look: colours, lettering and section names. A genre the tool does not know is reported, and the site keeps the plain dark look',
    left_out: 'No preset',
  },
  {
    name: 'player_site.theme.palette.primary', was: [{ name: 'publish.theme.palette.primary', in: 'vault' }], type: 'text', default: '#1a2f3a', group: 'theme',
    shape: 'a colour',
    does: "The main colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a2f3a`",
  },
  {
    name: 'player_site.theme.palette.accent', was: [{ name: 'publish.theme.palette.accent', in: 'vault' }], type: 'text', default: '#3d8a7a', group: 'theme',
    shape: 'a colour',
    does: "The accent colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#3d8a7a`",
  },
  {
    name: 'player_site.theme.palette.background', was: [{ name: 'publish.theme.palette.background', in: 'vault' }], type: 'text', default: '#e8f0f3', group: 'theme',
    shape: 'a colour',
    does: "The page background colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#e8f0f3`",
  },
  {
    name: 'player_site.theme.palette.text', was: [{ name: 'publish.theme.palette.text', in: 'vault' }], type: 'text', default: '#1a1a1a', group: 'theme',
    shape: 'a colour',
    does: "The text colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one",
    left_out: "No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a1a1a`",
  },
  {
    name: 'player_site.theme.fonts.heading', was: [{ name: 'publish.theme.fonts.heading', in: 'vault' }], type: 'text', default: 'system-ui', group: 'theme',
    shape: "a typeface's name",
    does: 'The lettering for headings',
    left_out: "The preset's lettering, or the reader's own system font",
  },
  {
    name: 'player_site.theme.fonts.body', was: [{ name: 'publish.theme.fonts.body', in: 'vault' }], type: 'text', default: 'system-ui', group: 'theme',
    shape: "a typeface's name",
    does: 'The lettering for body text',
    left_out: "The preset's lettering, or the reader's own system font",
  },
  {
    name: 'player_site.theme.fonts.source', was: [{ name: 'publish.theme.fonts.source', in: 'vault' }], type: 'choice', values: ['google', 'self-host', 'local'], default: 'google', group: 'theme',
    does: 'Where the lettering comes from: `self-host` (the site downloads the typefaces once and serves them itself), `google` (the reader\'s browser fetches them from Google Fonts) or `local` (your own font files). With `self-host` a reader\'s browser never contacts Google. A source the tool does not know is reported, and `google` is used',
    left_out: '`google`: what a vault that never set a source gets',
  },
  {
    name: 'player_site.theme.fonts.files', was: [{ name: 'publish.theme.fonts.files', in: 'vault' }], type: 'any', default: [], group: 'theme',
    shape: 'a list of font files, each with a `family`, a `path`, and optionally a `weight` and `style`',
    does: 'Your own font files, each listed with its `family` (the typeface\'s name) and `path` (the file\'s place in the vault); used when the source is `local`',
    left_out: 'No files',
  },
  {
    name: 'player_site.theme.campaign_image', was: [{ name: 'publish.theme.campaign_image', in: 'vault' }, { name: 'campaignImage', in: 'site', carryOnly: true, shows: 'Your campaign picture (shown on the landing page and the \'page not found\' page)' }], type: 'text', group: 'theme',
    shape: "a picture's path in the vault",
    does: 'The large picture at the top of the landing page',
    left_out: 'No picture',
  },
  {
    name: 'player_site.theme.default_mode', was: [{ name: 'publish.theme.default_mode', in: 'vault' }], type: 'choice', values: ['system', 'dark', 'light'], default: 'system', group: 'theme',
    does: 'Whether a reader starts in light or dark',
    left_out: "`system`: follows the reader's device",
  },
  {
    name: 'player_site.theme.tagline', was: [{ name: 'publish.theme.tagline', in: 'vault' }, { name: 'landingTagline', in: 'site', read: false }], type: 'text', group: 'theme',
    does: 'One sentence under the title on the landing page',
    left_out: 'No tagline',
  },
  {
    name: 'player_site.lists.section_titles', was: [{ name: 'publish.section_titles', in: 'vault' }], type: 'map', default: {}, keys: ['locations', 'factions', 'items', 'creatures', 'documents'], group: 'theme',
    shape: '`locations`, `factions`, `items`, `creatures`, `documents`, each a title',
    does: 'Your own headings for the lists of locations, factions, items, creatures and documents',
    left_out: "Plain titles, or the genre's own",
  },

  // Character sheets
  {
    name: 'player_site.sheets.show', was: [{ name: 'publish.character_sheets', in: 'vault' }], type: 'switch', default: true, onFault: false, group: 'sheets',
    does: "Whether a character's page carries its sheet",
    left_out: 'On',
  },
  {
    name: 'player_site.sheets.prose_sections', was: [{ name: 'publish.pc_prose_sections', in: 'vault' }], type: 'list', same: 'heading', of: 'headings', default: [], group: 'sheets',
    does: "With sheets off, extra sections of a character's note that are still published",
    left_out: 'Only the built-in ones: Background, Current Status, Notes, Relationships, Appearances, Fellow Investigators, Encounters with Strange Entities, Friends & Rivals and Long-Term Projects',
  },
  {
    name: 'player_site.sheets.skin', was: [{ name: 'publish.sheet_skin', in: 'vault' }], type: 'choice', values: Object.keys(SKINS), fallback: SKIN_FALLBACK, group: 'sheets',
    does: 'The look of every character sheet',
    left_out: `\`${SKIN_FALLBACK}\``,
  },
  {
    name: 'player_site.sheets.frame', was: [{ name: 'publish.sheet_frame', in: 'vault' }], type: 'choice', values: ['none', ...FRAME_IDS], group: 'sheets',
    does: 'The ornament round each portrait',
    left_out: "The skin's own frame",
  },
  {
    name: 'player_site.sheets.crest', was: [{ name: 'publish.sheet_crest', in: 'vault' }, { name: 'sheet_crest', in: 'site' }], type: 'text', legacyKind: 'scalar', group: 'sheets',
    shape: "a picture's path in the vault",
    does: 'A crest or wax seal at the head of a Call of Cthulhu sheet',
    left_out: 'No crest',
  },
  {
    name: 'player_site.sheets.header_facts', type: 'list', of: 'field names', default: ['occupation', 'age', 'nationality'], group: 'sheets',
    does: "The facts shown under a character's name, as the names of fields in their note, for a character whose note has no `display_meta` of its own. An empty list shows none",
    left_out: '`occupation`, `age`, `nationality`',
  },
  {
    name: 'player_site.features.tohit_calculator', was: [{ name: 'publish.tohit_calculator', in: 'vault' }], type: 'choice', values: ['on', 'off'], aliases: ON_OFF, default: 'on', group: 'sheets',
    does: "The to-hit calculator on a GURPS character's Combat tab",
    left_out: '`on`',
  },
  {
    name: 'vault.dndbeyond_sync', was: [{ name: 'publish.dndbeyond_sync', in: 'vault' }], type: 'choice', values: ['build', 'manual'], default: 'manual', group: 'sheets',
    does: 'When D&D characters that carry a D&D Beyond link are brought up to date: `build` before each site update, or `manual` only when you ask',
    left_out: '`manual`',
  },

  // Live play
  {
    name: 'player_site.features.live_stats', was: [{ name: 'publish.live_stats', in: 'vault' }, { name: 'publish.backend.statusBar', in: 'vault' }, { name: 'backend.statusBar', in: 'site' }], type: 'switch', default: false, onFault: false, group: 'live',
    does: 'Players change hit points, spent resources and conditions on their own sheet during a session, and the party board follows. For Call of Cthulhu, GURPS and D&D; it does nothing for Pathfinder or Forged in the Dark',
    left_out: 'Off',
  },
  {
    name: 'player_site.features.inbox', was: [{ name: 'publish.inbox', in: 'vault' }, { name: 'publish.backend.inbox', in: 'vault' }, { name: 'backend.inbox', in: 'site' }], type: 'switch', default: false, onFault: false, group: 'live',
    does: 'A box on each character page for sending the GM a request or a question',
    left_out: 'Off',
  },

  // The landing page (the whole `landing` map is one old-file key, merged key by key)
  { name: 'player_site.landing', was: [{ name: 'publish.landing', in: 'vault' }, { name: 'landing', in: 'site' }], type: 'map', container: true, legacyKind: 'map', legacyMerge: 'perKey' },
  {
    name: 'player_site.landing.max_npcs', was: [{ name: 'publish.landing.max_npcs', in: 'vault' }], type: 'number', integer: true, min: 0, default: 6, group: 'landing',
    does: 'How many people appear under "NPCs in Play"; `0` shows none',
    left_out: '`6`',
  },
  {
    name: 'player_site.landing.max_locations', was: [{ name: 'publish.landing.max_locations', in: 'vault' }], type: 'number', integer: true, min: 0, default: 4, group: 'landing',
    does: 'How many places appear under "Latest Locations"; `0` shows none',
    left_out: '`4`',
  },
  {
    name: 'player_site.landing.max_events', was: [{ name: 'publish.landing.max_events', in: 'vault' }], type: 'number', integer: true, min: 0, default: 4, group: 'landing',
    does: 'How many events appear under "Latest Events"; `0` shows none',
    left_out: '`4`',
  },
  {
    name: 'player_site.landing.recency_window', was: [{ name: 'publish.landing.recency_window', in: 'vault' }], type: 'number', integer: true, min: 0, default: 3, group: 'landing',
    does: 'How many recent sessions decide who and what is "in play"; `0` counts none',
    left_out: '`3`',
  },
  {
    name: 'player_site.landing.featured_npcs', was: [{ name: 'publish.landing.featured_npcs', in: 'vault' }], type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'People pinned to the front of their row, in your order',
    left_out: 'Nobody pinned',
  },
  {
    name: 'player_site.landing.featured_locations', was: [{ name: 'publish.landing.featured_locations', in: 'vault' }], type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'The same, for places',
    left_out: 'Nothing pinned',
  },
  {
    name: 'player_site.landing.quick_links', was: [{ name: 'publish.landing.quick_links', in: 'vault' }], type: 'list', same: 'name', of: 'note names', default: [], group: 'landing',
    does: 'A short row of links on the page',
    left_out: 'No row',
  },
  {
    name: 'player_site.landing.explore_descriptions', was: [{ name: 'publish.landing.explore_descriptions', in: 'vault' }], type: 'map', open: true, group: 'landing',
    shape: '`characters`, `locations`, `story`, `factions`, `items`, `creatures`, `events`, each a sentence',
    does: 'Your own line under each card in the "Explore the World" row',
    left_out: "The genre's lines, or plain ones",
  },

  { name: 'player_site.landing.banner', type: 'map', container: true },
  {
    name: 'player_site.landing.banner.title', type: 'text', group: 'landing',
    does: 'The heading of a banner between the top of the landing page and "Latest Session". Plain text, shown as written. A banner shows when it has a title, text or picture',
    left_out: 'No banner',
  },
  {
    name: 'player_site.landing.banner.text', type: 'text', group: 'landing',
    does: 'The words in the banner, under its heading. Plain text, shown as written',
    left_out: 'No words',
  },
  {
    name: 'player_site.landing.banner.link', type: 'text', group: 'landing',
    does: 'Makes the whole banner a link. It is the name of a page, a web address (`https://…`), or an address on the site (`gazetteer/index.html`). A link to a note that has no page is left out, with a warning; a link with nothing else set shows no banner',
    left_out: 'Not a link',
  },
  {
    name: 'player_site.landing.banner.image', type: 'text', group: 'landing',
    shape: "a picture's path in the vault, or a web address",
    does: "A picture at the top of the banner. A file that is missing from the vault, or outside it, is reported and the banner shows without it",
    left_out: 'No picture',
  },

  // Limits
  { name: 'player_site.limits', type: 'map', container: true },
  {
    name: 'player_site.limits.timeline_events', type: 'number', integer: true, min: 0, default: 15, group: 'limits',
    does: 'How many of the latest events the little timeline shows, on the landing page and on a character page; `0` shows none',
    left_out: '`15`',
  },
  {
    name: 'player_site.limits.recap_chars', type: 'number', integer: true, min: 1, default: 500, group: 'limits',
    does: 'How many characters of the latest session\'s recap the landing page shows before it stops at a word and adds "…"',
    left_out: '`500`',
  },
  {
    name: 'player_site.limits.card_excerpt_chars', type: 'number', integer: true, min: 1, default: 200, group: 'limits',
    does: 'How many characters of a note\'s opening the pop-up preview card shows',
    left_out: '`200`',
  },
  {
    name: 'player_site.limits.card_fact_chars', type: 'number', integer: true, min: 1, default: 120, group: 'limits',
    does: 'How many characters one fact on a preview card shows',
    left_out: '`120`',
  },
  {
    name: 'player_site.limits.card_title_chars', type: 'number', integer: true, min: 1, default: 120, group: 'limits',
    does: "How many characters of a note's name a preview card shows",
    left_out: '`120`',
  },
  {
    name: 'player_site.limits.card_facts', type: 'number', integer: true, min: 0, default: 3, group: 'limits',
    does: 'How many facts a preview card lists; `0` shows none',
    left_out: '`3`',
  },
  {
    name: 'player_site.limits.list_goals', type: 'number', integer: true, min: 0, default: 3, group: 'limits',
    does: "How many goals a faction's card on the factions page lists; `0` shows none",
    left_out: '`3`',
  },
  {
    name: 'player_site.limits.list_relationships', type: 'number', integer: true, min: 0, default: 4, group: 'limits',
    does: "How many relationships a faction's card on the factions page lists; `0` shows none",
    left_out: '`4`',
  },

  // Words the GM never wants on the player site: going online stops on one (the leak gate)
  {
    name: 'player_site.never_show', type: 'list', same: 'phrase', of: 'words or phrases', default: [], guards: true, group: 'published',
    does: 'Words or phrases that must never reach players: a name, a twist, a word from your prep. The build does not remove them; `deploy` stops when the finished player site holds one (any case, as a whole word), names the page, and `leaks check` lists them. A finding you mean to keep is accepted like any other (`leaks accept`)',
    left_out: 'None',
  },

  // Withheld notes: the words a link to one prints in place of its name
  { name: 'player_site.withheld_words', type: 'map', container: true },
  {
    name: 'player_site.withheld_words.person', type: 'text', default: 'someone', group: 'published',
    does: 'The word that stands in for the name of a withheld person (a character or an NPC) when a note links to them with no label of their own. It cannot hold `[`, `]` or `|`',
    left_out: '`someone`',
  },
  {
    name: 'player_site.withheld_words.place', type: 'text', default: 'somewhere', group: 'published',
    does: 'The word that stands in for the name of a withheld place. It cannot hold `[`, `]` or `|`',
    left_out: '`somewhere`',
  },
  {
    name: 'player_site.withheld_words.thing', type: 'text', default: 'something', group: 'published',
    does: 'The word that stands in for the name of any other withheld note. It cannot hold `[`, `]` or `|`',
    left_out: '`something`',
  },

  // Lists and pictures
  { name: 'player_site.images', was: [{ name: 'publish.images', in: 'vault' }, { name: 'images', in: 'site' }], type: 'map', container: true, legacyKind: 'map', legacyMerge: 'perKey' },
  {
    name: 'player_site.images.optimize', was: [{ name: 'publish.images.optimize', in: 'vault' }], type: 'switch', default: false, group: 'lists',
    does: 'Shrinks pictures as the site is built, which can cut a picture-heavy site to a fraction of its size',
    left_out: 'Off: pictures are copied as they are',
  },
  {
    name: 'player_site.images.format', was: [{ name: 'publish.images.format', in: 'vault' }], type: 'choice', values: ['webp'], default: 'webp', keepOnFault: true, group: 'lists',
    does: 'The format pictures are converted to. Only `webp` is available; any other is reported, and pictures are left as they are',
    left_out: '`webp`',
  },
  {
    name: 'player_site.images.max_width', was: [{ name: 'publish.images.max_width', in: 'vault' }, { name: 'publish.images.maxWidth', in: 'vault' }], type: 'number', integer: true, min: 0, default: 1600,
 group: 'lists',
    does: 'The widest a shrunk picture may be, in pixels; `0` for no limit',
    left_out: '`1600`',
  },
  {
    name: 'player_site.images.quality', was: [{ name: 'publish.images.quality', in: 'vault' }], type: 'number', min: 0, default: 82, group: 'lists',
    does: 'The quality of shrunk pictures: 0 is the smallest file, 100 the best picture, and anything above 100 counts as 100',
    left_out: '`82`',
  },
  {
    name: 'player_site.lists.banners', was: [{ name: 'publish.banners', in: 'vault' }, { name: 'banners', in: 'site' }], type: 'map', open: true, default: {}, legacyKind: 'map', legacyMerge: 'perKey', group: 'lists',
    shape: "a section's web address, with a picture's path, or with `image`, `link` and `alt`",
    does: "A picture or map at the top of a section's list",
    left_out: "A picture named `_banner` in the section's vault folder is used if there is one",
  },
  { name: 'player_site.lists.locations', was: [{ name: 'publish.locations', in: 'vault' }, { name: 'locations', in: 'site' }], type: 'map', container: true, legacyKind: 'map', legacyMerge: 'perKey' },
  {
    name: 'player_site.lists.locations.group_by', was: [{ name: 'publish.locations.group_by', in: 'vault' }], type: 'any', group: 'lists',
    shape: 'a kind of location, or `false`',
    does: 'Splits the list of locations into one block, under its own heading, for each place of a kind, such as each star system',
    left_out: 'Off, except the `scifi` genre, which groups by `system`',
  },
  {
    name: 'player_site.lists.locations.ungrouped_label', was: [{ name: 'publish.locations.ungrouped_label', in: 'vault' }], type: 'text', group: 'lists',
    does: 'The heading for places that fall in no block',
    left_out: 'A standard heading',
  },

  // Read by nothing: listed so a vault that still has them is told, not left guessing
  { name: 'publish.four_oh_four.style', legacyOnly: true, type: 'any', retired: true },
  { name: 'publish.total_sessions', legacyOnly: true, type: 'any', retired: true },
  { name: 'publish.wrap_up', legacyOnly: true, type: 'any', retired: true },

  // The old container of the two live-play switches; its children are old names above
  { name: 'publish.backend', legacyOnly: true, type: 'map', container: true },

  // Tool bookkeeping
  { name: 'publish.setup_progress', legacyOnly: true, type: 'any', state: true, settable: false },
];

// The player site's settings the GM site cannot set for itself: one folder, one address, one host, and the live features
// the GM site never has. The hide.* settings are here too: what players see has one source, so a mark always means
// "hidden from players".
const NOT_PER_SITE = new Set(['player_site.publish', 'player_site.folder', 'player_site.url', 'player_site.host',
  'player_site.output', 'player_site.cloudflare_project', 'player_site.keep',
  'player_site.hide.folders', 'player_site.hide.sections', 'player_site.hide.fields', 'player_site.hide.callouts',
  'player_site.hide.drafts', 'player_site.hide.field_exceptions', 'player_site.never_show',
  'player_site.features.live_stats', 'player_site.features.inbox']);
// A twin that does not inherit when unset: the player site's build steps never run for the GM site.
const GM_OWN_DEFAULT = { 'player_site.before_build': [], 'player_site.after_build': [] };
// What a twin does not copy: it has no old names, no default of its own (unset, it takes the player site's value), and
// is never a hiding setting of its own; `stepsFrom` stays with the player site so the package.json steps move once.
const TWIN_DROPS = ['was', 'legacyKind', 'legacyMerge', 'siteFallback', 'onWhenSet', 'default', 'left_out', 'guards', 'stopOnFault', 'check', 'stepsFrom'];
function twinOf(e) {
  const t = { ...e, name: e.name.replace(/^player_site\./, 'gm_site.'), twinOf: e.name, group: 'gm-twin' };
  for (const k of TWIN_DROPS) delete t[k];
  if (Object.prototype.hasOwnProperty.call(GM_OWN_DEFAULT, e.name)) t.gmDefault = GM_OWN_DEFAULT[e.name];
  return t;
}
for (const e of REGISTRY.slice()) {
  if (e.name.startsWith('player_site.') && !e.legacyOnly && !e.retired && !NOT_PER_SITE.has(e.name)) REGISTRY.push(twinOf(e));
}

const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));

const entry = (name) => BY_NAME.get(name);
const names = () => REGISTRY.map((e) => e.name);

// Where the old file (_meta/vault-config.md) holds a setting: its first 'vault' old name, or its own
// name for an entry that exists only there. null for a setting the old file never had.
const legacyNameOf = (e) => (e.legacyOnly ? e.name : ((e.was || []).find((w) => w.in === 'vault') || {}).name || null);

// The key of the site's vault.config.json that holds a setting, or null.
const siteKeyOf = (e) => (e.legacyKind ? ((e.was || []).find((w) => w.in === 'site') || {}).name || null : null);

// The settings that are also keys of the site folder's file, read from there while the vault sets none:
// [{ key: 'siteUrl', name: 'player_site.url' }, ...].
const siteFolderKeys = () => REGISTRY.filter((e) => e.siteFallback).map((e) => ({ key: siteKeyOf(e), name: e.name }));

// A setting by its new name or by a name the old vault file gave it; { entry, old } where `old` says which.
const BY_OLD_NAME = new Map(REGISTRY.flatMap((e) => (e.was || []).filter((w) => w.in === 'vault').map((w) => [w.name, e])));
function resolve(name) {
  if (BY_NAME.has(name)) return { entry: BY_NAME.get(name), old: false };
  if (BY_OLD_NAME.has(name)) return { entry: BY_OLD_NAME.get(name), old: true };
  return null;
}

module.exports = { REGISTRY, NOT_PER_SITE, entry, names, GROUPS, legacyNameOf, siteKeyOf, siteFolderKeys, resolve };
