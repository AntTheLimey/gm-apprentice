'use strict';
// A built page with the credit line (player_site.credit) taken out, for a test that pins everything else about the
// page. Only the footer the tool writes for a site with no footer of its own, word for word: a plain link, which a
// reader follows and nothing loads.
const CREDIT_FOOTER = '<footer class="site-footer"><p class="site-credit"><a href="https://gmapprentice.com" rel="noopener">Powered by GM-Apprentice</a></p></footer>';
function withoutCredit(html) { return html.replace(CREDIT_FOOTER, ''); }

module.exports = { CREDIT_FOOTER, withoutCredit };
