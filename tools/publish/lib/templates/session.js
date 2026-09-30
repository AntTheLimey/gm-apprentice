const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { extractRecap } = require('./landing-data');

// The article body of a session page whose hub body is withheld (#276: the session has a
// published Wrap-Up, see session-hub.js). The page shell — title, metadata badges,
// portrait, sidebar, graph — stays the wiki page's, unchanged; this replaces only the
// rendered hub body:
//
//   the chapter (linked, and only when its page publishes) and the in-game date
//   the opening of the Wrap-Up's recap, and a link to the full Wrap-Up
//
// `scenes:` is deliberately absent: a hub lists every prepped scene, and a scene that
// never ran is a spoiler.
function sessionBodyHtml(page, context) {
  const fm = page.frontmatter || {};
  const ctx = context || {};
  const href = (target) => encodeHref(relativeHref(page.outputPath, target.outputPath));

  // Read from the PUBLISHED frontmatter, so a field the GM excluded or overrode through
  // the publish controls stays that way here. The badges above already carry
  // session_number and play_date.
  const facts = [];
  if (fm.chapter && ctx.chapter) {
    facts.push(`<span class="session-chapter">Chapter: <a href="${href(ctx.chapter)}">${escapeHtml(ctx.chapter.displayTitle || ctx.chapter.title)}</a></span>`);
  }
  if (fm.in_game_date) {
    const when = Array.isArray(fm.in_game_date) ? fm.in_game_date.join(' – ') : String(fm.in_game_date);
    facts.push(`<span class="session-in-game-date">In-game: ${escapeHtml(when)}</span>`);
  }
  const factsHtml = facts.length ? `<p class="session-facts">${facts.join(' · ')}</p>\n` : '';

  const recap = ctx.wrapUp ? extractRecap(ctx.wrapUp) : null;
  const link = ctx.wrapUp
    ? `<a class="recap-link" href="${href(ctx.wrapUp)}">Read the full session &rarr;</a>`
    : '';
  const recapHtml = `<div class="recap session-recap">${recap ? `<p>${escapeHtml(recap)}</p>` : ''}${link}</div>`;
  return factsHtml + recapHtml;
}

module.exports = { sessionBodyHtml };
