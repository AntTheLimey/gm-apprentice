// A PC whose status is in the vault's out-of-play list leaves the party board and the active team
// (#265); the landing page lists them under "In Memoriam". Their sheet pages still render. The list is
// `vault.statuses.out_of_play`, read once in config.js (words trimmed and lower-cased); every caller passes
// it in, and a missing list throws rather than meaning "nobody".
function isOutOfPlay(frontmatter, outOfPlay) {
  // A one-item list (Obsidian's list property) is read as its item; any other list is no status. vaultlib.py's
  // is_out_of_play reads it the same.
  let status = (frontmatter || {}).status;
  if (Array.isArray(status)) status = status.length === 1 ? status[0] : '';
  return outOfPlay.has(String(status || '').trim().toLowerCase());
}

module.exports = { isOutOfPlay };
