'use strict';
// A signed figure as notes write it: "+2", "-1", or a typeset minus (U+2212) or en dash as in "−1".
const MINUS = '+\\-\\u2212\\u2013';
const SIGNED_SOURCE = `[${MINUS}]\\d+`;
const toNumber = (text) => Number(String(text).replace(/[−–]/, '-'));
module.exports = { SIGNED_SOURCE, toNumber };
