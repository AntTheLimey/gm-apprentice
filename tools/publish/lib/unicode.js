// Unicode normal form is the hidden variable behind every string comparison this tool
// makes (#139). A name typed with precomposed accents ("González", NFC) and the same
// visible name decomposed into base letter + combining marks (NFD) are identical on
// screen and different byte-for-byte — and which form a given string arrives in depends
// on the editor, the OS, and the filesystem that round-tripped it. Both sides of a
// comparison must therefore be put into one normal form first, or the match silently
// misses and the failure surfaces as "the link didn't render" rather than as an error.
//
// NFC is the canonical form throughout: it is what the web, git, and most editors emit.
function canonicalNfc(value) {
  return String(value).normalize('NFC');
}

// Wrap a lookup table so that reads canonicalize their key.
//
// The two big tables — linkMap (page titles and aliases) and imageMap (attachment
// basenames) — are indexed from build.js, processor.js, and a dozen entity templates,
// and the query string is always author-typed text: the words inside a `[[wikilink]]`,
// a `portrait:` value, a relationship target, a `parent`/`holder`/`leader` name. The keys
// come from filenames and frontmatter. Key and query are typed on different keyboards in
// different apps, so they routinely disagree on normal form.
//
// Normalizing at the table rather than at each call site is deliberate: the guarantee then
// holds by construction for every present and future lookup, instead of depending on some
// forty call sites each remembering to normalize — the failure this codebase keeps
// rediscovering, where one call site is fixed and its siblings are left behind.
// Keys are stored already canonicalized, so enumeration (Object.keys /
// entries / values) is unchanged, and the stored VALUES — output paths, attachment
// relPaths — are never touched. That is what keeps #139's normalization orthogonal to
// #145's percent-encoding: only comparison keys are canonicalized, never emitted paths.
//
// What this does NOT cover — read before relying on it:
//   * `set` and `delete` are untrapped. Writing through the wrapper with a non-canonical key
//     stores that key verbatim, creating a duplicate entry that reads can never reach.
//     Build tables fully as a plain object, canonicalizing keys yourself, then wrap once.
//   * `Object.prototype.hasOwnProperty.call(map, k)` and `Object.keys(map).includes(k)`
//     bypass the traps and see only the stored keys; `k in map` and `map[k]` go through them.
//     Prefer the latter two.
//   * A copy loses the guarantee. Spread, `Object.assign({}, map)`, and a JSON round-trip all
//     produce a plain object again; re-wrap if the copy is going to be looked up.
//   * `Map` and `Set` cannot be wrapped at all — their lookups are method calls, not property
//     access. Every `Map`/`Set` keyed on author-typed text is therefore call-site-dependent
//     and must canonicalize at both the write and the read. `recency.js`, `story-spine.js`,
//     and the chapter matcher in `build.js` are the ones that exist today.
function nfcLookupTable(map) {
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        const key = canonicalNfc(prop);
        if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, canonicalNfc(prop))) {
        return true;
      }
      return Reflect.has(target, prop);
    },
  });
}

// --- Display-side helpers (#157) ---
//
// Distinct in purpose from everything above: those exist so two strings *compare*
// equal, these exist so one string *renders* and *measures* the way a reader sees
// it. The failures they fix are cosmetic, not structural — an initial that loses
// its accent, a label truncated a character early — but they share the same root
// cause, which is that JS string indexing counts UTF-16 code units while a reader
// counts what looks like one character.
//
// Composing first collapses the common case (base + combining mark becomes one
// code point); segmenting handles the rest, including marks with no precomposed
// form and astral characters, which are surrogate pairs.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(value) {
  return Array.from(graphemeSegmenter.segment(canonicalNfc(value)), (g) => g.segment);
}

// Truncate by what the reader counts as a character, not by code unit. Returns the
// composed string untouched when it fits.
function truncateGraphemes(value, max, keep, ellipsis = '…') {
  const composed = canonicalNfc(value);
  const parts = graphemes(composed);
  return parts.length > max ? parts.slice(0, keep).join('') + ellipsis : composed;
}

module.exports = { canonicalNfc, nfcLookupTable, graphemes, truncateGraphemes };
