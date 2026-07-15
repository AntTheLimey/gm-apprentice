// Cloudflare Pages Function: /api/loadout
//   GET  ?key=loadout:<campaign>:<pc>:<player>  → { state } | {}
//   PUT  { key, state }                          → { ok: true } (last-write-wins)
// KV namespace bound as env.INBOX (see wrangler.toml). Logic lives in
// loadout-core.mjs so it stays identical to what the tool tests.
import * as core from './loadout-core.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const key = new URL(request.url).searchParams.get('key');
  if (!core.isValidKey(key)) return json({}, 400);
  const state = await core.readState(env.INBOX, key);
  return state ? json({ state }) : json({});
}

export async function onRequestPut(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad' }, 400); }
  if (!core.isValidKey(body && body.key) || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
    return json({ error: 'bad' }, 400);
  }
  await core.writeState(env.INBOX, body.key, body.state);
  return json({ ok: true });
}
