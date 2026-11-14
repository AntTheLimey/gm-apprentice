'use strict';
// Whether two entries of a list setting are one entry: the rule the build itself uses for that list, shared by the
// settings commands and the faults found in a list.

function sameRule(e, vaultPath) {
  if (e.same === 'heading') {
    const { headingKey } = require('../heading-key');
    return (a, b) => (headingKey(a) || a) === (headingKey(b) || b);
  }
  if (e.same === 'folder') {
    const { dirIsExcluded } = require('../scanner');
    return (a, b) => dirIsExcluded(a, [b]) && dirIsExcluded(b, [a]);
  }
  if (e.same === 'phrase') {
    // The leak gate reads a phrase in any case, with any run of spaces between its words.
    const { canonicalNfc } = require('../unicode');
    const key = (x) => canonicalNfc(String(x)).replace(/\s+/g, ' ').trim().toLowerCase();
    return (a, b) => key(a) === key(b);
  }
  if (e.same === 'callout') return (a, b) => a.toLowerCase() === b.toLowerCase(); // the build lower-cases both sides
  if (e.same === 'name') {
    const { canonicalNfc } = require('../unicode');
    return (a, b) => canonicalNfc(a) === canonicalNfc(b);
  }
  // A list of entries that are maps: two are one when the field named here is the same.
  if (e.type === 'listOfMaps') {
    const { canonicalNfc } = require('../unicode');
    return (a, b) => canonicalNfc(String(a[e.same]).trim()) === canonicalNfc(String(b[e.same]).trim());
  }
  return (a, b) => a === b;
}

module.exports = { sameRule };
