// tools/publish/lib/switches.js
// The only place the GM switches are decided (#285): whether the vault has a site at all
// (`site`), and the three features of one.
const WORDS = new Map([['true', true], ['yes', true], ['on', true], ['false', false], ['no', false], ['off', false]]);

// undefined: not set. true/false: set. null: set to something unreadable,
// including a key present but empty (`inbox:` in YAML parses to null).
function asBool(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && WORDS.has(value.trim().toLowerCase())) return WORDS.get(value.trim().toLowerCase());
  return null;
}

function resolveSwitches(publish, json) {
  const p = publish || {};
  const notes = [];
  const asMap = (v, label) => {
    if (v === undefined) return {};
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    notes.push({ key: label, problem: 'is not a map of switches; ignored' });
    return {};
  };
  const pb = asMap(p.backend, 'backend');
  const jb = asMap(json && json.backend, 'vault.config.json backend');
  // First source that sets it wins: new name, old name in the vault file, old name in the site file.
  const unset = [];
  const read = (key, sources, fallback) => {
    for (const [label, raw] of sources) {
      const b = asBool(raw);
      if (b === undefined) continue;
      if (label !== key) notes.push({ key: label, problem: `is an old name; set publish.${key}` });
      if (b === null) {
        // Unreadable never means "on": withhold, and say so.
        notes.push({ key, problem: `is not true or false (${JSON.stringify(raw)}); treated as off` });
        return false;
      }
      return b;
    }
    unset.push(key);
    return fallback;
  };
  // A site is on or off. Unset, in a vault written before the switch, a site_dir says on.
  const site = read('site', [['site', p.site]], typeof p.site_dir === 'string' && p.site_dir.trim() !== '');
  const characterSheets = read('character_sheets', [['character_sheets', p.character_sheets]], true);
  let liveStats = read('live_stats', [['live_stats', p.live_stats], ['backend.statusBar', pb.statusBar], ['vault.config.json backend.statusBar', jb.statusBar]], false);
  const inbox = read('inbox', [['inbox', p.inbox], ['backend.inbox', pb.inbox], ['vault.config.json backend.inbox', jb.inbox]], false);
  if (!characterSheets && liveStats) {
    notes.push({ key: 'live_stats', problem: 'is on but character_sheets is off; live stats are not published' });
    liveStats = false;
  }
  // `unset`: the switches neither file sets (they sit at their default).
  // `explicitOff`: the feature is off because the GM said so (set to false, set to something
  // unreadable, or live stats forced off by character_sheets: false), not because nothing
  // set it. Only an explicit off may remove a deployed function; an unset switch never does.
  const explicitOff = {
    liveStats: !liveStats && (!unset.includes('live_stats') || !characterSheets),
    inbox: !inbox && !unset.includes('inbox'),
    site: !site && !unset.includes('site'),
  };
  return { site, characterSheets, liveStats, inbox, notes, unset, explicitOff };
}

// What `build` and `deploy` say instead of running when the GM has turned the site off.
// Only an explicit off stops them: a site folder whose vault never set the switch builds.
const SITE_OFF = 'the site is off for this vault (publish.site in _meta/vault-config.md); nothing was built. Set publish.site: true to publish again.';
function siteOff(switches) {
  return switches && switches.explicitOff && switches.explicitOff.site ? SITE_OFF : null;
}

module.exports = { resolveSwitches, asBool, siteOff, SITE_OFF };
