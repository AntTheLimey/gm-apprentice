'use strict';
// `gm-publish props pages`: how many printed pages a built prop page runs to, counted by printing it to PDF in
// headless Chrome. Addresses are relative to the site's output folder.
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
    `--print-to-pdf=${pdf}`, fileUrl(file)], { stdio: 'pipe', timeout: 60000 });
  if (run.status !== 0 || !fs.existsSync(pdf)) throw new Error(`Chrome failed (${run.status}): ${String(run.stderr).slice(0, 200)}`);
  return countPdfPages(fs.readFileSync(pdf));
}

// One row per address: { address, pages, why }; `why` says why there is no count.
function pagesFor(siteDir, addresses, { findChrome = defaultFindChrome } = {}) {
  const binary = findChrome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-'));
  try {
    return addresses.map((address) => {
      const file = path.resolve(siteDir, address);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { address, pages: null, why: 'not built' };
      if (!binary) return { address, pages: null, why: NO_CHROME };
      try {
        return { address, pages: printedPages(binary, file, work), why: null };
      } catch (err) {
        return { address, pages: null, why: err.message };
      }
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function formatLine(row) {
  if (row.pages !== null) return `${row.address}\t${row.pages} ${row.pages === 1 ? 'page' : 'pages'}`;
  return row.why === NO_CHROME ? row.why : `${row.address}\t${row.why}`;
}

// The site's output folder, as `--config` names it.
function outputFolder(configPath) {
  const resolved = path.resolve(configPath || './vault.config.json');
  const siteRoot = path.dirname(resolved);
  return path.resolve(siteRoot, outputFolderOf(siteConfigFor(loadVaultConfig(resolved), siteRoot)));
}

function runPages({ configPath, addresses, json = false }) {
  const rows = pagesFor(outputFolder(configPath), addresses);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else if (rows.some((r) => r.why === NO_CHROME)) console.log(NO_CHROME);
  else for (const row of rows) console.log(formatLine(row));
}

module.exports = { countPdfPages, pagesFor, formatLine, runPages, NO_CHROME };
