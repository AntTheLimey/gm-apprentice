// PC statuses that take a character out of play. The landing page lists these PCs
// under "fallen" rather than the active party, and the roster's Party Status board
// leaves them off entirely (#265); their sheet pages still render. Compared
// case-insensitively against frontmatter `status:`.
// `inactive` and `npc` match vaultlib's PC_INACTIVE_STATUS and session-principles.
const OUT_OF_PLAY_STATUSES = new Set(['dead', 'deceased', 'kia', 'retired', 'departed', 'missing', 'unknown', 'inactive', 'npc']);

function isOutOfPlay(frontmatter) {
  return OUT_OF_PLAY_STATUSES.has(String((frontmatter || {}).status || '').trim().toLowerCase());
}

module.exports = { OUT_OF_PLAY_STATUSES, isOutOfPlay };
