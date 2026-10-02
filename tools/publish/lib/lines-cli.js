'use strict';

// `lines` command: answer, for text handed in on stdin, what the build would publish.
//
// vault_check (Python) has to know which lines of a note reach the site: its leak
// checks scan only those, and its writers refuse a repair that would publish a line
// that was hidden. It used to keep its own copy of the strip chain and the section
// filter, held "line for line" with processor.js by hand. This command is that
// knowledge asked for instead of copied: every answer comes from the functions the
// build itself calls, so there is nothing to drift.
//
// One JSON request per input line, one JSON answer per output line, in order, until
// stdin closes. A caller with many notes keeps one process open for its whole run.
//
//   {"op":"published","text":…,"excludeSections":[…],"publish":"all|stub|none","include":[…]}
//       -> {"text":…}        the body the site renders (the `publish:` gate, then
//                            playerSafeMarkdown), exclude list only
//   {"op":"sections","text":…,"excludeSections":[…]}
//       -> {"withheldBy":[…]}  per line of `text`: the excluded section that
//                            withholds it, or null
//   {"op":"stub","text":…,"include":[…]}
//       -> {"kept":[…]}      per line of `text`: whether a `publish: stub` page with
//                            these `publish_include_sections` keeps it
//
// A request that cannot be answered gets {"error":…}; the process carries on.
const { StringDecoder } = require('string_decoder');
const { playerSafeMarkdown, keepOnlySections, keptSectionFlags, sectionVerdicts } = require('./processor');

// A request is checked, not coerced: a list that is not a list read as "no list"
// would answer "nothing is withheld".
function list(request, key) {
  const value = request[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((s) => typeof s !== 'string')) {
    throw new Error(`${key} must be a list of strings`);
  }
  return value;
}

function answer(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('a request is a JSON object');
  if (typeof request.text !== 'string') throw new Error('text must be a string');
  const { text } = request;
  switch (request.op) {
    case 'published': {
      const publish = request.publish === undefined ? 'all' : request.publish;
      if (!['all', 'stub', 'none'].includes(publish)) throw new Error('publish must be all, stub or none');
      const excludeSections = list(request, 'excludeSections');
      const include = list(request, 'include');
      if (publish === 'none') return { text: '' };
      // The stub reduction runs first, as in the build (see sheet-cli playerSafeBody).
      const body = publish === 'stub' ? keepOnlySections(text, include) : text;
      return { text: playerSafeMarkdown(body, { excludeSections }).text };
    }
    case 'sections':
      return { withheldBy: sectionVerdicts(text, list(request, 'excludeSections')) };
    case 'stub':
      return { kept: keptSectionFlags(text, list(request, 'include')) };
    default:
      throw new Error(`unknown op: ${JSON.stringify(request.op)}`);
  }
}

function answerLine(line) {
  try {
    return JSON.stringify(answer(JSON.parse(line)));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// Resolves 0 when stdin closes. `deps.input` / `deps.write` are test seams.
// Requests are split on `\n` alone: readline also breaks at U+2028 and U+2029, which
// are legal inside a JSON string, and one split request would put every later answer
// out of step with its question.
function runLines(deps) {
  const d = deps || {};
  const input = d.input || process.stdin;
  const write = d.write || ((s) => process.stdout.write(s));
  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const take = (line) => {
      const request = line.replace(/\r$/, '');
      if (request.trim() !== '') write(`${answerLine(request)}\n`);
    };
    input.on('data', (chunk) => {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let at;
      while ((at = pending.indexOf('\n')) !== -1) {
        take(pending.slice(0, at));
        pending = pending.slice(at + 1);
      }
    });
    input.on('end', () => {
      take(pending + decoder.end());
      resolve(0);
    });
  });
}

module.exports = { runLines, answer, answerLine };
