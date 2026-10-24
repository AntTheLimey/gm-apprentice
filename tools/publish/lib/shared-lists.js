'use strict';
// The short lists the tool shares with the vault scripts, read from ontology.json (a generated
// copy of skills/shared/gm-apprentice-ontology.json, scripts/export_publish_ontology.py), so the
// tool types out none of them: session statuses and stages, the wrap-up type spellings, the game
// systems and their aliases, and the type folders. Python reads the same lists through
// schema_rules.py.
const data = require('./ontology.json');

// A session's `status`: not yet run (prep), or played (the `wrap-up` state between the wrap-up
// and the review counts, so a freshly wrapped session counts before it is reviewed).
const SESSION_NOT_YET_RUN = new Set(data.session_status.not_yet_run);
const SESSION_PLAYED = new Set(data.session_status.played);
// The retired `stage:` words that still keep a note off a player site.
const STAGE_HIDES = new Set(data.stage_hides);

// Every `type:` spelling a Session Wrap-Up is written with; the first is the one the
// templates write.
const WRAP_UP_TYPE = data.wrap_up_types[0];
const WRAP_UP_TYPES = new Set(data.wrap_up_types);

// Game systems: canonical id -> its name; every alias -> its canonical id.
const SYSTEM_IDS = data.game_systems.map((s) => s.id);
const SYSTEM_NAMES = Object.fromEntries(data.game_systems.map((s) => [s.id, s.name]));
const SYSTEM_ALIASES = Object.fromEntries(data.game_systems.flatMap((s) => s.aliases.map((a) => [a, s.id])));

// The canonical id a written system names (trimmed, any case), or null when it names none.
function systemId(raw) {
  if (raw == null) return null;
  const key = String(raw).trim().toLowerCase();
  if (SYSTEM_IDS.includes(key)) return key;
  return Object.prototype.hasOwnProperty.call(SYSTEM_ALIASES, key) ? SYSTEM_ALIASES[key] : null;
}

// The type folders, in order: { folder, types, site }.
const VAULT_FOLDERS = data.vault_folders.map((f) => ({ folder: f.folder, types: [...f.types], site: f.site }));

module.exports = {
  SESSION_NOT_YET_RUN, SESSION_PLAYED, STAGE_HIDES,
  WRAP_UP_TYPE, WRAP_UP_TYPES,
  SYSTEM_IDS, SYSTEM_NAMES, SYSTEM_ALIASES, systemId,
  VAULT_FOLDERS,
};
