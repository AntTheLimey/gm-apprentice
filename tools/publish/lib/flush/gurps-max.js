'use strict';

// Derive a GURPS PC's max HP/FP from the sheet markdown, reusing the exact build
// pipeline (frontmatter split -> section extraction -> parseGurps -> buildVitals).
// Returns { maxHp, maxFp } with nulls when the sheet is too incomplete to resolve
// (e.g. no Attributes) — the caller then does update-in-place only. Never throws.
const matter = require('gray-matter');
const { extractSections } = require('../processor');
const { parseGurps } = require('../templates/gurps/parse');
const { buildVitals } = require('../templates/gurps/live-data');

function deriveGurpsMax(raw, frontmatter) {
  try {
    const content = matter(String(raw)).content;
    const model = parseGurps(frontmatter || {}, extractSections(content));
    const v = buildVitals(model);
    if (!v) return { maxHp: null, maxFp: null };
    return {
      maxHp: v.hp && typeof v.hp.max === 'number' ? v.hp.max : null,
      maxFp: v.fp && typeof v.fp.max === 'number' ? v.fp.max : null,
    };
  } catch (e) {
    return { maxHp: null, maxFp: null };
  }
}

module.exports = { deriveGurpsMax };
