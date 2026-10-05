// A live thing's key: its kind and the name the page shows, lower-cased so the
// write-back finds its row whatever the capitals. No imports: parse, render and
// live-data all use this.
const liveKey = (kind, name) => `${kind}:${String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()}`;

// What a block passes to `marks` so a mark is drawn tappable. Undefined unless
// the page is live and this key has a track. Given the row it is drawing (`row`, the
// model's own object), a block gets an answer only for the row that owns the key: a
// later row of the same name is drawn as the note has it.
const liveOf = (model, key, fill, row) => (model && model.liveKeys && model.liveKeys.has(key)
  && (row === undefined || (model.liveRows && model.liveRows.has(row))) ? { key, fill } : undefined);

// The text a name shows on the page. The write-back matches rows with this too.
// [[Target|Shown]] and [[Target\|Shown]] give Shown; [[Ilse_Varn]] gives its file
// name with spaces; a path link gives its last segment.
const shown = name => String(name || '').replace(/\[\[([^\]]*)\]\]/g, (_, inner) => {
  const parts = inner.split(/\\?\|/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  return parts[0].split('#')[0].split('/').pop().replace(/_/g, ' ').trim();
});

// A count the page can mark: it has something to count, and no more spent than there is.
// Anything else is drawn as written, so the write-back leaves its cell alone.
const trackable = (max, used) => max > 0 && used <= max;

// A cell that holds nothing: blank, or a dash of any length typed to say so. The build's
// live data and the write-back both read a number cell and a Conditions cell with this.
const holdsNothing = text => /^[—–-]?$/.test(String(text == null ? '' : text).trim());

module.exports = { liveKey, liveOf, shown, trackable, holdsNothing };
