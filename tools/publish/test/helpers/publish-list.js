'use strict';
// Writes a vault's _meta/publish-list.yaml for a test. A publishing or excluded entry is a path, a path with
// " — reason" after it, or { path, reason }.
const fs = require('node:fs');
const path = require('node:path');
const { listText, parseListText } = require('../../lib/manifest');

function splitEntry(entry) {
  if (typeof entry !== 'string') return entry;
  const m = /^(.*?\.\w+) — (.*)$/.exec(entry);
  return m ? { path: m[1], reason: m[2] } : { path: entry };
}

function listFor({ publishing = [], excluded = [], needsDecision = [] } = {}) {
  const parts = excluded.map(splitEntry);
  const pubs = publishing.map(splitEntry);
  return {
    publishing: pubs.map((e) => e.path),
    excluded: parts.map((e) => e.path),
    needsDecision: needsDecision.map((e) => splitEntry(e).path),
    reasons: new Map([...pubs, ...parts].filter((e) => e.reason).map((e) => [e.path, e.reason])),
  };
}

// The text of the file, and writing it into <vault>/_meta/.
const listFileText = (lists) => listText(listFor(lists));
function writePublishList(vault, lists) {
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'publish-list.yaml'), listFileText(lists));
}

// A publish list file's text, read back into the loadManifest shape.
const readListText = (text) => parseListText(text, { warn: () => {} });

module.exports = { writePublishList, listFileText, readListText };
