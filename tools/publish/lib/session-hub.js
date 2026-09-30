const path = require('path');
const { isSessionHub, parseWikiRef, gmAliasRewriter } = require('./processor');
const { linkKeys, scanAllNotes } = require('./scanner');
const { canonicalNfc } = require('./unicode');

// The session index (hub) is metadata only by design, and GMs use its body as a working
// dashboard: plan links, scene prep states, "Keeper-only" notes. Once the session has a
// published Wrap-Up, that Wrap-Up is the session's record, so the hub body is withheld and
// the session page is generated from the frontmatter plus the Wrap-Up's recap (#276).
// Without one, the hub body is the only record the site has — some vaults write their
// recaps there and have no Wrap-Ups at all — so it publishes exactly as it always has.
//
// This file is the ONE pairing rule, and pairHubs the one place it runs. build.js pairs
// once, on the unreduced frontmatter, empties the paired hub bodies before the published
// view is computed (so search, backlinks and the relationship graph agree with the page),
// and hands the same map to the session page, the Saga, the landing recap and recency —
// none of which pairs on its own. `manifest publish-played` ticks a hub only when
// pairHubs says its body will be withheld, `doctor --site` and `explain` report from it,
// and vault_check asks `explain --all --json` and `manifest publish-played --dry-run
// --json` rather than re-implementing it. Change the rule here only.

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
    const wrapUps = pages.filter(isWrapUp);
    ctx = { wrapUps, published: new Set(wrapUps), hubs: pages.filter(isSessionHub) };
    contexts.set(pages, ctx);
  }
  return ctx;
}

// The chapter a `chapter:` link names, by its last path segment, so `[[Ch1]]` and
// `[[Chapters/Ch1]]` agree.
function chapterName(page) {
  const target = chapterOf(page);
  return target ? target.slice(target.lastIndexOf('/') + 1) : '';
}

// A Wrap-Up and a hub that each name a chapter, and not the same one.
function otherChapter(wrapUp, hub) {
  const a = chapterName(wrapUp);
  const b = chapterName(hub);
  return !!(a && b && a !== b);
}

// The published Wrap-Up paired with this session index, or null. Only an explicit link
// counts — the hub's `documents.wrap_up`, or the Wrap-Up's own `session:` — never folder
// proximity or session_number: a wrong guess would hide a hub's real recap behind some
// other session's. Both links resolve the way the site resolves `[[links]]` (title, vault
// path or alias), and a link that names several pages takes the nearest (see nearest).
//
// A link is resolved against EVERY session index and Wrap-Up in the vault, published or
// not, and only then must its target publish. Resolving against published pages only
// let a same-titled page in another chapter win whenever the real target stayed
// unpublished: Ch1's "Session 01 Wrap-Up" claiming `[[Session 01]]` while Ch1's hub is
// `publish: false` took over Ch2's "Session 01" and hid its body. A `session:` claim
// also fails when the Wrap-Up's `chapter:` names a different chapter from the hub's.
// A link still ambiguous after all that pairs with nothing.
//
// `pages` is the set of pages that publish; the hub itself need not be among them.
// `vault`, when given, is { hubs, wrapUps }: every session index and Wrap-Up in the
// vault (pairHubs passes it). Without it, `pages` stands in for the vault.
function publishedWrapUpFor(page, pages, vault) {
  if (!isSessionHub(page) || !Array.isArray(pages)) return null;
  const ctx = contextFor(pages);
  const hubs = vault && vault.hubs ? vault.hubs : ctx.hubs;
  const allHubs = hubs.includes(page) ? hubs : hubs.concat([page]);
  const allWrapUps = vault && vault.wrapUps ? vault.wrapUps : ctx.wrapUps;
  const docs = page.frontmatter.documents;
  const linked = docs && typeof docs === 'object' ? linkTarget(docs.wrap_up) : '';
  const byLink = nearest(page, named(linked, allWrapUps));
  if (byLink && ctx.published.has(byLink)) return byLink;
  const claiming = ctx.wrapUps.filter((w) => {
    const said = linkTarget(w.frontmatter.session);
    return said && linkKeys(page).includes(said) && !otherChapter(w, page)
      && nearest(w, named(said, allHubs)) === page;
  });
  return nearest(page, claiming);
}

// `pages` is the set of pages that actually publish.
function suppressHubBody(page, pages) {
  return publishedWrapUpFor(page, pages) !== null;
}

// The build's alias-rewrite-then-pair step, the one path the build, `explain` and
// `manifest publish-played` all take (#212, #276). GM aliases are rewritten to their
// owners' titles with the rewriter the build uses (owners from every note in the vault;
// only `published` pages claim a name), and every session index in `corpus` is then
// paired against the published Wrap-Ups. A `documents.wrap_up` written as a GM alias
// therefore pairs the same way everywhere.
//
// Returns Map(hub page -> published Wrap-Up page) for every paired hub in `corpus`,
// keyed and valued with the caller's own page objects.
//   options.vaultPath  where scanAllNotes finds the notes the scan skipped
//   options.allNotes   scanAllNotes(vaultPath), when the caller already has it
//   options.apply      rewrite `corpus` in place (markdown, storyMarkdown, frontmatter),
//                      as the build does before anything renders; otherwise the
//                      rewrite is applied to copies used only for pairing, so a caller
//                      can pair against several hypothetical `published` sets.
function pairHubs(corpus, published, options) {
  const opts = options || {};
  const scanned = new Set(corpus.map((p) => p.sourcePath));
  const notes = opts.allNotes || scanAllNotes(opts.vaultPath);
  const unscanned = notes.filter((n) => !scanned.has(n.sourcePath));
  const rewriter = gmAliasRewriter(corpus.concat(unscanned), published);
  let view = (p) => p;
  if (rewriter && opts.apply) {
    for (const page of corpus) {
      page.markdown = rewriter.markdown(page.markdown || '');
      if (page.storyMarkdown) page.storyMarkdown = rewriter.markdown(page.storyMarkdown);
      page.frontmatter = rewriter.frontmatter(page.frontmatter);
    }
  } else if (rewriter) {
    const views = new Map(corpus.map((p) => [p, Object.assign({}, p, { frontmatter: rewriter.frontmatter(p.frontmatter) })]));
    view = (p) => views.get(p) || p;
  }
  const rewrite = (n) => (rewriter ? Object.assign({}, n, { frontmatter: rewriter.frontmatter(n.frontmatter || {}) }) : n);
  // Every session index and Wrap-Up in the vault: the scanned corpus (published or not)
  // plus the notes the scan skipped, so a link resolves against all of them.
  const everything = corpus.map(view).concat(unscanned.map(rewrite));
  const vault = { hubs: everything.filter(isSessionHub), wrapUps: everything.filter(isWrapUp) };
  const viewPublished = published.map(view);
  const original = new Map(viewPublished.map((v, i) => [v, published[i]]));
  const pairs = new Map();
  for (const page of corpus) {
    const wrap = publishedWrapUpFor(view(page), viewPublished, vault);
    if (wrap) pairs.set(page, original.get(wrap) || wrap);
  }
  // Every published Wrap-Up an explicit link touches, paired or not: its `session:` names
  // a session index somewhere in the vault, or some session index names it in
  // `documents.wrap_up`. Readers that fall back to folder or number for a session with no
  // paired Wrap-Up (the Saga, the landing recap) may only fall back to a Wrap-Up outside
  // this set, so a Wrap-Up linked to one session never stands in for another. A
  // `session:` that names no note at all (a stale title) links nothing.
  const namedByHub = new Set(vault.hubs.map((h) => {
    const docs = h.frontmatter && h.frontmatter.documents;
    return docs && typeof docs === 'object' ? linkTarget(docs.wrap_up) : '';
  }).filter(Boolean));
  const claimsAHub = (w) => named(linkTarget(w.frontmatter.session), vault.hubs).length > 0;
  pairs.linked = new Set(viewPublished
    .filter((w) => isWrapUp(w) && (claimsAHub(w) || linkKeys(w).some((k) => namedByHub.has(k))))
    .map((w) => original.get(w) || w));
  for (const wrap of pairs.values()) pairs.linked.add(wrap);
  return pairs;
}

// Whether an explicit link ties `wrapUp` to some session, so it must never stand in for
// a session it is not paired with (see pairHubs' `linked`). `pairs` is the map pairHubs
// returned. Without one, any `session:` at all counts as a link: fail safe.
function isLinkedWrapUp(wrapUp, pairs) {
  if (pairs && pairs.linked) return pairs.linked.has(wrapUp);
  return !!linkTarget(wrapUp && wrapUp.frontmatter && wrapUp.frontmatter.session);
}

module.exports = { suppressHubBody, publishedWrapUpFor, pairHubs, isLinkedWrapUp, WRAP_UP_TYPES, isWrapUp };
