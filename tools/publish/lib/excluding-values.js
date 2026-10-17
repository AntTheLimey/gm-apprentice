'use strict';

// The values of a note's own frontmatter that keep it off a player site, in the ONE place
// they are listed. publish-decision.js decides with them; frontmatter-shape.js reads a list
// typed where one value belongs (`status: [planned, alive]`) with them, so that a list that
// holds one of these is read as that value and not as a joined text no rule matches.
// A leaf module: both of those sit on different sides of the scanner. The session status and
// stage words are shared lists (shared-lists.js, read from the ontology).
const { SESSION_NOT_YET_RUN, SESSION_STAGE_IN_PREP } = require('./shared-lists');

// status: prep that has not been played.
const AUTO_EXCLUDE_STATUS = SESSION_NOT_YET_RUN;
// stage: a plan still being written.
const AUTO_EXCLUDE_STAGE = SESSION_STAGE_IN_PREP;
// source: written as prep.
const AUTO_EXCLUDE_SOURCE = new Set(['prep']);
// status, on a scene: it was cut or skipped, so it did not happen.
const SCENE_SKIP_STATUS = new Set(['cut', 'skipped']);
// canon_status (and its older names), as written: withheld while exclude_drafts is on.
const DRAFT = 'DRAFT';
// type: a note the build never writes a page for.
const NO_PAGE_TYPES = new Set(['world_flags']);

const lower = (value) => String(value == null ? '' : value).toLowerCase();

// Per field, whether one value keeps a note off the site. Each is compared the way its rule
// compares it: a status, a stage and a source in any capitals, a canon status as written.
const EXCLUDES = {
  status: (v) => AUTO_EXCLUDE_STATUS.has(lower(v)) || SCENE_SKIP_STATUS.has(lower(v)),
  stage: (v) => AUTO_EXCLUDE_STAGE.has(lower(v)),
  source: (v) => AUTO_EXCLUDE_SOURCE.has(lower(v)),
  canon_status: (v) => String(v) === DRAFT,
  source_confidence: (v) => String(v) === DRAFT,
  confidence: (v) => String(v) === DRAFT,
  type: (v) => NO_PAGE_TYPES.has(String(v)),
};

// The first of `values` that keeps a note off the site when it stands in `field`, as
// written; undefined when none does, or the field is not one that can.
function excludingValue(field, values) {
  const excludes = Object.prototype.hasOwnProperty.call(EXCLUDES, field) ? EXCLUDES[field] : null;
  return excludes ? values.find((v) => excludes(v)) : undefined;
}

// A field's value for a rule that compares one value: a list is read as the item that
// excludes when it holds one (a field the scanner does not put into shape, `stage` or
// `source`, can still be typed as a list).
function ruleValue(field, value) {
  if (!Array.isArray(value)) return value;
  const flat = value.flat(Infinity).filter((v) => v != null);
  const taken = excludingValue(field, flat);
  return taken !== undefined ? taken : flat.join(', ');
}

module.exports = {
  AUTO_EXCLUDE_STATUS, AUTO_EXCLUDE_STAGE, AUTO_EXCLUDE_SOURCE, SCENE_SKIP_STATUS, DRAFT, NO_PAGE_TYPES,
  excludingValue, ruleValue,
};
