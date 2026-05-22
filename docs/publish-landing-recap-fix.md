# Publish Tool: Landing Page Recap + Wrap-Up Sidebar Fix

Three related bugs in the publish tool's handling of session
wrap-up pages.

## Bug 1: Landing page shows no recap text

`landing.js` calls `extractRecap(latestSession)` on the session
index page, which has no `## Narrative Recap` heading. The recap
lives in the wrap-up file, not the session index.

## Bug 2: "Read full session" links to session index

The landing page links to `latestSession.outputPath` (the session
index), not the wrap-up page where the actual narrative lives.

## Bug 3: Wrap-up page compressed by "Mentioned In" sidebar

`wiki.js` unconditionally passes backlinks to
`renderContextSidebar()` for all page types. On wrap-up pages,
this produces a "Mentioned In" sidebar that compresses the main
content to ~60% width with no useful information.

---

## Implementation

### File 1: `tools/publish/lib/templates/landing-data.js`

Add `getLatestWrapUp` function and export it.

```javascript
function getLatestWrapUp(pages, session) {
  if (!session) return null;
  const wrapTypes = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);
  const wrapUps = pages.filter(p => wrapTypes.has(p.frontmatter.type));
  const sessionTitle = session.title || '';
  for (const wu of wrapUps) {
    const ref = String(wu.frontmatter.session || '');
    if (ref.includes(sessionTitle)) return wu;
  }
  const num = session.frontmatter.session_number;
  if (num != null) {
    for (const wu of wrapUps) {
      if (wu.frontmatter.session_number === num) return wu;
    }
  }
  return null;
}

module.exports = { getLatestSession, getLatestWrapUp, extractRecap, ... };
```

### File 2: `tools/publish/lib/templates/landing.js`

Import `getLatestWrapUp`. In Zone 2, find the wrap-up and use
it as both the recap source and the link target:

```javascript
const latestSession = getLatestSession(pages);
const latestWrapUp = getLatestWrapUp(pages, latestSession);
let recapZone = '';
if (latestSession) {
  const recapSource = latestWrapUp || latestSession;
  const recap = extractRecap(recapSource);
  const linkTarget = latestWrapUp || latestSession;
  const recapLink = `<a class="recap-link" href="${escapeHtml(linkTarget.outputPath)}">Read full session &rarr;</a>`;
```

### File 3: `tools/publish/lib/templates/wiki.js`

Suppress backlinks for wrap-up page types:

```javascript
const WRAP_UP_TYPES = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);
const isWrapUp = WRAP_UP_TYPES.has(fm.type);

let sidebar = renderContextSidebar({
  backlinks: isWrapUp ? [] : backlinks,
  relationships: normalizeRelationships(fm.relationships, linkMap),
  currentOutputPath: page.outputPath,
});
```
