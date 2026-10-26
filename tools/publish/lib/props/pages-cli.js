'use strict';
// `gm-publish props pages`: how many printed pages a built prop page runs to, counted by printing it to PDF in
// headless Chrome. Addresses are relative to the site's output folder. A note (`--note`, vault-relative) is
// counted as players would get its prop, published or not: the build makes it in memory, as if it published,
// and its files are printed from a temp folder. Nothing is written to the site.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findChrome: defaultFindChrome } = require('../chrome');
const { loadVaultConfig, siteConfigFor, outputFolderOf } = require('../config');

const NO_CHROME = 'no Chrome or Chromium found; open the page and use print preview';

// A PDF's page count: each page object is `/Type /Page`, the page tree `/Type /Pages`.
function countPdfPages(bytes) {
  return (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

const fileUrl = (p) => `file://${p.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`;

// Print one file to PDF and count its pages. Throws if Chrome fails.
function printedPages(binary, file, work) {
  const pdf = path.join(work, 'page.pdf');
  const run = spawnSync(binary, ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${path.join(work, 'profile')}`, '--virtual-time-budget=6000',
    `--print-to-pdf=${pdf}`, fileUrl(file)], { stdio: 'pipe', timeout: 60000, killSignal: 'SIGKILL' });
  if (run.status !== 0 || !fs.existsSync(pdf)) throw new Error(`Chrome failed (${run.status}): ${String(run.stderr).slice(0, 200)}`);
  return countPdfPages(fs.readFileSync(pdf));
}

// The pages of a built file at `file`: { pages, why }.
function countFile(binary, file, work) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { pages: null, why: 'not built' };
  if (!binary) return { pages: null, why: NO_CHROME };
  try {
    return { pages: printedPages(binary, file, work), why: null };
  } catch (err) {
    return { pages: null, why: err.message };
  }
}

// One row per address: { address, pages, why }; `why` says why there is no count.
function pagesFor(siteDir, addresses, { findChrome = defaultFindChrome } = {}) {
  const binary = findChrome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-'));
  try {
    return addresses.map((address) => ({ address, ...countFile(binary, path.resolve(siteDir, address), work) }));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// A prop note's pages, { pages, why }: its files as the build made them in memory, written into `work` and printed
// there. A PDF prop is counted from its bytes.
function notePages(configPath, vaultPath, note, binary, work) {
  const at = path.resolve(vaultPath, note);
  if (path.relative(vaultPath, at).startsWith('..') || !fs.existsSync(at)) return { pages: null, why: 'no such note in the vault' };
  let made;
  try {
    made = require('../build').build({ configPath, inMemory: true, shownFor: note.replace(/\\/g, '/') }).shownProp;
  } catch (err) {
    return { pages: null, why: err.message };
  }
  if (!made || made.why) return { pages: null, why: made ? made.why : 'not a prop note' };
  const site = fs.mkdtempSync(path.join(work, 'site-'));
  try {
    for (const f of made.files) {
      const full = path.join(site, ...f.out.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (f.from) fs.copyFileSync(f.from, full);
      else fs.writeFileSync(full, f.text !== undefined ? f.text : f.bytes);
    }
    const page = path.join(site, ...made.files[0].out.split('/'));
    if (/\.pdf$/i.test(page)) return { pages: countPdfPages(fs.readFileSync(page)), why: null };
    return countFile(binary, page, work);
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
}

// One row per target, in order: an { address } gives { address, pages, why }, a { note } gives { note, pages, why }.
function rowsFor(configPath, targets, { findChrome = defaultFindChrome } = {}) {
  const binary = findChrome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-'));
  try {
    const site = targets.some((x) => x.address !== undefined) ? outputFolder(configPath) : null;
    const vaultPath = targets.some((x) => x.note !== undefined) ? vaultFolder(configPath) : null;
    return targets.map((x) => (x.note !== undefined
      ? { note: x.note, ...notePages(configPath, vaultPath, x.note, binary, work) }
      : { address: x.address, ...countFile(binary, path.resolve(site, x.address), work) }));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function formatLine(row) {
  const name = row.note !== undefined ? row.note : row.address;
  if (row.pages !== null) return `${name}\t${row.pages} ${row.pages === 1 ? 'page' : 'pages'}`;
  return row.why === NO_CHROME ? row.why : `${name}\t${row.why}`;
}

// The site's output folder, as `--config` names it.
function outputFolder(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  const siteRoot = path.dirname(resolved);
  return path.resolve(siteRoot, outputFolderOf(siteConfigFor(loadVaultConfig(resolved), siteRoot)));
}

// The vault, as `--config` names it.
function vaultFolder(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  return path.resolve(path.dirname(resolved), loadVaultConfig(resolved).vaultPath);
}

// `targets`: [{ address } | { note }], in the order they were given.
function runPages({ configPath, targets, json = false }) {
  const rows = rowsFor(configPath || './vault.config.json', targets);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const row of rows.filter((r) => r.why !== NO_CHROME)) console.log(formatLine(row));
    if (rows.some((r) => r.why === NO_CHROME)) console.log(NO_CHROME);
  }
}

module.exports = { countPdfPages, pagesFor, rowsFor, formatLine, runPages, NO_CHROME };
