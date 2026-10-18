'use strict';

const crypto = require('node:crypto');

// KV member key shape: loadout:<campaignId>:<pcSlug>:<player>. The pcSlug is
// segment 2. Mirrors loadout-core.mjs's campaignOfKey (which reads segment 1).
function pcSlugOfKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  return parts.length >= 4 && parts[0] === 'loadout' ? parts[2] : null;
}

// Collapse a { key: blob } map to one blob per PC: the newest by updatedAt
// (each live-state save writes the whole blob, so newest = complete snapshot).
// Missing updatedAt sorts oldest; equal times break on the greater key so the
// result is deterministic regardless of object iteration order.
function latestRecordsByPcSlug(states) {
  const best = {}; // pcSlug -> { key, blob, at }
  for (const key of Object.keys(states || {})) {
    const slug = pcSlugOfKey(key);
    if (!slug) continue;
    const blob = states[key];
    if (!blob || typeof blob !== 'object') continue;
    const at = typeof blob.updatedAt === 'number' ? blob.updatedAt : 0;
    const cur = best[slug];
    if (!cur || at > cur.at || (at === cur.at && key > cur.key)) {
      best[slug] = { key: key, blob: blob, at: at };
    }
  }
  return best;
}

function latestStateByPcSlug(states) {
  const best = latestRecordsByPcSlug(states);
  const out = {};
  for (const slug of Object.keys(best)) out[slug] = best[slug].blob;
  return out;
}

// What names one saved record: its key and save time. A record with no save time is named by its
// content instead, so a changed one still reads as new.
function recordMarker(key, blob) {
  const stamp = typeof blob.updatedAt === 'number' ? String(blob.updatedAt) : 'c' + crypto.createHash('sha1').update(JSON.stringify(blob)).digest('hex');
  return key + '@' + stamp;
}

module.exports = { pcSlugOfKey, latestStateByPcSlug, latestRecordsByPcSlug, recordMarker };
