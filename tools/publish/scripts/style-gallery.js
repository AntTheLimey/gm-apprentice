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
// fall back to their stacks and the build says so.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepareFixture } = require('../test/helpers/fixture-build');
const { findChrome } = require('../test/helpers/browser');
const { prefetchForConfig } = require('../lib/fonts');
const { build } = require('../lib/build');

const fileUrl = (p) => `file://${p.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`;

// A PDF's page count: each page object is `/Type /Page`, the page tree `/Type /Pages`.
function pdfPageCount(file) {
  return (fs.readFileSync(file).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

function chrome(binary, profile, args) {
  const run = spawnSync(binary, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=6000', ...args], { stdio: 'pipe', timeout: 60000 });
  if (run.status !== 0) throw new Error(`Chrome failed (${run.status}): ${String(run.stderr).slice(0, 400)}`);
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
      chrome(binary, profile, [`--print-to-pdf=${pdf}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', fileUrl(page)]);
      const entry = { style, page: `site/props/${name}`, png: path.basename(png), pdfPages: pdfPageCount(pdf) };
      gallery.push(entry);
      console.log(`  ${style}: ${entry.png}, ${entry.pdfPages} PDF page(s)`);
    }
    fs.writeFileSync(path.join(out, 'gallery.json'), `${JSON.stringify(gallery, null, 2)}\n`);
    console.log(`gallery: ${gallery.length} styled pages in ${out}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
