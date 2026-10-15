'use strict';
// Builds a small vault on the new settings layout as both sites. `files` is { 'Folder/Note.md': text }.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../../lib/build');
const { writeNewConfig } = require('./settings-files');

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function buildBoth(files, { player = {}, gm = {}, vault = {}, sites = ['player', 'gm'] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-both-')));
  const vaultDir = path.join(root, 'vault');
  const siteDir = path.join(root, 'campaign');
  const gmDir = path.join(root, 'campaign-gm');
  const map = {};
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, rel), text);
    const dir = rel.includes('/') ? path.posix.dirname(rel) : null;
    if (dir && !dir.startsWith('_')) map[dir] = dir.toLowerCase();
  }
  fs.mkdirSync(siteDir);
  writeNewConfig(vaultDir, { version: 1, vault,
    player_site: { folder: siteDir, title: 'T', folder_map: map, ...player },
    gm_site: { publish: true, folder: gmDir, ...gm } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vaultDir }));
  const saved = { log: console.log, warn: console.warn };
  const logs = [];
  console.log = () => {}; console.warn = (m) => logs.push(String(m));
  try { for (const site of sites) build({ configPath, site }); } finally { Object.assign(console, saved); }
  const reader = (dir) => ({
    dir,
    read: (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8'),
    exists: (...p) => fs.existsSync(path.join(dir, ...p)),
    files: () => (fs.existsSync(dir) ? allFiles(dir) : []),
  });
  return { root, configPath, logs, player: reader(path.join(siteDir, 'docs')), gm: reader(gmDir),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// Every marked element of a GM page: { kind, label, text } (text is everything inside it, nested marks included).
function markedTexts(html) {
  const out = [];
  const stack = [];
  const re = /<(\/?)(div|span|aside)\b([^>]*)>|([^<]+)|<[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      if (!m[1]) {
        const k = /data-gm-kind="([a-z_]+)"/.exec(m[3]);
        const l = /data-gm-label="([^"]*)"/.exec(m[3]);
        stack.push(k ? { kind: k[1], label: l ? l[1] : '', text: '' } : null);
      } else {
        const top = stack.pop();
        if (top) out.push(top);
      }
    } else if (m[4]) {
      for (const s of stack) if (s) s.text += m[4];
    }
  }
  return out;
}

// The text after </main> (the footer, the back-to-top button) that sits inside a mark: a mark cut open earlier on the
// page would wrap it. Empty when none does.
function markedAfterMain(html) {
  const end = html.lastIndexOf('</main>');
  if (end < 0) return '';
  const stack = [];
  const re = /<(\/?)(div|span|aside)\b([^>]*)>|([^<]+)|<[^>]*>/g;
  let found = '';
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      if (!m[1]) stack.push(/data-gm-kind="/.test(m[3]));
      else stack.pop();
    } else if (m[4] && m.index > end && m[4].trim() && stack.some(Boolean)) found += m[4];
  }
  return found;
}

module.exports = { buildBoth, markedTexts, markedAfterMain, allFiles };
