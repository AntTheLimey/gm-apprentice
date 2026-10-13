'use strict';
// Every way a setting's value is read. The only place the switch words are written.

const SWITCH_WORDS = new Map([['true', true], ['yes', true], ['on', true], ['false', false], ['no', false], ['off', false]]);

// undefined: not set. true/false: set. null: set to something that is not a switch word,
// a key left empty included.
function readSwitch(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string' && SWITCH_WORDS.has(raw.trim().toLowerCase())) return SWITCH_WORDS.get(raw.trim().toLowerCase());
  return null;
}

const ok = (value) => ({ ok: true, value });
const bad = { ok: false };
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const orList = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

// A list's plain entries (text, numbers, true/false) are read as text; null, a list or a map
// inside the list makes it unreadable.
const plain = (x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';
const readTextList = (raw) => (Array.isArray(raw) && raw.every(plain) ? ok(raw.map(String)) : bad);

const TYPES = {
  switch: {
    read: (raw) => { const b = readSwitch(raw); return typeof b === 'boolean' ? ok(b) : bad; },
    takes: () => 'on or off (yes, no, true and false work too)',
  },
  choice: {
    read(raw, entry) {
      const key = typeof raw === 'boolean' ? String(raw) : (typeof raw === 'string' ? raw.trim().toLowerCase() : null);
      if (key === null) return bad;
      if (entry.values.includes(key)) return ok(key);
      const alias = entry.aliases && Object.prototype.hasOwnProperty.call(entry.aliases, key) ? entry.aliases[key] : undefined;
      return alias === undefined ? bad : ok(alias);
    },
    takes: (entry) => orList(entry.values),
  },
  number: {
    read(raw, entry) {
      const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
      if (!Number.isFinite(n)) return bad;
      if (entry.integer && !Number.isInteger(n)) return bad;
      if (entry.min !== undefined && n < entry.min) return bad;
      if (entry.max !== undefined && n > entry.max) return bad;
      return ok(n);
    },
    takes(entry) {
      const kind = entry.integer ? 'a whole number' : 'a number';
      if (entry.min !== undefined && entry.max !== undefined) return `${kind} from ${entry.min} to ${entry.max}`;
      if (entry.min !== undefined) return `${kind}, ${entry.min} or more`;
      return kind;
    },
  },
  list: {
    read: (raw) => readTextList(raw),
    takes: (entry) => `a list of ${entry.of || 'names'}`,
  },
  switchOrList: {
    read(raw) {
      if (Array.isArray(raw)) return readTextList(raw);
      const b = readSwitch(raw);
      return typeof b === 'boolean' ? ok(b) : bad;
    },
    takes: (entry) => `on, off, or a list of ${entry.of || 'names'}`,
  },
  map: {
    read: (raw) => (isMap(raw) ? ok(raw) : bad),
    takes: (entry) => entry.shape || 'a map',
  },
  text: {
    read: (raw) => (typeof raw === 'string' || typeof raw === 'number' ? ok(raw) : bad),
    takes: () => 'text',
  },
  // A value the registry lists so it is not "unknown", read by code that owns its shape.
  any: { read: (raw) => ok(raw), takes: (entry) => entry.shape || 'see the settings page' },
};

module.exports = { TYPES, SWITCH_WORDS, readSwitch, isMap };
