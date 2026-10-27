'use strict';
// `gm-publish props pages`: how many printed pages a built prop page runs to, counted by printing it to PDF in
// headless Chrome. Addresses are relative to the site's output folder. A note (`--note`, vault-relative) is
// counted as players would get its prop, published or not: the vault's font cache is filled first, as a build
// fills it, then the build makes the prop in memory, as if it published, and its files are printed from a temp
// folder. Nothing is written to the site.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findChrome: defaultFindChrome, fileUrl } = require('../chrome');
const { loadVaultConfig, siteConfigFor, outputFolderOf } = require('../config');

const NO_CHROME = 'no Chrome or Chromium found; open the page and use print preview';
const SUPPLIED_PDF = 'a supplied PDF keeps its own pages; open it to check';
const NO_PAGES_PRINTED = 'Chrome printed no pages it could count; open the page and use print preview';
// Clean-up that outlives a lock Chrome's helpers hold for a moment after it exits (Windows).
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

// The pages of a PDF Chrome printed: each page object is `/Type /Page`, the page tree `/Type /Pages`. Chrome writes
// every object in the open, once.
function countPdfPages(bytes) {
  return (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

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
    const pages = printedPages(binary, file, work);
    return pages > 0 ? { pages, why: null } : { pages: null, why: NO_PAGES_PRINTED };
  } catch (err) {
    return { pages: null, why: err.message };
  }
}

// A --note as the vault-relative, forward-slash path the build knows it by: `./`, backslashes and an absolute path
// inside the vault are all read; null when it is outside the vault.
function vaultRel(vaultPath, note) {
  const rel = path.relative(vaultPath, path.resolve(vaultPath, String(note).replace(/\\/g, '/')));
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
}

// A prop note's row: its files as the build made them in memory, written into `work` and printed there, and what
// the build said of it (`warnings`). A supplied PDF is not counted: it keeps the pages its maker gave it.
function noteRow(configPath, vaultPath, given, binary, work) {
  const note = vaultRel(vaultPath, given);
  if (note === null) return { note: given, pages: null, why: 'outside the vault', warnings: [] };
  const { pages, why, warnings = [] } = notePages(configPath, path.join(vaultPath, note), note, binary, work);
  return { note, pages, why, warnings };
}

function notePages(configPath, full, note, binary, work) {
  if (!fs.existsSync(full)) return { pages: null, why: 'no such note in the vault' };
  let built;
  try {
    built = require('../build').build({ configPath, inMemory: true, shownFor: note });
  } catch (err) {
    return { pages: null, why: err.message };
  }
  const made = built.shownProp;
  if (!made || made.why) return { pages: null, why: made ? made.why : 'not a prop note' };
  // What the build said while it made the prop's own page (a picture not in the vault, say), beside the prop's rows.
  const said = (built.warnings || []).filter((w) => w.includes(`(${made.files[0].out})`));
  const warnings = [...new Set([...made.warnings, ...said])];
  const site = fs.mkdtempSync(path.join(work, 'site-'));
  try {
    for (const f of made.files) {
      const full = path.join(site, ...f.out.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (f.from) fs.copyFileSync(f.from, full);
      else fs.writeFileSync(full, f.text !== undefined ? f.text : f.bytes);
    }
    const page = path.join(site, ...made.files[0].out.split('/'));
    if (/\.pdf$/i.test(page)) return { pages: null, why: SUPPLIED_PDF, warnings };
    return { ...countFile(binary, page, work), warnings };
  } finally {
    fs.rmSync(site, RM);
  }
}

// The vault's font cache filled as a build fills it before it builds (bin/gm-publish.js): a hand or style just
// added is counted in its own typeface. What it says goes to stderr, so stdout holds only the rows.
const prefetchFonts = (configPath) => require('../fonts').prefetchForConfig(configPath, { log: (m) => console.error(m) });

// One row per target, in order: an { address } gives { address, pages, why }, a { note } gives
// { note, pages, why, warnings }. The fonts are fetched once, before any note is built.
async function rowsFor(configPath, targets, { findChrome = defaultFindChrome, prefetch = prefetchFonts } = {}) {
  const binary = findChrome();
  const notes = targets.some((x) => x.note !== undefined);
  if (notes) await prefetch(configPath);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-'));
  try {
    const site = targets.some((x) => x.address !== undefined) ? outputFolder(configPath) : null;
    const vaultPath = notes ? vaultFolder(configPath) : null;
    return targets.map((x) => (x.note !== undefined
      ? noteRow(configPath, vaultPath, x.note, binary, work)
      : { address: x.address, ...countFile(binary, path.resolve(site, x.address), work) }));
  } finally {
    fs.rmSync(work, RM);
  }
}

// A row's line. A row with no count still names its warnings; a no-Chrome row with none is the one NO_CHROME line.
function formatLine(row) {
  const name = row.note !== undefined ? row.note : row.address;
  const said = row.warnings && row.warnings.length ? ` (warning: ${row.warnings.join('; ')})` : '';
  if (row.pages !== null) return `${name}\t${row.pages} ${row.pages === 1 ? 'page' : 'pages'}${said}`;
  if (row.why === NO_CHROME) return said ? `${name}\tno count${said}` : NO_CHROME;
  return `${name}\t${row.why}${said}`;
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
async function runPages({ configPath, targets, json = false }) {
  const rows = await rowsFor(configPath || './vault.config.json', targets);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const line of rows.map(formatLine).filter((l) => l !== NO_CHROME)) console.log(line);
    if (rows.some((r) => r.why === NO_CHROME)) console.log(NO_CHROME);
  }
}

module.exports = { countPdfPages, rowsFor, formatLine, runPages, outputFolder, NO_CHROME, SUPPLIED_PDF };
