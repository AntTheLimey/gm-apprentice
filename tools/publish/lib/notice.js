'use strict';

// NOTICE.txt, written at the root of every site the build writes: the MIT notices the site's
// shipped code asks to travel with it. The generator's own CSS and JavaScript are its own, and
// js/lunr.js (copied when the site has search) is lunr's. The licence texts are read from the
// files the tool is installed with, so the notice can never say something else than they do.

const fs = require('fs');
const path = require('path');

const GENERATOR_LICENSE = path.join(__dirname, '..', 'LICENSE');

function lunrDir() {
  return path.dirname(require.resolve('lunr/package.json'));
}

function lunrLicenseText() {
  return fs.readFileSync(path.join(lunrDir(), 'LICENSE'), 'utf8');
}

// `lunr`: whether the site ships js/lunr.js.
function noticeText({ lunr = true } = {}) {
  const parts = [
    'This site was built with gm-apprentice-publish. Its stylesheets and scripts (css/, js/) are the\n'
      + 'generator\'s, under this licence:\n\n'
      + fs.readFileSync(GENERATOR_LICENSE, 'utf8').trim(),
  ];
  if (lunr) {
    const version = JSON.parse(fs.readFileSync(path.join(lunrDir(), 'package.json'), 'utf8')).version;
    parts.push(`js/lunr.js is lunr ${version} (https://lunrjs.com), under this licence:\n\n${lunrLicenseText().trim()}`);
  }
  return parts.join('\n\n----------------------------------------\n\n') + '\n';
}

module.exports = { noticeText };
