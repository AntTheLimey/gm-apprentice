'use strict';
// `gm-publish props read-state FILE`: what a container's hand-made state script sets, for the move of a vault's own
// props into prop notes (prop_move.py reads it). The file runs in a fresh `vm` context holding only `window = {}`: no
// require, no process, no timers, a 1 s limit that also covers the promise jobs it queues. A context is no security boundary; the file is the GM's own, and this
// only keeps it from reaching the tool's own objects by accident. The build never runs it.
const fs = require('node:fs');
const vm = require('node:vm');

// { global, items }: the one property the script set on `window`, and its value as JSON. Throws on anything else.
function readState(file) {
  let code;
  try { code = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`${file} could not be read (${e.code || e.message})`); }
  const context = vm.createContext({ window: {} }, { microtaskMode: 'afterEvaluate' });
  try {
    vm.runInContext(code, context, { filename: file, timeout: 1000 });
  } catch (e) {
    throw new Error(`${file} could not be run: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
  // Read inside the context too, under the same limit, and handed out as one string: a getter or a Proxy on window
  // runs there, where the timeout stops it.
  let read;
  try {
    read = JSON.parse(vm.runInContext('(() => { const names = Object.keys(window); let json; try { json = names.length === 1 ? JSON.stringify(window[names[0]]) : undefined; } catch (e) { json = undefined; } return JSON.stringify({ names: names.map(String), json }); })()', context, { timeout: 1000 }));
  } catch (e) {
    throw new Error(`${file} could not be read back: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
  const { names } = read;
  if (names.length !== 1) {
    throw new Error(names.length ? `${file} sets ${names.length} names on window (${names.join(', ')}); one is read` : `${file} sets nothing on window`);
  }
  const [global] = names;
  const items = read.json === undefined ? undefined : JSON.parse(read.json);
  if (items === undefined || items === null || typeof items !== 'object') throw new Error(`${file} sets window.${global} to something that is not a list or map`);
  return { global, items };
}

// Prints { global, items, tool_fields } (--json), or the global and each item's key, one a line. Exit 1 with an error line otherwise.
function runReadState({ file, json }) {
  let state;
  try { state = readState(file); } catch (e) {
    console.error(`Error: ${e.message}`);
    return 1;
  }
  // tool_fields: the prop fields the tool reads itself (collection.js); a state file never gives an item one of them,
  // so a hand-made entry's field by that name has nowhere to go (prop_move.py asks a person).
  const { GENERIC_PROP_FIELDS } = require('./collection');
  if (json) console.log(JSON.stringify({ ...state, tool_fields: [...GENERIC_PROP_FIELDS].sort() }, null, 2));
  else {
    const keys = Object.keys(state.items);
    console.log(`window.${state.global}: ${keys.length} item${keys.length === 1 ? '' : 's'}`);
    for (const k of keys) console.log(`  ${k}`);
  }
  return 0;
}

module.exports = { readState, runReadState };
