// Pure KV logic for player loadout state. Bound to the same INBOX namespace as
// the change-request inbox, under a distinct `loadout:` key prefix.
export const PREFIX = 'loadout:';
export const TTL = 60 * 60 * 24 * 30; // 30 days — bounds orphaned keys

export function isValidKey(key) {
  return typeof key === 'string' && key.startsWith(PREFIX) && key.length <= 200;
}

export async function readState(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function writeState(kv, key, state) {
  await kv.put(key, JSON.stringify(state), { expirationTtl: TTL });
}

export function isValidCampaign(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 100 && !id.includes(':');
}

// Read every stored state under loadout:<campaignId>: — READ ONLY, no writes.
// Caps at `limit` keys (a party is a handful; the cap defends against runaway growth).
export async function listStates(kv, campaignId, limit = 200) {
  const prefix = PREFIX + campaignId + ':';
  const listed = await kv.list({ prefix });
  const names = (listed.keys || []).slice(0, limit).map((k) => k.name);
  const out = {};
  for (const name of names) {
    const raw = await kv.get(name);
    if (!raw) continue;
    try { out[name] = JSON.parse(raw); } catch { /* skip malformed */ }
  }
  return out;
}
