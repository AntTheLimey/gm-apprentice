const path = require('path');
const { isSessionHub, parseWikiRef } = require('./processor');
const { linkKeys } = require('./scanner');
const { canonicalNfc } = require('./unicode');

// The session index (hub) is metadata only by design, and GMs use its body as a working
// dashboard: plan links, scene prep states, "Keeper-only" notes. Once the session has a
// published Wrap-Up, that Wrap-Up is the session's record, so the hub body is withheld and
// the session page is generated from the frontmatter plus the Wrap-Up's recap (#276).
// Without one, the hub body is the only record the site has — some vaults write their
// recaps there and have no Wrap-Ups at all — so it publishes exactly as it always has.
//
// This file is the ONE pairing rule. Every reader goes through publishedWrapUpFor /
// suppressHubBody: build.js empties the body before the published view is computed (so
// search, backlinks, recency, the relationship graph and the landing fallback agree with
// the page), the session page swaps in the generated recap, the story spine takes the
// session's recap from the same Wrap-Up, `manifest publish-played` ticks a hub only when
// this says its body will be withheld, `doctor --site` and `explain` report from it, and
// vault_check asks `explain --all --json` rather than re-implementing it. Change the rule
// here only.

const WRAP_UP_TYPES = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);

function isWrapUp(page) {
  return !!(page && page.frontmatter && WRAP_UP_TYPES.has(page.frontmatter.type));
}

// The target a frontmatter link names, as a `[[link]]` in a page body names it: the part
// before `|`, NFC — no case folding, and `#heading` kept, because the site's own link
// resolution (buildLinkMap) does neither. A pairing link that would not resolve as a link
// on the site does not pair.
function linkTarget(value) {
  if (value == null || value === '') return '';
  return canonicalNfc(parseWikiRef(String(value)).target);
}

function folderOf(page) {
  return page && page.sourcePath ? path.dirname(page.sourcePath) : null;
}

function chapterOf(page) {
  return linkTarget(page && page.frontmatter && page.frontmatter.chapter);
}

// One page out of several a link could name: the only candidate, else the one sharing
// `near`'s folder, else the one sharing its `chapter:`. Two same-named Wrap-Ups (Ch1 and
// Ch2 each with "Session 01 Wrap-Up") pair with their own chapter's hub. Still ambiguous
// is null: a wrong guess would hide a hub's real record behind another session's recap.
function nearest(near, candidates) {
  if (candidates.length <= 1) return candidates[0] || null;
  const dir = folderOf(near);
  const sameFolder = dir ? candidates.filter((c) => folderOf(c) === dir) : [];
  if (sameFolder.length === 1) return sameFolder[0];
  const chapter = chapterOf(near);
  const pool = sameFolder.length > 1 ? sameFolder : candidates;
  const sameChapter = chapter ? pool.filter((c) => chapterOf(c) === chapter) : [];
  return sameChapter.length === 1 ? sameChapter[0] : null;
}

function named(target, pages) {
  if (!target) return [];
  return pages.filter((p) => linkKeys(p).includes(target));
}

const contexts = new WeakMap();

// Published Wrap-Ups and session indexes, gathered once per `pages` array.
function contextFor(pages) {
  let ctx = contexts.get(pages);
  if (!ctx) {
    ctx = { wrapUps: pages.filter(isWrapUp), hubs: pages.filter(isSessionHub) };
    contexts.set(pages, ctx);
  }
  return ctx;
}

// The published Wrap-Up paired with this session index, or null. Only an explicit link
// counts — the hub's `documents.wrap_up`, or the Wrap-Up's own `session:` — never folder
// proximity or session_number: a wrong guess would hide a hub's real recap behind some
// other session's. Both links resolve the way the site resolves `[[links]]` (title, vault
// path or alias), and a link that names several pages takes the nearest (see nearest).
// A `session:` link counts only when, resolved from the Wrap-Up, it lands on THIS hub.
// `pages` is the set of pages that publish; the hub itself need not be among them.
function publishedWrapUpFor(page, pages) {
  if (!isSessionHub(page) || !Array.isArray(pages)) return null;
  const ctx = contextFor(pages);
  const docs = page.frontmatter.documents;
  const linked = docs && typeof docs === 'object' ? linkTarget(docs.wrap_up) : '';
  const byLink = nearest(page, named(linked, ctx.wrapUps));
  if (byLink) return byLink;
  const hubs = ctx.hubs.includes(page) ? ctx.hubs : ctx.hubs.concat([page]);
  const claiming = ctx.wrapUps.filter((w) => {
    const said = linkTarget(w.frontmatter.session);
    return said && linkKeys(page).includes(said) && nearest(w, named(said, hubs)) === page;
  });
  return nearest(page, claiming);
}

// `pages` is the set of pages that actually publish.
function suppressHubBody(page, pages) {
  return publishedWrapUpFor(page, pages) !== null;
}

module.exports = { suppressHubBody, publishedWrapUpFor, WRAP_UP_TYPES, isWrapUp };
