'use strict';

// NOTICE.txt, written at the root of every site the build writes: the MIT notices the site's
// shipped code asks to travel with it. The generator's own CSS and JavaScript are its own, and
// js/lunr.js (copied when the site has search) is lunr's. The licence texts are read from the
// files the tool is installed with, so the notice can never say something else than they do.
// The typefaces the site serves from fonts/ are listed too: a Google Fonts file is served as
// Google serves it, and its copyright and the address of its licence are in its own name table.

const fs = require('fs');
const path = require('path');

const GENERATOR_LICENSE = path.join(__dirname, '..', 'LICENSE');

function lunrDir() {
  return path.dirname(require.resolve('lunr/package.json'));
}

function lunrLicenseText() {
  return fs.readFileSync(path.join(lunrDir(), 'LICENSE'), 'utf8');
}

// Google's page for a family's licence.
function licenceUrl(family) {
  return `https://fonts.google.com/specimen/${family.split(' ').join('+')}/license`;
}

function fontsSection(googleFonts, localFonts) {
  const lines = ['The typefaces in fonts/:'];
  if (googleFonts.length) {
    lines.push('', 'These are served unmodified from Google Fonts. Each font file carries its copyright notice and the',
      'address of its licence in its own metadata; the licence is also at the address given.', '');
    for (const f of googleFonts) lines.push(`  ${f.family}: fonts/${f.folder}/, served unmodified from Google Fonts. Licence: ${licenceUrl(f.family)}`);
  }
  if (localFonts.length) {
    lines.push('', "These were supplied by the site's owner:", '');
    for (const f of localFonts) lines.push(`  fonts/${f}`);
  }
  return lines.join('\n');
}

// `lunr`: whether the site ships js/lunr.js. `styles`: the names of the plugin's prop styles the
// site ships (a vault's own style is the GM's). `googleFonts`: [{ family, folder }] served from
// fonts/<folder>/; `localFonts`: the paths under fonts/ of the fonts the GM supplied.
function noticeText({ lunr = true, styles = [], googleFonts = [], localFonts = [] } = {}) {
  const parts = [
    'This site was built with gm-apprentice-publish. Its stylesheets and scripts (css/, js/) are the\n'
      + 'generator\'s, under this licence:\n\n'
      + fs.readFileSync(GENERATOR_LICENSE, 'utf8').trim(),
  ];
  if (styles.length) {
    parts.push('These prop styles are the generator\'s too, under the licence above:\n\n'
      + styles.map((name) => `  props/styles/${name}/ (the generator's)`).join('\n'));
  }
  if (lunr) {
    const version = JSON.parse(fs.readFileSync(path.join(lunrDir(), 'package.json'), 'utf8')).version;
    parts.push(`js/lunr.js is lunr ${version} (https://lunrjs.com), under this licence:\n\n${lunrLicenseText().trim()}`);
  }
  if (googleFonts.length || localFonts.length) parts.push(fontsSection(googleFonts, localFonts));
  return parts.join('\n\n----------------------------------------\n\n') + '\n';
}

module.exports = { noticeText };
