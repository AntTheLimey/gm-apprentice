'use strict';
// A place's title for the run sheet (the one rule, final review follow-up): the note's own `name`, else its first
// alias, else, for a folder note (a stem of index, README or _index), its folder's name, else its file's stem with
// `_` as spaces. The reader puts it on every place's entry (`title` in `placeNotes` and `notes`), and every screen
// that names a place reads it from there: the place beat, the Add line, Move them's list, the Table Log. The
// players' caption keeps its own rule (only a name the note gives itself: 5b decision 12).

const FOLDER_NOTE = /^(?:index|readme|_index)$/i;

function placeTitle(notePath, fm = {}) {
  const f = fm && typeof fm === 'object' ? fm : {};
  if (typeof f.name === 'string' && f.name.trim()) return f.name.trim();
  const aliases = (Array.isArray(f.aliases) ? f.aliases : [f.aliases]).filter((a) => typeof a === 'string' && a.trim());
  if (aliases.length) return aliases[0].trim();
  const parts = String(notePath || '').split('/');
  const stem = parts[parts.length - 1].replace(/\.md$/i, '');
  if (FOLDER_NOTE.test(stem) && parts.length > 1 && parts[parts.length - 2]) return parts[parts.length - 2].replace(/_/g, ' ');
  return stem.replace(/_/g, ' ');
}

module.exports = { placeTitle };
