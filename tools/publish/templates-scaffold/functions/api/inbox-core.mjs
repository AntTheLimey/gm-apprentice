// Pure inbox logic over a KV-like adapter:
//   { get(key), put(key, value, opts?), delete(key), list({ prefix }) }
// This is the SINGLE SOURCE of the KV layout contract. It is shipped verbatim
// into each site's functions/api/ (backing the public Pages Function) and is
// reused by the local inbox CLI (Part 3) via a wrangler-backed adapter.

export const PREFIX = 'req:';
export const CODE_KEY = 'config:code';
export const RL_PREFIX = 'rl:';
export const HANDLED_TTL = 300; // seconds a handled entry lingers for the widget
export const RESPONSE_TTL = 600; // seconds a responded (handled) entry lingers for the widget

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

export async function getCode(kv) {
  return (await kv.get(CODE_KEY)) || null;
}

export async function setCode(kv, raw) {
  const code = normalizeCode(raw);
  await kv.put(CODE_KEY, code);
  return code;
}

export async function codeMatches(kv, submitted) {
  const current = await getCode(kv);
  if (!current) return false; // no session open → reject everything
  return normalizeCode(submitted) === current;
}

export function buildEntry({ id, character, text, timestamp }) {
  return { id, character, text, timestamp, status: 'pending', response: null, kind: null };
}

export async function enqueue(kv, { id, character, text, timestamp }) {
  const entry = buildEntry({ id, character, text, timestamp });
  await kv.put(PREFIX + id, JSON.stringify(entry));
  return entry;
}

export async function readPending(kv) {
  const out = [];
  const { keys } = await kv.list({ prefix: PREFIX });
  for (const { name } of keys) {
    const raw = await kv.get(name);
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.status === 'pending' || entry.status === 'applied') out.push(entry);
  }
  return out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

async function setStatus(kv, id, status, opts) {
  const raw = await kv.get(PREFIX + id);
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  entry.status = status;
  await kv.put(PREFIX + id, JSON.stringify(entry), opts);
  return entry;
}

export async function markApplied(kv, id) { return setStatus(kv, id, 'applied'); }
export async function markHandled(kv, id) { return setStatus(kv, id, 'handled', { expirationTtl: HANDLED_TTL }); }
export async function markFlagged(kv, id) { return setStatus(kv, id, 'flagged'); }

// Attach a player-facing response and finalize the entry:
//   applied/advice → handled (with TTL, so the widget catches it then it self-reaps)
//   rejected       → flagged (persists for the GM), still carries the response
export async function setResponse(kv, id, kind, text) {
  const raw = await kv.get(PREFIX + id);
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  entry.response = text;
  entry.kind = kind;
  entry.status = kind === 'rejected' ? 'flagged' : 'handled';
  const opts = kind === 'rejected' ? undefined : { expirationTtl: RESPONSE_TTL };
  await kv.put(PREFIX + id, JSON.stringify(entry), opts);
  return entry;
}

export async function getResults(kv, ids) {
  const result = {};
  for (const id of ids) {
    const raw = await kv.get(PREFIX + id);
    let val = { status: 'handled', response: null, kind: null };
    if (raw) {
      try {
        const e = JSON.parse(raw);
        val = { status: e.status, response: e.response ?? null, kind: e.kind ?? null };
      } catch { /* corrupt → treat as handled/no-response */ }
    }
    result[id] = val;
  }
  return result;
}

export async function rateLimited(kv, ip, { limit = 10, windowSec = 60 } = {}) {
  const key = RL_PREFIX + ip;
  const n = parseInt((await kv.get(key)) || '0', 10);
  if (n >= limit) return true;
  await kv.put(key, String(n + 1), { expirationTtl: windowSec });
  return false;
}
