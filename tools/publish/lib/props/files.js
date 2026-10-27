'use strict';

// What the build writes for each prop the plan ships: every planned file's content, made
// once from the bytes the plan read, so the note-faults audit reads exactly what is written.
// A page or SVG is written as cut (its Keeper parts and comments gone) when the plan says
// so, never as the vault holds it; a link the plan respelled is respelled; the prop's own page gets the bar back to its
// note. Everything else is copied as it is.
const fs = require('fs');
const path = require('path');
const { cutHtml } = require('./html-cut');
const { bytesOf, textOf, utf8Charset } = require('./plan');
const { relativeHref, encodeHref } = require('../processor');
const { propBar, withPropBar } = require('../templates/prop-bar');

const PAGE_EXTS = new Set(['.html', '.htm']);
// The files written from their text: a page, SVG or stylesheet not in UTF-8 is written in UTF-8.
const TEXT_EXTS = new Set([...PAGE_EXTS, '.svg', '.css']);

function respelled(text, pairs) {
  let out = text;
  for (const [raw, nfc] of pairs || []) out = out.split(raw).join(nfc);
  return out;
}

// The props the plan ships: each with an address and its files.
function plannedProps(plan) {
  return plan ? plan.props.filter((p) => p.ships && p.address && p.files.length > 0) : [];
}

// The props the site holds: planned, with the prop file's own bytes in hand to write, or (a page
// the tool makes) with its page made: `made_html`, set by the build's make pass.
function shippedProps(plan) {
  return plannedProps(plan).filter((p) => (p.made ? typeof p.made_html === 'string' : bytesOf(p.files[0]) !== null));
}

// The site link from a note page to its prop: relative, encoded. null when its prop does not
// ship, or its own file is in `blocked` (outputs the build will not write).
function propHrefFor(plan, page, blocked = new Set()) {
  const prop = shippedProps(plan).find((p) => p.page === page && !blocked.has(p.files[0].out));
  return prop ? encodeHref(relativeHref(page.outputPath, prop.address)) : null;
}

// What the tool writes for `files` of prop `p`, from the bytes the plan read:
// [{ rel, out, isPage, made, text | bytes, was, replacesKept, warnings }] (`made`: a page the tool made, its style's
// name when it has one; `was`: the encoding a text file
// was read from, when it is not UTF-8; its text is written as UTF-8), and a problem row in `failed`
// for a file whose bytes the plan does not hold (the prop file's own: nothing of it is written).
// A made page is its `made_html`; one the make pass did not make (it said why) writes nothing.
// `collectionAddress`: the props page's address, which the bar links (null: the site has none).
function outputsOf(p, files, collectionAddress = null) {
  const outputs = [];
  const failed = [];
  for (const [i, f] of files.entries()) {
    // A container's state file: the script the make pass wrote from its listing (`state_js`); nothing when it made none.
    if (f.made === 'state') {
      if (typeof p.state_js === 'string') outputs.push({ rel: p.rel, out: f.out, isPage: false, replacesKept: Boolean(f.replacesKept), warnings: [], text: p.state_js });
      continue;
    }
    if (f.made) {
      if (typeof p.made_html === 'string') outputs.push({ rel: p.rel, out: f.out, isPage: true, made: p.style ? p.style.name : true, replacesKept: Boolean(p.replacesKept), warnings: [], text: p.made_html });
      continue;
    }
    const bytes = bytesOf(f);
    if (bytes === null) {
      failed.push({ rel: p.rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail: `${f.out} could not be read`, fix: 'make the file readable' });
      if (i === 0) break;
      continue;
    }
    const ext = path.extname(f.out).toLowerCase();
    const entry = { rel: p.rel, out: f.out, isPage: PAGE_EXTS.has(ext), replacesKept: Boolean(i === 0 ? p.replacesKept : f.replacesKept), warnings: [] };
    let { text, was } = TEXT_EXTS.has(ext) ? textOf(bytes) : { text: null, was: null };
    if (!f.cut && !f.rewrite && !(i === 0 && entry.isPage) && !was) {
      entry.bytes = bytes;
      outputs.push(entry);
      continue;
    }
    if (was) {
      text = utf8Charset(text, ext);
      entry.was = was;
    }
    if (f.cut) {
      const cut = cutHtml(text);
      text = cut.text;
      entry.warnings = cut.warnings;
    }
    text = respelled(text, f.rewrite);
    if (i === 0 && entry.isPage) {
      text = withPropBar(text, propBar({ noteHref: encodeHref(relativeHref(p.address, p.page.outputPath)), noteTitle: p.page.displayTitle || p.page.title || '', collectionHref: collectionAddress ? encodeHref(relativeHref(p.address, collectionAddress)) : null }));
    }
    entry.text = text;
    outputs.push(entry);
  }
  return { outputs, failed };
}

function propOutputs(plan, { collectionAddress = null } = {}) {
  const outputs = [];
  const failed = [];
  for (const p of plannedProps(plan)) {
    const made = outputsOf(p, p.files, collectionAddress);
    outputs.push(...made.outputs);
    failed.push(...made.failed);
  }
  return { outputs, failed };
}

// What an earlier build wrote into a kept folder for a prop that no longer ships
// (the plan's `keptCopies`): the build removes each copy still holding exactly these bytes.
// The page's bar linked the props page where that build had one, so each copy carries `wants`: its
// bytes for each props-page address in `collectionAddresses` (null: no props page), any of which it may hold.
function keptCopyOutputs(plan, { collectionAddresses = [null] } = {}) {
  if (!plan) return [];
  const bytes = (f) => (f.text !== undefined ? Buffer.from(f.text) : f.bytes);
  return plan.props.filter((p) => p.keptCopies).flatMap((p) => {
    const each = collectionAddresses.map((a) => outputsOf(p, p.keptCopies, a).outputs);
    return each[0].map((f, i) => ({ ...f, wants: each.map((outs) => bytes(outs[i])) }));
  });
}

// Whether a prop's output `out` may be written or removed in `outputDir`: every part of its
// path that exists below the folder is a real folder (not a link, which would lead the write
// out of the site), and the file itself, if there, a plain file. Returns null when it may, else
// why not: 'link' or 'not a file'.
function pathProblem(outputDir, out) {
  const parts = String(out).split('/');
  let at = outputDir;
  for (const [i, part] of parts.entries()) {
    at = path.join(at, part);
    let stat;
    try { stat = fs.lstatSync(at); } catch (e) { return null; }
    if (stat.isSymbolicLink()) return 'link';
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return 'not a file';
  }
  return null;
}

module.exports = { shippedProps, propHrefFor, propOutputs, keptCopyOutputs, pathProblem };
