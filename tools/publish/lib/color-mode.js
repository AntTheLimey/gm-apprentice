'use strict';

// Reader-chosen light/dark mode (#260).
//
// Every palette switches through `@media (prefers-color-scheme: light)`, so a site
// silently followed each reader's OS setting and nobody could change it. The build now
// rewrites each such block into three:
//
//   @media screen and (prefers-color-scheme: light)  SEL -> :where(:root:not([data-theme="dark"])) SEL
//       the OS rule, switched off when the reader chose dark;
//   @media screen                                    SEL -> :where(:root[data-theme="light"]) SEL
//       a reader who chose light gets it whatever the OS says;
//   @media print                                     SEL unchanged
//       print always uses the light rules, whatever was chosen on screen.
//
// The prefixes sit inside :where(), so every selector keeps its specificity: a GM's
// custom palette (theme.css) or overrides.css, loaded later, still wins as it always did.
// The dark palette is the base (style.css is dark-first), so no dark copy is needed.
// Doing this as a build transform means every light block — preset palettes, the GURPS
// sheet chips, a GM's own overrides — gets the attribute version, and they can't drift.
//
// A tiny inline script at the top of <head> sets the attribute before the stylesheets
// paint, from the reader's saved choice or the site's default, so there is no flash of
// the wrong palette. With JavaScript off nothing sets it and the OS rule applies, as
// before.

const MODES = ['system', 'dark', 'light'];
const PREFIX = {
  notDark: { root: ':root:not(:where([data-theme="dark"]))', any: ':where(:root:not([data-theme="dark"]))' },
  light: { root: ':root:where([data-theme="light"])', any: ':where(:root[data-theme="light"])' },
};
const LIGHT_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)$/;

function normalizeDefaultMode(value) {
  const mode = String(value == null ? '' : value).trim().toLowerCase();
  return MODES.includes(mode) ? mode : 'system';
}

// Past a comment or string starting at `i`, or `i` itself when neither starts there.
function skipOpaque(css, i) {
  if (css[i] === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2);
    return end === -1 ? css.length : end + 2;
  }
  if (css[i] === '"' || css[i] === "'") {
    let j = i + 1;
    while (j < css.length && css[j] !== css[i]) j += css[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  return i;
}

// The index of the `}` closing the `{` at `open`, skipping comments and strings.
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const past = skipOpaque(css, i);
    if (past !== i) { i = past - 1; continue; }
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// The statements of a block body at depth 0: { kind: 'rule'|'at'|'raw', prelude, body, text }.
function statements(css) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < css.length) {
    const past = skipOpaque(css, i);
    if (past !== i) { i = past; continue; }
    if (css[i] === ';') {
      out.push({ kind: 'raw', text: css.slice(start, i + 1) });
      start = i = i + 1;
      continue;
    }
    if (css[i] === '{') {
      const close = matchBrace(css, i);
      if (close === -1) break;
      const raw = css.slice(start, i);
      const lead = raw.match(/^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/)[1];
      const prelude = stripComments(raw).trim();
      out.push({ kind: prelude.startsWith('@') ? 'at' : 'rule', lead, prelude,
                 body: css.slice(i + 1, close), text: css.slice(start, close + 1) });
      start = i = close + 1;
      continue;
    }
    i++;
  }
  if (start < css.length) out.push({ kind: 'raw', text: css.slice(start) });
  return out;
}

// Split a selector list on its top-level commas only: `:is(h1, h2)` and `[title="a,b"]`
// hold commas that aren't separators.
function splitSelectors(list) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < list.length; i++) {
    const past = skipOpaque(list, i);
    if (past !== i) { buf += list.slice(i, past); i = past - 1; continue; }
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; } else buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function prefixSelector(sel, p) {
  const m = sel.match(/^(:root|html)(?![\w-])/);
  if (m) return p.root + sel.slice(m[1].length);
  if (sel === '*') return `${p.root}, ${p.any} *`;      // * matched <html> too
  return `${p.any} ${sel}`;
}

const namesTheme = (st) => st.kind === 'rule' && st.prelude.includes('data-theme');

// A light block's body rewritten for one prefix. A rule that already names data-theme
// (a site's hand-written attribute rule) is kept as-is under `notDark` and dropped from
// the forced copy; nested at-rules (@supports, a width query) are rewritten inside.
function scopeBody(body, p, keepOwn) {
  const lines = [];
  for (const st of statements(body)) {
    if (st.kind === 'rule') {
      if (namesTheme(st)) { if (keepOwn) lines.push(`${st.prelude} {${st.body}}`); continue; }
      lines.push(`${splitSelectors(st.prelude).map(s => prefixSelector(s, p)).join(', ')} {${st.body}}`);
    } else if (st.kind === 'at') {
      const inner = scopeBody(st.body, p, keepOwn);
      if (inner.trim()) lines.push(`${st.prelude} {\n${inner}\n  }`);
    } else if (st.text.trim() && keepOwn) {
      lines.push(st.text.trim());
    }
  }
  return lines.map(l => `  ${l}`).join('\n');
}

function scopeColorScheme(css) {
  let changed = false;
  const out = statements(css).map((st) => {
    if (st.kind !== 'at' || !LIGHT_MEDIA.test(st.prelude)) return st.text;
    const rules = statements(st.body).filter(s => s.kind !== 'raw');
    if (rules.every(namesTheme)) return st.text;
    changed = true;
    const forced = scopeBody(st.body, PREFIX.light, false);
    return `${st.lead}@media screen and (prefers-color-scheme: light) {\n${scopeBody(st.body, PREFIX.notDark, true)}\n}`
      + (forced.trim() ? `\n@media screen {\n${forced}\n}` : '')
      + `\n@media print {${st.body}}`;
  });
  return changed ? out.join('') : css;
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
