'use strict';

// migrate-config: move campaign settings out of the site's vault.config.json and into
// `publish:` in the vault's _meta/vault-config.md, and rename the old backend switches.
//
// planMigration only reads and returns data; applyMigration writes. The vault edit goes
// through vault-config-edit.js, which is also asked during planning, so a refusal is known
// before anything is written. Every ambiguous case refuses: nothing is guessed.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { MOVED_KEYS, DEPLOY_KEYS, OLD_SWITCHES, hasLegacy: siteHasLegacy } = require('./config-keys');
const { editPublishBlock, setPublishKeys } = require('./vault-config-edit');
const { detectInbox, detectStatusBar } = require('./backend-flags');
const { asBool } = require('./switches');
const { normalizeExcludeDir } = require('./config');
const { parseNote } = require('./frontmatter');

const VAULT_REL = path.join('_meta', 'vault-config.md');
const NEW_VAULT_FILE = '---\ntype: meta\n---\n';
const DETECTORS = { statusBar: detectStatusBar, inbox: detectInbox };
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
// Only non-empty text is a list entry; anything else is set aside and reported.
const splitEntries = (list) => ({ text: list.filter(isText), skipped: list.filter((v) => !isText(v)) });
const oneLine = (s) => String(s).split('\n')[0].trim();

const refuse = (reason) => ({
  applicable: false, refused: true, reason: oneLine(reason),
  moves: [], merges: [], switches: [], conflicts: [], notes: [], skipped: [], leftover: [], vaultSet: {}, vaultRemove: [], siteRemove: [],
});

// The site's vaultPath is resolved against the config file's directory, as build() does.
function siteVaultDir(configPath, site) {
  return path.resolve(path.dirname(path.resolve(configPath)), site.vaultPath);
}

function planMigration({ configPath, vaultPath } = {}) {
  let site = null;
  let siteDir = null;
  if (configPath) {
    let raw;
    try {
      raw = fs.readFileSync(configPath, 'utf8');
    } catch (e) {
      return refuse(`${configPath} could not be read: ${e.message}`);
    }
    try {
      site = JSON.parse(raw);
    } catch (e) {
      return refuse(`${configPath} could not be read as JSON: ${e.message}`);
    }
    if (!isMap(site)) return refuse(`${configPath} is not a JSON object`);
    siteDir = path.dirname(path.resolve(configPath));
  }
  let vault = vaultPath ? path.resolve(vaultPath) : null;
  if (!vault && site) {
    if (typeof site.vaultPath !== 'string' || !site.vaultPath) return refuse(`${configPath} has no "vaultPath"; pass --vault <dir>`);
    vault = siteVaultDir(configPath, site);
  }
  if (!vault) return refuse('migrate-config needs a vault.config.json (--config) or a vault (--vault)');
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) return refuse(`vault directory not found: ${vault}`);

  const vaultFile = path.join(vault, VAULT_REL);
  const exists = fs.existsSync(vaultFile);
  const before = exists ? fs.readFileSync(vaultFile, 'utf8') : NEW_VAULT_FILE;
  let publish = {};
  try {
    publish = parseNote(before).data.publish ?? {};
  } catch (e) {
    return refuse(`cannot read ${VAULT_REL}: the frontmatter does not parse: ${oneLine(e.message)}`);
  }
  if (!isMap(publish)) return refuse(`cannot edit ${VAULT_REL}: publish: is not a map`);

  const plan = {
    applicable: false, moves: [], merges: [], switches: [], conflicts: [], notes: [],
    skipped: [], leftover: [], vaultSet: {}, vaultRemove: [], siteRemove: [],
  };

  if (site) {
    for (const entry of MOVED_KEYS) {
      if (site[entry.json] === undefined) continue;
      const fromSite = site[entry.json];
      const fromVault = publish[entry.publish];
      if (fromVault === undefined && entry.kind === 'list') {
        // A list key whose value is not a list is not moved (a non-list under a list key
        // would be unreadable) and stays in the site file. A list with nothing but
        // unusable entries writes nothing either: `[]` would replace the built-in
        // default (for exclude_fields, the protective one). It is removed from the site file.
        const to = `publish.${entry.publish}`;
        const from = `vault.config.json ${entry.json}`;
        if (!Array.isArray(fromSite)) {
          plan.skipped.push({ key: entry.json, to, reason: `${from} is not a list, so it was not moved and was left in the site file` });
          continue;
        }
        const { text, skipped } = splitEntries(fromSite);
        if (skipped.length && !text.length) {
          plan.siteRemove.push(entry.json);
          plan.skipped.push({
            key: entry.json, to, entries: skipped,
            reason: `${from} has no entry that is text, so nothing was written and the key was removed from the site file`,
          });
          continue;
        }
      }
      plan.siteRemove.push(entry.json);
      if (fromVault === undefined) {
        const move = { from: `vault.config.json ${entry.json}`, to: `publish.${entry.publish}`, value: fromSite };
        if (entry.kind === 'list' && Array.isArray(fromSite)) {
          const { text, skipped } = splitEntries(fromSite);
          move.value = text;
          if (skipped.length) move.skipped = skipped;
        }
        plan.vaultSet[entry.publish] = move.value;
        plan.moves.push(move);
        continue;
      }
      if (entry.kind === 'list') {
        if (!Array.isArray(fromVault)) {
          return refuse(`cannot migrate ${entry.json}: publish.${entry.publish} in ${VAULT_REL} is set but is not a list`);
        }
        if (Array.isArray(fromSite)) {
          const keyOf = entry.publish === 'exclude_dirs'
            ? (s) => (normalizeExcludeDir(s, vault, false) ?? String(s)).toLowerCase()
            : (s) => String(s).toLowerCase();
          const have = new Set(fromVault.map(keyOf));
          const added = [];
          const { text, skipped } = splitEntries(fromSite);
          for (const s of text) {
            if (have.has(keyOf(s))) continue;
            have.add(keyOf(s));
            added.push(s);
          }
          if (added.length) plan.vaultSet[entry.publish] = [...fromVault, ...added];
          if (added.length || skipped.length) {
            plan.merges.push({ to: `publish.${entry.publish}`, added, ...(skipped.length ? { skipped } : {}) });
          }
          continue;
        }
      }
      if (!isDeepStrictEqual(fromVault, fromSite)) {
        plan.conflicts.push({ key: entry.json, kept: fromVault, discarded: fromSite });
      }
    }

    if (site.landingTagline !== undefined) {
      plan.siteRemove.push('landingTagline');
      const tagline = site.landingTagline;
      if (typeof tagline === 'string' && tagline.trim()) {
        const theme = publish.theme;
        if (theme !== undefined && theme !== null && !isMap(theme)) {
          return refuse(`cannot migrate landingTagline: publish.theme in ${VAULT_REL} is not a map`);
        }
        const kept = theme && theme.tagline;
        if (kept === undefined || kept === null || kept === '') {
          plan.vaultSet.theme = { ...(theme || {}), tagline };
          if (theme) plan.notes.push('publish.theme is rewritten to add tagline; comments inside it are not kept');
          plan.moves.push({ from: 'vault.config.json landingTagline', to: 'publish.theme.tagline', value: tagline });
        } else if (kept !== tagline) {
          plan.conflicts.push({ key: 'landingTagline', kept, discarded: tagline });
        }
      }
    }
  }

  // The old switch names. An explicit flag is copied as it is; with none, a deployed
  // backend is detected and only ever written as true.
  const siteBackend = site ? site.backend : undefined;
  if (publish.backend !== undefined && !isMap(publish.backend)) {
    return refuse(`cannot migrate backend: publish.backend in ${VAULT_REL} is not a map of switches`);
  }
  if (siteBackend !== undefined && !isMap(siteBackend)) {
    return refuse('cannot migrate backend: backend in vault.config.json is not a map of switches');
  }
  const vaultBackend = publish.backend || {};
  const jsonBackend = siteBackend || {};
  // Detection only helps a site that still has something to migrate; a site file holding
  // only deployment keys is already migrated, and a switch the GM removed stays removed.
  const hasLegacy = siteHasLegacy(site);
  for (const [oldName, newName] of Object.entries(OLD_SWITCHES)) {
    const sources = [[`backend.${oldName}`, vaultBackend[oldName]], [`vault.config.json backend.${oldName}`, jsonBackend[oldName]]]
      .filter(([, v]) => v !== undefined);
    let kept;
    if (publish[newName] !== undefined) {
      kept = asBool(publish[newName]);
    } else if (sources.length) {
      const [from, raw] = sources[0];
      const b = asBool(raw);
      if (b === null) plan.notes.push(`${from} is not true or false (${JSON.stringify(raw)}); written as false`);
      kept = b === null ? false : b;
      plan.vaultSet[newName] = kept;
      plan.switches.push({ to: `publish.${newName}`, value: kept, from });
      sources.shift();
    } else if (hasLegacy && DETECTORS[oldName](siteDir)) {
      plan.vaultSet[newName] = true;
      plan.switches.push({ to: `publish.${newName}`, value: true, from: 'detected' });
    }
    // Any other old flag that disagrees with the one kept is dropped, and said so.
    for (const [, raw] of sources) {
      if (!isDeepStrictEqual(asBool(raw), kept)) plan.conflicts.push({ key: `backend.${oldName}`, kept, discarded: raw });
    }
  }
  // Site-file keys no part of the tool reads: named, never removed.
  if (site) {
    const known = new Set([...DEPLOY_KEYS, ...MOVED_KEYS.map((e) => e.json), 'backend', 'landingTagline']);
    plan.leftover = Object.keys(site).filter((k) => !known.has(k));
  }
  if (publish.backend !== undefined) plan.vaultRemove.push('backend');
  if (siteBackend !== undefined) plan.siteRemove.push('backend');

  const edit = editPublishBlock(before, { set: plan.vaultSet, remove: plan.vaultRemove });
  if (edit.error) return refuse(`cannot edit ${VAULT_REL}: ${edit.error}`);
  plan.applicable = Object.keys(plan.vaultSet).length > 0 || plan.vaultRemove.length > 0 || plan.siteRemove.length > 0;
  if (!plan.applicable) plan.reason = 'nothing to migrate';
  return plan;
}

// A backup is the file as it was before the first migration; an existing one is never replaced.
function backup(file) {
  const dest = `${file}.pre-migrate`;
  if (fs.existsSync(dest)) return { kept: dest };
  fs.copyFileSync(file, dest);
  return { written: dest };
}

// Writes through a symlink to the real file, and keeps the file's permission bits.
function writeAtomic(link, text) {
  const file = fs.realpathSync(link);
  const mode = fs.statSync(file).mode & 0o7777;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// deps.writeSite(file, text) replaces the site file writer (tests inject a failing one).
function applyMigration(plan, { configPath, vaultPath } = {}, deps = {}) {
  const made = [];
  if (!plan.applicable) return { backups: [], keptBackups: [] };
  let site = null;
  let vault = vaultPath ? path.resolve(vaultPath) : null;
  if (configPath) {
    site = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!vault) vault = siteVaultDir(configPath, site);
  }
  const vaultFile = path.join(vault, VAULT_REL);
  const exists = fs.existsSync(vaultFile);
  const before = exists ? fs.readFileSync(vaultFile, 'utf8') : NEW_VAULT_FILE;
  // Known before any backup is written: a refusal here leaves every file as it was.
  const edit = editPublishBlock(before, { set: plan.vaultSet, remove: plan.vaultRemove });
  if (edit.error) throw new Error(`cannot edit ${VAULT_REL}: ${edit.error}`);
  const writeVault = edit.text !== before || (!exists && Object.keys(plan.vaultSet).length > 0);
  const writeSite = !!site && plan.siteRemove.length > 0;

  if (writeVault && exists) made.push(backup(vaultFile));
  if (writeSite) made.push(backup(configPath));
  if (writeVault) setPublishKeys(vault, plan.vaultSet, plan.vaultRemove);
  if (writeSite) {
    const kept = Object.fromEntries(Object.entries(site).filter(([k]) => !plan.siteRemove.includes(k)));
    try {
      (deps.writeSite || writeAtomic)(configPath, JSON.stringify(kept, null, 2) + '\n');
    } catch (e) {
      throw new Error(
        `${vaultFile} was updated but ${configPath} could not be written (${e.message}); ` +
        `the originals are in ${vaultFile}.pre-migrate and ${configPath}.pre-migrate`
      );
    }
  }
  return { backups: made.filter((b) => b.written).map((b) => b.written), keptBackups: made.filter((b) => b.kept).map((b) => b.kept) };
}

const show = (v) => JSON.stringify(v);

function describePlan(plan) {
  const lines = [];
  const skippedLine = (to, skipped) => skipped && lines.push(`skipped ${to}: not text, so not carried over: ${skipped.map(show).join(', ')}`);
  for (const m of plan.moves) { lines.push(`move ${m.from} -> ${m.to}`); skippedLine(m.to, m.skipped); }
  for (const m of plan.merges) {
    lines.push(`merge ${m.to}: added ${m.added.map(show).join(', ') || 'nothing'}`);
    skippedLine(m.to, m.skipped);
  }
  for (const s of plan.switches) lines.push(`switch ${s.to} = ${s.value} (from ${s.from})`);
  for (const c of plan.conflicts) lines.push(`conflict ${c.key}: kept ${show(c.kept)} from the vault file, discarded ${show(c.discarded)}`);
  for (const k of plan.skipped || []) lines.push(`skipped ${k.to}: ${k.reason}${k.entries ? `: ${k.entries.map(show).join(', ')}` : ''}`);
  for (const n of plan.notes) lines.push(`note ${n}`);
  if (plan.leftover && plan.leftover.length) lines.push(`left in vault.config.json (not a setting this tool reads): ${plan.leftover.join(', ')}`);
  return lines;
}

// The planned changes, then (after a real run) the backups it wrote or kept.
function changeLines(plan, result) {
  return [
    ...describePlan(plan),
    ...result.backups.map((b) => `backup ${b}`),
    ...result.keptBackups.map((b) => `backup kept from an earlier run: ${b}`),
  ];
}

// CLI body. Returns the exit code: 0 on success or nothing to do, 1 on refusal.
function runMigrateConfig({ configPath, vaultPath, dryRun = false, json = false } = {}, deps = {}) {
  const out = deps.out || console.log;
  const err = deps.err || console.error;
  let plan;
  try {
    plan = planMigration({ configPath, vaultPath });
  } catch (e) {
    err(`Error: ${oneLine(e.message)}`);
    return 1;
  }
  if (plan.refused) {
    err(`Error: ${plan.reason}`);
    return 1;
  }
  let result = { backups: [], keptBackups: [] };
  if (!dryRun) {
    try {
      result = applyMigration(plan, { configPath, vaultPath });
    } catch (e) {
      err(`Error: ${oneLine(e.message)}`);
      return 1;
    }
  }
  // The one rendering of the plan: the human run prints these, and --json carries them
  // as `lines` so a caller never re-renders the plan itself.
  const lines = plan.applicable ? changeLines(plan, result) : [];
  if (json) {
    out(JSON.stringify({ ...plan, ...(dryRun ? {} : result), lines }, null, 2));
    return 0;
  }
  if (!plan.applicable) {
    out('Nothing to migrate.');
    return 0;
  }
  for (const line of lines) out(line);
  if (dryRun) out('Dry run: nothing written.');
  return 0;
}

module.exports = { planMigration, applyMigration, runMigrateConfig, describePlan };
