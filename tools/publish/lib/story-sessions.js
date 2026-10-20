'use strict';
// Session links for a story page (#465): an id on each session heading, a "Sessions" row of
// number chips above the first one, and a copy-link icon beside each. A story is a PC's story page
// or an NPC whose Overview runs session by session; the rule is the note's own headings: two or
// more at one level reading "Session N: Title" (or "Session N — Title"). A page with fewer is left
// as written. The icon's click is js/story-links.js.
const { escapeHtml } = require('./processor');

const HEADING = /<h([2-6])>\s*Session (\d+)(\s*[:—–-]\s*)([\s\S]*?)<\/h\1>/g;
const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.8 4.4 9.2 3a3.1 3.1 0 0 1 4.4 4.4l-2.1 2.1a3.1 3.1 0 0 1-4.4 0l1-1a1.7 1.7 0 0 0 2.4 0l2.1-2.1a1.7 1.7 0 1 0-2.4-2.4L8.8 5.4zm.4 7.2L6.8 13a3.1 3.1 0 0 1-4.4-4.4l2.1-2.1a3.1 3.1 0 0 1 4.4 0l-1 1a1.7 1.7 0 0 0-2.4 0L3.4 9.6A1.7 1.7 0 1 0 5.8 12l1.4-1.4z"/></svg>';

const anchorFor = (n) => `<a class="story-anchor" href="#session-${n}" aria-label="Copy link to Session ${n}" title="Copy link to Session ${n}">${ICON}</a>`;
// The title as plain text for an attribute: the heading's own markup (a link, emphasis) dropped
// and its entities read back, so escapeHtml does not escape them twice.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const plain = (html) => html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]).trim();

// Returns the page's html with its session headings linked, or the html unchanged.
function linkSessions(html) {
  if (typeof html !== 'string' || !html) return html;
  const found = [...html.matchAll(HEADING)];
  const level = found.length ? found[0][1] : null;
  const seen = new Set();
  // Same level as the first, and the first of a number: an id is unique on a page.
  const sessions = found.filter((m) => m[1] === level && !seen.has(m[2]) && seen.add(m[2]));
  if (sessions.length < 2) return html;
  const chosen = new Set(sessions.map((m) => m.index));
  let first = true;
  const nav = () => {
    const chips = sessions.map((m) => {
      const label = escapeHtml(`Session ${m[2]}: ${plain(m[4])}`);
      return `<li><a href="#session-${m[2]}" title="${label}" aria-label="${label}">${m[2]}</a></li>`;
    }).join('');
    return `<nav class="story-jump" aria-label="Jump to a session"><span class="story-jump-label">Sessions</span><ol>${chips}</ol></nav>`;
  };
  return html.replace(HEADING, (whole, lvl, n, sep, title, offset) => {
    if (!chosen.has(offset)) return whole;
    const lead = first ? nav() : '';
    first = false;
    // A third-level heading is a chapter break (number over title); a second-level one is a line.
    const heading = lvl === '3'
      ? `<h3 class="story-session" id="session-${n}"><span class="story-session-n">Session ${n}${anchorFor(n)}</span>${title}</h3>`
      : `<h${lvl} class="story-entry" id="session-${n}">Session ${n}${sep}${title}${anchorFor(n)}</h${lvl}>`;
    return lead + heading;
  });
}

module.exports = { linkSessions };
