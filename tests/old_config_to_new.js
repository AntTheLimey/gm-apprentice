'use strict';
// Test helper (tests/layouts.py): the new settings file for a fixture written in the old
// layout's terms. Reads the old file's text on stdin; writes JSON on stdout:
// { yaml, state } or { error }. The names come from the publish tool's own registry (each
// setting's old names), so a fixture says its settings the short way and the tool reads them
// where they now live.
const path = require('node:path');
const tool = path.join(__dirname, '..', 'tools', 'publish');
const YAML = require(path.join(tool, 'node_modules', 'yaml'));
const { REGISTRY } = require(path.join(tool, 'lib', 'settings', 'registry.js'));

const byOld = new Map();
for (const e of REGISTRY) {
  if (e.legacyOnly || e.name.startsWith('gm_site.')) continue;
  for (const w of e.was || []) if (w.in === 'vault') byOld.set(w.name, e.name);
}
const STATE_KEYS = new Set(['gm_apprentice_version']);

function front(text) {
  const t = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t);
  return m ? m[1] : (t.startsWith('---') ? '' : t);
}

function put(out, dotted, value) {
  const parts = dotted.split('.');
  let cur = out;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function walk(node, prefix, out, state) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${k}` : k;
    if (!prefix && STATE_KEYS.has(k)) { state[k] = v; continue; }
    if (byOld.has(dotted)) { put(out, byOld.get(dotted), v); continue; }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) walk(v, dotted, out, state);
  }
}

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = YAML.parse(front(input)) || {};
    const out = { version: 1 };
    const state = {};
    walk(data, '', out, state);
    process.stdout.write(JSON.stringify({ yaml: YAML.stringify(out), state }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e.message || e) }));
  }
});
