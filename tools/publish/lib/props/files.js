'use strict';

// What the build writes for each prop the plan ships: every planned file's content, made
// once so the note-faults audit reads exactly what is written. A page or SVG is written as
// cut (its Keeper parts and comments gone) when the plan says so, never as the vault holds
// it; a link the plan respelled is respelled; the prop's own page gets the bar back to its
// note. Everything else is copied as it is.
const fs = require('fs');
const path = require('path');
const { cutHtml } = require('./html-cut');
const { relativeHref, encodeHref } = require('../processor');
const { propBar, withPropBar } = require('../templates/prop-bar');

const PAGE_EXTS = new Set(['.html', '.htm']);

function respelled(text, pairs) {
  let out = text;
  for (const [raw, nfc] of pairs || []) out = out.split(raw).join(nfc);
  return out;
}

// The props that ship, each with an address: the ones the site holds.
function shippedProps(plan) {
  return plan ? plan.props.filter((p) => p.ships && p.address && p.files.length > 0) : [];
}

// The site link from a note page to its prop: relative, encoded. null when its prop does not ship.
function propHrefFor(plan, page) {
  const prop = shippedProps(plan).find((p) => p.page === page);
  return prop ? encodeHref(relativeHref(page.outputPath, prop.address)) : null;
}

// [{ rel, out, isPage, text | bytes, replacesKept, warnings }], or a problem row in `failed` for a
// file that can no longer be read.
function propOutputs(plan) {
  const outputs = [];
  const failed = [];
  for (const p of shippedProps(plan)) {
    for (const [i, f] of p.files.entries()) {
      let bytes;
      try { bytes = fs.readFileSync(f.source); } catch (e) {
        failed.push({ rel: p.rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail: `${f.out} could not be read (${e.code || e.message})`, fix: 'make the file readable' });
        continue;
      }
      const ext = path.extname(f.out).toLowerCase();
      const entry = { rel: p.rel, out: f.out, isPage: PAGE_EXTS.has(ext), replacesKept: Boolean(i === 0 ? p.replacesKept : f.replacesKept), warnings: [] };
      if (!f.cut && !f.rewrite && !(i === 0 && entry.isPage)) {
        entry.bytes = bytes;
        outputs.push(entry);
        continue;
      }
      let text = bytes.toString('utf8');
      if (f.cut) {
        const cut = cutHtml(text);
        text = cut.text;
        entry.warnings = cut.warnings;
      }
      text = respelled(text, f.rewrite);
      if (i === 0 && entry.isPage) {
        text = withPropBar(text, propBar({ noteHref: encodeHref(relativeHref(p.address, p.page.outputPath)), noteTitle: p.page.displayTitle || p.page.title || '', collectionHref: null }));
      }
      entry.text = text;
      outputs.push(entry);
    }
  }
  return { outputs, failed };
}

module.exports = { shippedProps, propHrefFor, propOutputs };
