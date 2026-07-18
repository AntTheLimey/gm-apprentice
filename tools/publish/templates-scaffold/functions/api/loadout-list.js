// Cloudflare Pages Function: /api/loadout-list  (READ ONLY — no PUT/POST)
//   GET ?campaign=<campaignId>  → { states: { "<key>": {v,items,hp,fp,updatedAt}, ... } }
// Aggregates every party member's live loadout/HP-FP state for the GM dashboard.
// KV namespace bound as env.INBOX. Logic lives in loadout-core.mjs.
import * as core from './loadout-core.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const campaign = new URL(request.url).searchParams.get('campaign');
  if (!core.isValidCampaign(campaign)) return json({}, 400);
  const states = await core.getStates(env.INBOX, campaign);
  return json({ states });
}
