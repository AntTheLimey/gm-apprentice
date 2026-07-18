// Pure KV logic for player loadout state. Bound to the same INBOX namespace as
// the change-request inbox, under a distinct `loadout:` key prefix.
export const PREFIX = 'loadout:';
export const ROSTER_PREFIX = 'roster:';
export const TTL = 60 * 60 * 24 * 30; // 30 days — bounds orphaned keys

export function isValidKey(key) {
  return typeof key === 'string' && key.startsWith(PREFIX) && key.length <= 200;
}

// roster:<campaignId> holds the JSON array of member keys for a campaign, so the
// GM board can fan out reads WITHOUT kv.list() (the free tier caps lists at
// 1,000/day — a single open board burned them in ~1h23m). Member key shape is
// loadout:<campaignId>:<pc>:<player>, so the campaign is segment 1.
export function rosterKey(campaignId) {
  return ROSTER_PREFIX + campaignId;
}

function campaignOfKey(key) {
  if (!isValidKey(key)) return null;
  const parts = key.split(':'); // ['loadout', '<campaign>', '<pc>', '<player>']
  const campaign = parts[1];
  return isValidCampaign(campaign) ? campaign : null;
}

async function readRoster(kv, campaignId) {
  const raw = await kv.get(rosterKey(campaignId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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

// Add a member key to its campaign roster and refresh the roster's TTL. The
// re-put happens on EVERY save, not just when the key is new: member state keys
// refresh their own 30-day TTL on every writeState, so the roster index must be
// refreshed just as often — otherwise a long-running campaign with stable
// membership would let roster:<id> expire while its member keys live on, and the
// board would read an empty roster and render blank. Membership itself only
// grows when a genuinely new key appears.
export async function registerMember(kv, memberKey) {
  const campaignId = campaignOfKey(memberKey);
  if (!campaignId) return;
  const roster = await readRoster(kv, campaignId);
  if (!roster.includes(memberKey)) roster.push(memberKey);
  await kv.put(rosterKey(campaignId), JSON.stringify(roster), { expirationTtl: TTL });
}

// Read every party member's stored state — READ ONLY of member states, no
// kv.list(). One get for the roster (empty/absent → {}), then one get per
// member key. Members that resolve null (TTL-expired) or unparseable-but-null
// are skipped. If any resolved null, the roster is pruned so dead device keys
// don't accumulate forever — but the prune RE-READS the roster immediately
// before writing and removes only the confirmed-dead keys, so a registerMember
// that landed since our first read (KV is eventually consistent, so this window
// is not just same-instant) is preserved rather than clobbered.
export async function getStates(kv, campaignId) {
  const roster = await readRoster(kv, campaignId);
  const out = {};
  const dead = [];
  for (const key of roster) {
    const raw = await kv.get(key);
    if (!raw) { dead.push(key); continue; }
    try { out[key] = JSON.parse(raw); } catch { /* skip malformed but keep the key */ }
  }
  if (dead.length) {
    const deadSet = new Set(dead);
    const current = await readRoster(kv, campaignId);
    const cleaned = current.filter((k) => !deadSet.has(k));
    if (cleaned.length !== current.length) {
      await kv.put(rosterKey(campaignId), JSON.stringify(cleaned), { expirationTtl: TTL });
    }
  }
  return out;
}
