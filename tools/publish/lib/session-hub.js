const { isSessionHub, parseWikiRef } = require('./processor');
const { buildWrapUpIndex, WRAP_UP_TYPES } = require('./story-spine');
const { canonicalNfc } = require('./unicode');

// The session index (hub) is metadata only by design, and GMs use its body as a working
// dashboard: plan links, scene prep states, "Keeper-only" notes. Once the session has a
// published Wrap-Up, that Wrap-Up is the session's record, so the hub body is withheld and
// the session page is generated from the frontmatter plus the Wrap-Up's recap (#276).
// Without one, the hub body is the only record the site has — some vaults write their
// recaps there and have no Wrap-Ups at all — so it publishes exactly as it always has.
//
// Every reader goes through suppressHubBody: build.js empties the body before the
// published view is computed (so search, backlinks, recency, the relationship graph and
// the landing fallback agree with the page), the session page swaps in the generated
// recap, and `doctor --site` / `explain` report from it. Change the rule here only.

const contexts = new WeakMap();

// Published Wrap-Ups keyed two ways, built once per `pages` array.
function contextFor(pages) {
  let ctx = contexts.get(pages);
  if (!ctx) {
    const byTitle = new Map();
    for (const p of pages) {
      if (p && p.frontmatter && WRAP_UP_TYPES.has(p.frontmatter.type)) {
        const key = canonicalNfc(p.title);
        if (!byTitle.has(key)) byTitle.set(key, p);
      }
    }
    ctx = { byTitle, idx: buildWrapUpIndex(pages) };
    contexts.set(pages, ctx);
  }
  return ctx;
}

// The published Wrap-Up paired with this session index, or null. Only an explicit link
// counts — the hub's `documents.wrap_up`, or the Wrap-Up's own `session:` — never folder
// proximity or session_number: a wrong guess would hide a hub's real recap behind some
// other session's.
function publishedWrapUpFor(page, pages) {
  if (!isSessionHub(page) || !Array.isArray(pages)) return null;
  const ctx = contextFor(pages);
  const docs = page.frontmatter.documents;
  const linked = docs && typeof docs === 'object' ? docs.wrap_up : null;
  if (linked) {
    const hit = ctx.byTitle.get(canonicalNfc(parseWikiRef(String(linked)).target));
    if (hit) return hit;
  }
  return ctx.idx.bySession.get(canonicalNfc(page.title)) || null;
}

// `pages` is the set of pages that actually publish.
function suppressHubBody(page, pages) {
  return publishedWrapUpFor(page, pages) !== null;
}

module.exports = { suppressHubBody, publishedWrapUpFor };
