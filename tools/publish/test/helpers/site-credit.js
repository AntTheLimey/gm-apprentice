'use strict';
// A built page with the credit (player_site.credit) taken out, for a test that pins everything else about the page: its
// three parts, word for word, each a plain link, which a reader follows and nothing loads.
const RAVEN = '<span class="credit-raven" aria-hidden="true"></span>';
const CREDIT_MARK = `<a class="nav-credit" href="https://gmapprentice.com" rel="noopener" aria-label="Powered by GM-Apprentice">${RAVEN}</a>`;
const CREDIT_MENU = `<a class="mobile-credit" href="https://gmapprentice.com" rel="noopener">${RAVEN}Powered by GM-Apprentice</a>`;
const CREDIT_LINE = `<p class="site-credit">${RAVEN}<span>Powered by <a href="https://gmapprentice.com" rel="noopener">GM-Apprentice</a></span></p>`;
const CREDIT_FOOTER = `<footer class="site-footer credit-only">${CREDIT_LINE}</footer>`;
function withoutCredit(html) { return html.replace(CREDIT_MARK, '').replace(CREDIT_MENU, '').replace(CREDIT_FOOTER, ''); }

module.exports = { CREDIT_MARK, CREDIT_MENU, CREDIT_LINE, CREDIT_FOOTER, withoutCredit };
