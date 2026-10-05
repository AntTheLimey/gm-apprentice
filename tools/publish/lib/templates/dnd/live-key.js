// A live thing's key: its kind and the name the page shows, lower-cased so the
// write-back finds its row whatever the capitals. No imports: parse, render and
// live-data all use this.
const liveKey = (kind, name) => `${kind}:${String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()}`;

// What a block passes to `marks` so a mark is drawn tappable. Undefined unless
// the page is live and this key has a track.
const liveOf = (model, key, fill) => (model && model.liveKeys && model.liveKeys.has(key) ? { key, fill } : undefined);

// The text a name shows on the page. The write-back matches rows with this too.
// [[Target|Shown]] and [[Target\|Shown]] give Shown; [[Ilse_Varn]] gives its file
// name with spaces; a path link gives its last segment.
const shown = name => String(name || '').replace(/\[\[([^\]]*)\]\]/g, (_, inner) => {
  const parts = inner.split(/\\?\|/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  return parts[0].split('#')[0].split('/').pop().replace(/_/g, ' ').trim();
});

module.exports = { liveKey, liveOf, shown };
