'use strict';

// Reader-chosen light/dark mode (#260).
//
// Every palette switches through `@media (prefers-color-scheme: light)`, so a site
// silently followed each reader's OS setting and nobody could change it. The build now
// rewrites each such block so an attribute on <html> can override the OS either way:
//
//   inside the media query   `SEL`  ->  `:root:not([data-theme="dark"]) SEL`
//                            so a reader who chose dark keeps the dark palette;
//   a copy outside it        `SEL`  ->  `:root[data-theme="light"] SEL`
//                            so a reader who chose light gets it whatever the OS says.
//
// The dark palette is the base (style.css is dark-first), so no dark copy is needed.
// Doing this as a build transform, not by hand, means every light block — preset
// palettes, the GURPS sheet chips, encumbrance rows, damage cells, anything added
// later — gets the attribute version, and the two can never drift apart.
//
// A tiny inline script at the top of <head> sets the attribute before the stylesheets
// paint, from the reader's saved choice or the site's default, so there is no flash of
// the wrong palette. With JavaScript off nothing sets it and the OS rule applies, as
// before.

const MODES = ['system', 'dark', 'light'];
const NOT_DARK = ':root:not([data-theme="dark"])';
const FORCED_LIGHT = ':root[data-theme="light"]';
const LIGHT_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)\s*$/;

function normalizeDefaultMode(value) {
  const mode = String(value == null ? '' : value).trim().toLowerCase();
  return MODES.includes(mode) ? mode : 'system';
}

// The index of the `}` closing the `{` at `open`, skipping comments and strings.
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function prefixSelector(sel, prefix) {
  const s = sel.trim();
  if (s === ':root' || s === 'html') return prefix;
  if (s.startsWith(':root')) return prefix + s.slice(':root'.length);
  if (/^html\b/.test(s)) return prefix + s.slice('html'.length);
  return `${prefix} ${s}`;
}

// The rules of one light block: [{ selectors, body, own }], where `own` marks a rule
// that already names data-theme (a site's hand-written attribute rule), left alone.
function parseRules(body) {
  const rules = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const close = matchBrace(body, open);
    if (close === -1) break;
    const selector = body.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selector) {
      rules.push({
        selectors: selector.split(',').map(s => s.trim()).filter(Boolean),
        body: body.slice(open, close + 1),
        own: selector.includes('data-theme'),
      });
    }
    i = close + 1;
  }
  return rules;
}

function scopeColorScheme(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    if (open === -1) break;
    const prelude = css.slice(at, open);
    const close = matchBrace(css, open);
    if (close === -1) break;
    if (!LIGHT_MEDIA.test(prelude)) {
      out += css.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const rules = parseRules(css.slice(open + 1, close));
    if (rules.every(r => r.own)) {
      out += css.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const scoped = (prefix) => rules.map(r => (r.own && prefix === NOT_DARK
      ? `  ${r.selectors.join(', ')} ${r.body}`
      : `  ${r.selectors.map(s => prefixSelector(s, prefix)).join(', ')} ${r.body}`));
    const inside = scoped(NOT_DARK).join('\n');
    const forced = rules.filter(r => !r.own)
      .map(r => `${r.selectors.map(s => prefixSelector(s, FORCED_LIGHT)).join(', ')} ${r.body}`)
      .join('\n');
    out += css.slice(i, at) + `${prelude.trim()} {\n${inside}\n}\n${forced}`;
    i = close + 1;
  }
  return out + css.slice(i);
}

// A per-site key: sites on one origin (GitHub Pages project sites) share localStorage.
// A short hash of the site's identity rather than its title, so no page text leaks into
// the markup (FNV-1a, 32-bit).
function storageKey(siteId) {
  let h = 0x811c9dc5;
  for (const ch of String(siteId || 'site')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `gm-apprentice:color-mode:${h.toString(16)}`;
}

// Inline, first thing in <head>. Sets data-theme from the saved choice or the site
// default ('system' sets nothing), and defines the toggle the nav button calls.
function headScript(defaultMode, key) {
  const mode = JSON.stringify(normalizeDefaultMode(defaultMode));
  const k = JSON.stringify(key);
  return '<script>(function(){'
    + `var k=${k},d=${mode},r=document.documentElement,m=null;`
    + 'try{m=localStorage.getItem(k)}catch(e){}'
    + "if(m!=='dark'&&m!=='light')m=d==='system'?null:d;"
    + "if(m)r.setAttribute('data-theme',m);"
    + 'window.gmToggleColorMode=function(){'
    + "var c=r.getAttribute('data-theme');"
    + "if(c!=='dark'&&c!=='light')c=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';"
    + "var n=c==='light'?'dark':'light';r.setAttribute('data-theme',n);"
    + 'try{localStorage.setItem(k,n)}catch(e){}};'
    + '}())</script>';
}

// The nav button shows the mode it switches TO; CSS picks the glyph from the palette in
// force, so it is right on first paint without waiting for a script.
const TOGGLE_BUTTON = '<button class="nav-color-mode-btn" type="button" onclick="window.gmToggleColorMode&&gmToggleColorMode()" '
  + 'aria-label="Switch between light and dark mode" title="Light or dark mode">'
  + '<span class="to-light" aria-hidden="true">&#9728;</span>'
  + '<span class="to-dark" aria-hidden="true">&#9790;</span></button>';

const MOBILE_TOGGLE = '<button class="mobile-color-mode-btn" type="button" onclick="window.gmToggleColorMode&&gmToggleColorMode()">'
  + '<span class="to-light">&#9728; Light mode</span><span class="to-dark">&#9790; Dark mode</span></button>';

module.exports = { scopeColorScheme, normalizeDefaultMode, headScript, storageKey, TOGGLE_BUTTON, MOBILE_TOGGLE, MODES };
