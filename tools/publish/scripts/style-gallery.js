#!/usr/bin/env node
'use strict';
// The visual check for the prop styles: builds the prop-styles fixture vault into <out-dir>/site,
// then for each styled page takes a screenshot and prints it to PDF with headless Chrome, and
// writes <out-dir>/gallery.json: [{ style, page, png, pdfPages }]. Dev only, not run in CI.
//
//   node scripts/style-gallery.js <out-dir>
//
// The fixture is copied to a temporary folder first, and its typefaces are fetched from Google
// Fonts into that copy's font cache, so nothing is written into the repository. Offline, the pages
// fall back to their stacks and the build says so. A plugin style that gives no styled page (one
// that fails to load) fails the run, named.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepareFixture } = require('../test/helpers/fixture-build');
const { findChrome } = require('../lib/chrome');
const { countPdfPages } = require('../lib/props/pages-cli');
const { prefetchForConfig } = require('../lib/fonts');
const { build } = require('../lib/build');
const { loadVaultConfig } = require('../lib/config');
const { listStyles } = require('../lib/props/styles');

const fileUrl = (p) => `file://${p.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`;

function chrome(binary, profile, args) {
  const run = spawnSync(binary, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=6000', ...args], { stdio: 'pipe', timeout: 60000 });
  if (run.status !== 0) throw new Error(`Chrome failed (${run.status}): ${String(run.stderr).slice(0, 400)}`);
}

// The plugin's styles that have no styled page in the gallery (a style that fails to load gives none).
function missingStyles(gallery, vaultPath, pluginDir) {
  const shown = new Set(gallery.map((g) => g.style));
  return listStyles({ vaultPath, pluginDir }).filter((st) => st.from === 'plugin' && !shown.has(st.name)).map((st) => st.name);
}

async function main() {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error('usage: node scripts/style-gallery.js <out-dir>');
    process.exit(2);
  }
  const binary = findChrome();
  if (!binary) {
    console.error('no Chrome or Chromium found (set GM_TEST_CHROME to point at one)');
    process.exit(1);
  }
  const out = path.resolve(outArg);
  const site = path.join(out, 'site');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'style-gallery-'));
  try {
    const configPath = prepareFixture('prop-styles', root);
    await prefetchForConfig(configPath);
    build({ configPath });
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.cpSync(path.join(root, 'docs'), site, { recursive: true });

    const profile = path.join(root, 'chrome-profile');
    const pages = fs.readdirSync(path.join(site, 'props')).filter((n) => n.endsWith('.html')).sort();
    const gallery = [];
    for (const name of pages) {
      const page = path.join(site, 'props', name);
      const style = (/<body class="prop-page prop-style-([a-z0-9-]+)">/.exec(fs.readFileSync(page, 'utf8')) || [])[1];
      if (!style) continue;
      const base = name.replace(/\.html$/, '');
      const png = path.join(out, `${base}.png`);
      const pdf = path.join(out, `${base}.pdf`);
      chrome(binary, profile, [`--screenshot=${png}`, '--window-size=1000,1400', fileUrl(page)]);
      chrome(binary, profile, [`--print-to-pdf=${pdf}`, '--no-pdf-header-footer', fileUrl(page)]);
      const entry = { style, page: `site/props/${name}`, png: path.basename(png), pdfPages: countPdfPages(fs.readFileSync(pdf)) };
      gallery.push(entry);
      console.log(`  ${style}: ${entry.png}, ${entry.pdfPages} PDF page(s)`);
    }
    fs.writeFileSync(path.join(out, 'gallery.json'), `${JSON.stringify(gallery, null, 2)}\n`);
    console.log(`gallery: ${gallery.length} styled pages in ${out}`);
    const vaultPath = path.resolve(path.dirname(configPath), loadVaultConfig(configPath).vaultPath);
    const missing = missingStyles(gallery, vaultPath);
    if (missing.length) {
      console.error(`no styled page for the plugin style${missing.length === 1 ? '' : 's'} ${missing.join(', ')}: see the build's PROP_NOT_COPIED warnings above`);
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { missingStyles };
