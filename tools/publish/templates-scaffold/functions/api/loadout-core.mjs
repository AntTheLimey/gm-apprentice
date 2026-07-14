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
