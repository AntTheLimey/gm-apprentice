// Cloudflare Pages Function: /api/request
//   POST { code, character, text }  → validate session code, enqueue into KV
//   GET  ?ids=a,b,c                 → { id: status } for the widget to poll
// KV namespace is bound as env.INBOX (see wrangler.toml). All queue logic lives
// in inbox-core.mjs so it stays identical to what the tool tests.
import * as inbox from './inbox-core.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.INBOX;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (await inbox.rateLimited(kv, ip)) return json({ error: 'rate' }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad' }, 400); }
  const character = body && body.character;
  const text = body && body.text;
  if (!character || !text || !String(text).trim()) return json({ error: 'bad' }, 400);
  if (!(await inbox.codeMatches(kv, body.code))) return json({ error: 'code' }, 403);

  const now = new Date().toISOString();
  const id = now.replace(/[^0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
  const entry = await inbox.enqueue(kv, { id, character: String(character), text: String(text).trim(), timestamp: now });
  return json({ id: entry.id, status: entry.status });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.INBOX;
  const url = new URL(request.url);
  const ids = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return json({});
  if (ids.length > 50) return json({ error: 'too many ids' }, 400);
  return json(await inbox.getResults(kv, ids));
}
