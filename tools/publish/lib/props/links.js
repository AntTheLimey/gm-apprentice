'use strict';

// The local files a hand-made prop page links, read with patterns over a fixed set of
// attributes (the tool has no HTML parser). `<a href>` is never read: a link to another
// page is not a file the prop needs. A `data-*` attribute is read only when its value is a
// picture's path: a page's own script may show it (a map plate opened full screen).

const PICTURE_PATH = /^[^\s:]+\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i;

function cssRefs(css) {
  const found = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) found.push(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])(.*?)\1/gi)) found.push(m[2]);
  return found;
}

function htmlRefs(html) {
  const found = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w:-]*)((?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?)>/g)) {
    const name = tag[1].toLowerCase();
    const attrs = {};
    for (const a of tag[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4].replace(/\/$/, "");
    }
    if (attrs.src) found.push(attrs.src);
    if (attrs.poster) found.push(attrs.poster);
    if (attrs.srcset) {
      for (const cand of attrs.srcset.split(',')) {
        const u = cand.trim().split(/\s+/)[0];
        if (u) found.push(u);
      }
    }
    if (name === 'link' || name === 'image' || name === 'use') {
      if (attrs.href) found.push(attrs.href);
      if (attrs['xlink:href']) found.push(attrs['xlink:href']);
    }
    if (attrs.style) found.push(...cssRefs(attrs.style));
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('data-') && PICTURE_PATH.test(value.trim())) found.push(value);
    }
  }
  for (const s of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) found.push(...cssRefs(s[1]));
  return found;
}

function decoded(raw) {
  const bare = raw.split('#')[0].split('?')[0];
  try { return decodeURIComponent(bare); } catch { return bare; }
}

function localRefs(text, ext) {
  const raws = ext === '.css' ? cssRefs(String(text)) : htmlRefs(String(text));
  const refs = [];
  const rooted = [];
  const seen = new Set();
  for (const r of raws) {
    const raw = r.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    if (raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    if (raw.startsWith('/')) { rooted.push(raw); continue; }
    const p = decoded(raw);
    if (p) refs.push({ raw, path: p });
  }
  return { refs, rooted };
}

module.exports = { localRefs };
