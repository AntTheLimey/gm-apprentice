const MarkdownIt = require('markdown-it');

// Obsidian callout: `> [!type] Optional Title` on the first line of a blockquote,
// with the rest of the quote as the body. The type may carry a fold marker (`+`/`-`),
// which affects Obsidian's reading view only and is ignored here.
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\][+-]?[ \t]*([^\n]*)(?:\n([\s\S]*))?$/;

// Rewrites callout blockquotes into `<div class="callout callout-{type}">` with a
// title div, so the `[!type]` marker never survives as literal body text.
//
// Registered after markdown-it's `inline` rule and therefore before `replacements` /
// `smartquotes`: the inline tokens this rule re-parses still get typographer treatment.
function calloutPlugin(md) {
  md.core.ruler.after('inline', 'obsidian_callout', function callouts(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      const pOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      const pClose = tokens[i + 3];
      if (!pOpen || pOpen.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;
      if (!pClose || pClose.type !== 'paragraph_close') continue;

      const match = CALLOUT_RE.exec(inline.content);
      if (!match) continue;

      // Find this blockquote's own close, not a nested one's.
      let depth = 0;
      let closeIndex = -1;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++;
        else if (tokens[j].type === 'blockquote_close') {
          depth--;
          if (depth === 0) { closeIndex = j; break; }
        }
      }
      if (closeIndex === -1) continue;

      const type = match[1].toLowerCase();
      // Obsidian falls back to the callout type as its own title when none is given.
      const title = match[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
      const body = match[3] || '';

      tokens[i].tag = 'div';
      tokens[i].attrJoin('class', `callout callout-${type}`);
      tokens[closeIndex].tag = 'div';

      pOpen.tag = 'div';
      pOpen.attrJoin('class', 'callout-title');
      pClose.tag = 'div';
      inline.content = title;
      inline.children = [];
      state.md.inline.parse(title, state.md, state.env, inline.children);

      // A callout written as one lazy paragraph (`> [!info] Title` then `> prose` with no
      // blank line) parses into a single inline token. Split the prose back out so it
      // renders as body rather than being swallowed by the title.
      if (body.trim()) {
        const bodyOpen = new state.Token('paragraph_open', 'p', 1);
        const bodyInline = new state.Token('inline', '', 0);
        bodyInline.content = body;
        bodyInline.children = [];
        state.md.inline.parse(body, state.md, state.env, bodyInline.children);
        const bodyClose = new state.Token('paragraph_close', 'p', -1);
        tokens.splice(i + 4, 0, bodyOpen, bodyInline, bodyClose);
      }
    }
  });
}

function createRenderer() {
  return new MarkdownIt({ html: false, typographer: true }).use(calloutPlugin);
}

module.exports = { createRenderer, calloutPlugin };
