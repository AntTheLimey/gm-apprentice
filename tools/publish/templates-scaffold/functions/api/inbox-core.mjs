// Pure inbox logic over a KV-like adapter:
//   { get(key), put(key, value, opts?), delete(key), list({ prefix }) }
// This is the SINGLE SOURCE of the KV layout contract. It is shipped verbatim
// into each site's functions/api/ (backing the public Pages Function) and is
// reused by the local inbox CLI (Part 3) via a wrangler-backed adapter.

export const PREFIX = 'req:';
export const CODE_KEY = 'config:code';
export const INDEX_KEY = 'config:req-index'; // JSON array of request ids; lets readPending skip kv.list()
export const RL_PREFIX = 'rl:';
export const HANDLED_TTL = 300; // seconds a handled entry lingers for the widget
export const RESPONSE_TTL = 600; // seconds a responded (handled) entry lingers for the widget

// The request index removes kv.list() from the change-request loop's hot path.
// The GM's inbox loop polls readPending repeatedly during a session; on the free
// tier that was one list per poll against a 1,000-lists/day cap. Now enqueue
// records each id in a single index key and readPending fans out plain gets.
// readIndex returns null ONLY when the key is truly absent (never seeded) — an
// emptied index is stored as `[]` — so ensureIndex can tell a cold start apart
// from an inbox that has simply been drained.
async function readIndex(kv) {
  const raw = await kv.get(INDEX_KEY);
  if (raw == null) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(kv, ids) {
  await kv.put(INDEX_KEY, JSON.stringify(ids));
}

// Return the current index, seeding it ONCE from a single kv.list() the first
// time it is missing. This is the migration bridge: a site upgraded from a
// pre-index deployment may already hold pending `req:` entries, and seeding
// recovers them so none are silently lost. After the seed the key exists (even
// if empty), so this never lists again.
async function ensureIndex(kv) {
  const existing = await readIndex(kv);
  if (existing !== null) return existing;
  // Cloudflare KV paginates list(): a single page caps at ~1,000 keys and an
  // empty `keys` array does NOT mean "done" — only `list_complete` does. Follow
  // the cursor so a pre-index inbox with more than one page seeds every req: key
  // rather than silently dropping the tail. (The in-memory test adapter returns
  // no cursor, so this collapses to a single list there.)
  const seeded = [];
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix: PREFIX, cursor });
    for (const { name } of (page.keys || [])) seeded.push(name.slice(PREFIX.length));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  // Re-read right before writing: a concurrent enqueue may have created the index
  // while we were listing, so union rather than clobber its ids.
  const landed = await readIndex(kv);
  const merged = landed === null ? seeded : [...new Set([...landed, ...seeded])];
  await writeIndex(kv, merged);
  return merged;
}

// Add an id to the index, re-reading immediately before the write and unioning so
// a concurrent enqueue's id is not clobbered. KV offers no compare-and-set, so a
// cross-edge simultaneous write can still race in theory; players sharing one
// table (hence one edge, with read-your-writes) are covered in practice.
async function addToIndex(kv, id) {
  const cur = (await readIndex(kv)) || [];
  if (!cur.includes(id)) { cur.push(id); await writeIndex(kv, cur); }
}

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
  await ensureIndex(kv);       // guarantee the index exists (seeds on migration)
  await addToIndex(kv, id);
  return entry;
}

// Read every pending/applied request WITHOUT kv.list() on the steady-state path.
// One get for the index, then one get per id. Ids are dropped from the index
// when their entry is terminal for this view: null (a handled entry that has
// self-reaped via TTL) or `flagged` (rejected — persists with no TTL and is
// never re-surfaced here, so it would otherwise cost a get on every poll
// forever). The prune re-reads the index immediately before writing and removes
// only those specific ids, so an enqueue that landed since our first read is
// preserved.
export async function readPending(kv) {
  const ids = await ensureIndex(kv);
  const out = [];
  const drop = [];
  for (const id of ids) {
    const raw = await kv.get(PREFIX + id);
    if (!raw) { drop.push(id); continue; }
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; } // corrupt but present → keep in index
    if (entry.status === 'pending' || entry.status === 'applied') out.push(entry);
    else if (entry.status === 'flagged') drop.push(id);
  }
  if (drop.length) {
    const dropSet = new Set(drop);
    const current = (await readIndex(kv)) || [];
    const cleaned = current.filter((id) => !dropSet.has(id));
    if (cleaned.length !== current.length) await writeIndex(kv, cleaned);
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
  const pairs = await Promise.all(ids.map(async (id) => {
    const raw = await kv.get(PREFIX + id);
    let val = { status: 'handled', response: null, kind: null };
    if (raw) {
      try {
        const e = JSON.parse(raw);
        val = { status: e.status, response: e.response ?? null, kind: e.kind ?? null };
      } catch { /* corrupt → treat as handled/no-response */ }
    }
    return [id, val];
  }));
  return Object.fromEntries(pairs);
}

export async function rateLimited(kv, ip, { limit = 10, windowSec = 60 } = {}) {
  const key = RL_PREFIX + ip;
  const n = parseInt((await kv.get(key)) || '0', 10);
  if (n >= limit) return true;
  await kv.put(key, String(n + 1), { expirationTtl: windowSec });
  return false;
}
