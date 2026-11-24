'use strict';
// The banner at the top of an NPC or location page with no picture (#868): its name, values, small labels and badges
// read across the whole banner, 4.5:1 or better, in light and dark mode. It used to fade from the header colour to the
// card colour, which in light mode left them on mid-grey. Measured in a real browser from the computed colours: the
// banner's gradient is worked out at each corner and the middle of every word, and a badge's own tint is laid over it.
// Skipped without Chrome or Chromium (set GM_TEST_CHROME to point at one), except on CI.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildVault } = require('./helpers/build-vault');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const skip = browserSkip();
const FILES = {
  'Characters/NPCs/Odile Varr.md': '---\ntype: npc\noccupation: Lamp-wright\nstatus: alive\nage: 58\n---\n\nShe trims the wicks.\n',
  'Locations/Harbour.md': '---\ntype: location\nlocation_type: district\natmosphere: damp\n---\n\nFog.\n',
};
const PAGES = ['characters/npcs/odile-varr.html', 'locations/harbour.html'];

// The lowest contrast of each kind of word in the banner, as { what: [text, ratio] }.
const MEASURE = `(() => {
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    const c = s.match(/color\\(srgb ([^)]+)\\)/); if (c) { const p = c[1].split(/[ \\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return null; };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
  const banner = document.querySelector('.hero-banner-no-img');
  if (!banner) return null;
  const bs = getComputedStyle(banner);
  const stops = bs.backgroundImage === 'none' ? null : [...bs.backgroundImage.matchAll(/(rgba?\\([^)]+\\)|color\\(srgb [^)]+\\))/g)].map((m) => parse(m[1]));
  const am = bs.backgroundImage.match(/linear-gradient\\((\\d+)deg/);
  const a = (am ? +am[1] : 180) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const R = banner.getBoundingClientRect(), L = Math.abs(R.width * dx) + Math.abs(R.height * dy);
  const bgAt = (x, y) => {
    if (!stops) return parse(bs.backgroundColor);
    const t = Math.min(1, Math.max(0, 0.5 + ((x - R.left - R.width / 2) * dx + (y - R.top - R.height / 2) * dy) / L));
    const seg = (stops.length - 1) * t, i = Math.min(stops.length - 2, Math.floor(seg));
    return mix(stops[i], stops[i + 1], seg - i);
  };
  const worst = (el) => {
    const fg = parse(getComputedStyle(el).color);
    let op = 1; for (let n = el; n && n !== banner.parentElement; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    const r = el.getBoundingClientRect(); let min = Infinity;
    for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]) {
      let bg = bgAt(x, y);
      for (let n = el; n && n !== banner; n = n.parentElement) { const own = parse(getComputedStyle(n).backgroundColor); if (own && own[3] > 0) bg = mix(bg, own, own[3]); }
      min = Math.min(min, ratio(mix(bg, fg, op * fg[3]), bg));
    }
    return [el.textContent.trim(), Math.round(min * 100) / 100];
  };
  // The values are the bare words beside each label: wrapped so they can be measured.
  const values = [...banner.querySelectorAll('.meta > *')].flatMap((s) => [...s.childNodes]
    .filter((n) => n.nodeType === 3 && n.textContent.trim())
    .map((n) => { const w = document.createElement('span'); n.replaceWith(w); w.append(n); return w; }));
  const low = (els) => els.map(worst).sort((p, q) => p[1] - q[1])[0] || null;
  return { name: worst(banner.querySelector('h1')), labels: low([...banner.querySelectorAll('.meta .label')]),
    badges: low([...banner.querySelectorAll('.metadata-badge')]), values: low(values) };
})()`;

describe('the no-picture banner on NPC and location pages reads in light and dark mode', { skip }, () => {
  const built = {};
  before(() => {
    built.default = buildVault(FILES);
    built.noir = buildVault(FILES, { settings: { 'player_site.theme.genre': 'noir' } });
    built.fantasy = buildVault(FILES, { settings: { 'player_site.theme.genre': 'fantasy' } });
    // A custom palette with a light header: the accent is darkened to read on it.
    built['light header'] = buildVault(FILES, { settings: Object.fromEntries(Object.entries({ primary: '#e8d9b0', accent: '#c08a5a', background: '#faf6ea', text: '#222222' })
      .map(([k, v]) => [`player_site.theme.palette.${k}`, v])) });
  });
  after(() => { for (const b of Object.values(built)) b.cleanup(); });

  for (const look of ['default', 'noir', 'fantasy', 'light header']) {
    it(`${look}: name, values, labels and badges are 4.5:1 or better`, async () => {
      for (const page of PAGES) {
        for (const mode of ['light', 'dark']) {
          await withPage({ width: 1100, height: 800 }, async (p) => {
            await p.goto(pathToFileURL(path.join(built[look].root, 'docs', page)).href);
            await p.waitFor('document.readyState === "complete"');
            await p.evaluate(`document.documentElement.setAttribute('data-theme', '${mode}')`);
            const r = await p.evaluate(MEASURE);
            assert.ok(r, `${page} has a no-picture banner`);
            const kinds = page.startsWith('locations') ? ['name', 'badges'] : ['name', 'labels', 'values'];
            for (const k of kinds) {
              assert.ok(r[k], `${page}: the banner has ${k}`);
              assert.ok(r[k][1] >= 4.5, `${look}, ${mode}, ${page}: ${k} "${r[k][0]}" is ${r[k][1]}:1`);
            }
          });
        }
      }
    });
  }
});
