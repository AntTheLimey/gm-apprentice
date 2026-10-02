// tools/publish/lib/switches.js
// The only place the three GM switches are decided (#285).
const WORDS = new Map([['true', true], ['yes', true], ['on', true], ['false', false], ['no', false], ['off', false]]);

// undefined: not set. true/false: set. null: set to something unreadable.
function asBool(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && WORDS.has(value.trim().toLowerCase())) return WORDS.get(value.trim().toLowerCase());
  return null;
}

function resolveSwitches(publish, json) {
  const p = publish || {};
  const pb = (p.backend && typeof p.backend === 'object') ? p.backend : {};
  const jb = (json && json.backend && typeof json.backend === 'object') ? json.backend : {};
  const notes = [];
  // First source that sets it wins: new name, old name in the vault file, old name in the site file.
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
    return fallback;
  };
  const characterSheets = read('character_sheets', [['character_sheets', p.character_sheets]], true);
  let liveStats = read('live_stats', [['live_stats', p.live_stats], ['backend.statusBar', pb.statusBar], ['vault.config.json backend.statusBar', jb.statusBar]], false);
  const inbox = read('inbox', [['inbox', p.inbox], ['backend.inbox', pb.inbox], ['vault.config.json backend.inbox', jb.inbox]], false);
  if (!characterSheets && liveStats) {
    notes.push({ key: 'live_stats', problem: 'is on but character_sheets is off; live stats are not published' });
    liveStats = false;
  }
  return { characterSheets, liveStats, inbox, notes };
}

module.exports = { resolveSwitches, asBool };
