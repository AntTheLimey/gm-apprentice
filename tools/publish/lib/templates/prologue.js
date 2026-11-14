'use strict';
// The backstory as a prologue: the PC page's Story tab and the top of the character's story page.
const { escapeHtml } = require('../processor');
const { splitTitle, asBlock } = require('../pc-background');

// `backstoryHtml` is backgroundParts' (processor HTML, GM-only text already gone).
function prologueHtml(name, backstoryHtml) {
  const { titleHtml, proseHtml } = splitTitle(asBlock(backstoryHtml));
  return `<article class="pc-prologue">
  <p class="pc-prologue-eyebrow">Before the campaign</p>
  <h2 class="pc-prologue-title">${titleHtml || `${escapeHtml(name)}'s backstory`}</h2>
  <p class="pc-prologue-byline">as their player wrote it</p>
  <div class="pc-prologue-prose">
${proseHtml.trim()}
  </div>
</article>`;
}

module.exports = { prologueHtml, asBlock };
