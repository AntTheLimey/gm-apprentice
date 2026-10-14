// A PC whose status is in the vault's out-of-play list leaves the party board and the active team
// (#265); the landing page lists them under "In Memoriam". Their sheet pages still render. The list is
// `vault.statuses.out_of_play`, read once in config.js (words trimmed and lower-cased); every caller passes
// it in, and a missing list throws rather than meaning "nobody".
function isOutOfPlay(frontmatter, outOfPlay) {
  return outOfPlay.has(String((frontmatter || {}).status || '').trim().toLowerCase());
}

module.exports = { isOutOfPlay };
