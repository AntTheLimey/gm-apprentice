const fs = require('fs');
const path = require('path');

const bare = (name) => name.trim().replace(/^\//, '').replace(/\/$/, '');

/**
 * Add each of `names` the site folder's .gitignore does not name yet, when it has one.
 * In the file's own line endings; a site with no .gitignore gets none. A file that
 * cannot be written prints one warning naming `what` and the missing names, and
 * stops nothing.
 */
function ensureIgnored(siteDir, names, what) {
  const file = path.join(siteDir, '.gitignore');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const named = new Set(text.split(/\r?\n/).map(bare));
  const missing = names.filter((n) => !named.has(bare(n)));
  if (!missing.length) return;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text === '' || text.endsWith('\n') ? '' : eol;
  try {
    fs.appendFileSync(file, `${lead}${missing.join(eol)}${eol}`);
  } catch (err) {
    console.warn(`  WARNING: could not add ${what} ${missing.join(' ')} to ${file} (${err.code || err.message}); add ${missing.length > 1 ? 'them' : 'it'} by hand.`);
  }
}

module.exports = { ensureIgnored };
