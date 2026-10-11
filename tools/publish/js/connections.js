// Connections: the page's plain nested lists become tabs and one of three drawings (a tree, a
// web or cards) with a line under the drawing for the name in focus. The data is the JSON
// island the build wrote beside the lists; every value from it is set as text (textContent),
// never as markup. If the island cannot be read the lists are left as the build wrote them.
(function () {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';
  var NARROW = 560;          // below this width the tree indents and the crowded web gives way
  var CROWDED = 16;          // a web with more names than this is a tree on a phone
  var ROW = 28;
  var GAP = 14;
  var TONE_CLASS = { w: 'cx-warm', h: 'cx-hostile', n: 'cx-neutral' };
  var TONE_WORD = { w: 'warm', h: 'hostile', n: 'neutral' };
  var SMALL = 1.3;           // a web on a narrow screen is shrunk to fit, so its marks are drawn this much larger
  var ROOMY = 720;           // from this width a tree row has room for its kind and sessions

  function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  function treatmentFor(mode, itemCount, width) {
    if (mode === 'web' && itemCount > CROWDED && width < NARROW) return 'tree';
    return mode;
  }

  // An estimate of the tree's rows and branch points for a width, for when nothing can be
  // measured. The page draws from measured rows (treeLines). A row's y is its centre. Wide: one trunk from the
  // subject to each group, then a curve to each name. Narrow: a heading row per group and
  // an indented elbow to each name.
  function treeLayout(groups, width) {
    var narrow = width < NARROW;
    var y = narrow ? 44 : 20;
    var rows = [];
    var branches = [];
    var first = 0;
    groups.forEach(function (group, g) {
      if (narrow) y += ROW;
      var top = rows.length;
      group.d.forEach(function (item, index) {
        rows.push({ group: g, index: index, y: y });
        y += ROW;
      });
      var count = group.d.length;
      var by = narrow ? rows[top].y - ROW : (rows[top].y + rows[top + count - 1].y) / 2;
      branches.push({ label: group.n, y: by, first: first, count: count });
      first += count;
      y += GAP;
    });
    var rootY = 16;
    if (!narrow && rows.length) rootY = Math.max(40, (rows[0].y + rows[rows.length - 1].y) / 2);
    return {
      narrow: narrow, height: y, width: width, rows: rows, branches: branches,
      root: { x: narrow ? 10 : 14, y: rootY },
      trunkX: narrow ? 30 : Math.round(width * 0.34),
      leafX: narrow ? 50 : Math.round(width * 0.54)
    };
  }

  // ---- the web's geometry ----
  // Everything is in the drawing's own units, one to a CSS pixel when the column is wide
  // enough, with the subject at 0, 0. Angles run clockwise from the top.
  var WEB = {
    row: 16,          // the least room between two neighbouring names where they start
    nameGap: 13,      // from a name's mark to its first letter
    spineIn: 30,      // a group's arc sits this far inside the ring of marks
    labelIn: 52,      // and its label this far inside (clear of the arc in a tall typeface too)
    labelHigh: 9,     // the height of a label's capitals
    labelClear: 8,    // from a group's line to the start of its label
    bandGap: 20,      // from the end of one group's label to the next group's line
    rootLine: 18,
    minRadius: 118,
    fullRadius: 150,
    pad: 8
  };

  // A width for a text when nothing can be measured: on the generous side, so a layout made
  // from it has room to spare.
  function estimate(text, kind) {
    var n = String(text).length;
    if (kind === 'band') return n * 9.4;
    if (kind === 'root') return n * 9.2;
    return n * 7.4;
  }

  // The subject's name in the fewest balanced lines that keep its disc small: every line
  // lies inside the disc of radius r.
  function rootBlock(subject, measure) {
    var words = String(subject).split(/\s+/).filter(Boolean);
    if (!words.length) words = ['?'];
    var widths = words.map(function (w) { return measure(w, 'root'); });
    var space = measure('n', 'root') * 0.55;
    var all = 0;
    var longest = 0;
    widths.forEach(function (w) { all += w + space; longest = Math.max(longest, w); });
    var best = null;
    for (var count = 1; count <= Math.min(words.length, 8); count++) {
      var limit = Math.max(longest, (all / count) * 1.12);
      var lines = [];
      var line = null;
      words.forEach(function (word, i) {
        if (line && line.w + space + widths[i] <= limit) { line.text += ' ' + word; line.w += space + widths[i]; }
        else { line = { text: word, w: widths[i] }; lines.push(line); }
      });
      var r = 0;
      lines.forEach(function (l, i) {
        l.y = (i - (lines.length - 1) / 2) * WEB.rootLine;
        r = Math.max(r, Math.sqrt((l.w / 2) * (l.w / 2) + (Math.abs(l.y) + WEB.rootLine / 2) * (Math.abs(l.y) + WEB.rootLine / 2)));
      });
      if (!best || r < best.r - 0.5) best = { r: r, lines: lines };
    }
    return { r: Math.max(30, Math.ceil(best.r + 7)), lines: best.lines };
  }

  // The subject in the middle, a line out to each group, the group's arc, and its names on
  // one ring with each name set outward. A group takes the arc its names need or its label
  // needs, whichever is longer, so a label is never longer than its arc; the ring grows
  // until every group fits, and the names then spread to fill it. The box is what was drawn
  // and no more, so a tab with one name is a short strip, not an empty ring.
  //   opts.subject  the name in the middle
  //   opts.measure  (text, 'name' | 'band' | 'root') -> width; an estimate when not given
  //   opts.clip     the longest name drawn, in characters (opts.clipLabel for a group's label)
  //   opts.compact  keep the ring as small as the names and labels allow (a narrow screen
  //                 shrinks the whole drawing to fit, so a smaller drawing is larger type)
  function webLayout(groups, opts) {
    opts = opts || {};
    var measure = opts.measure || estimate;
    var clipAt = opts.clip || 26;
    var FULL = 2 * Math.PI;
    var root = rootBlock(opts.subject || '', measure);
    var total = 0;
    var sets = groups.map(function (group) {
      var label = clip(group.n, opts.clipLabel || 60);
      total += group.d.length;
      return {
        label: label, w: measure(label, 'band') + 4,
        names: group.d.map(function (item) { var t = clip(item.t, clipAt); return { text: t, w: measure(t, 'name') }; })
      };
    });
    var empty = { box: { x: -root.r - WEB.pad, y: -root.r - WEB.pad, w: 2 * (root.r + WEB.pad), h: 2 * (root.r + WEB.pad) }, radius: 0, spine: 0, labelRadius: 0, root: root, nodes: [], bands: [], step: 0 };
    if (!total) return empty;

    // A handful of names keep a small ring; more than that and the ring is the full size.
    var R = Math.max(total > 4 && !opts.compact ? WEB.fullRadius : WEB.minRadius, root.r + WEB.labelIn + 16);
    function gapFor(R, s) { return Math.max(s, WEB.bandGap / (R - WEB.labelIn)); }
    function spanFor(R, s, set) {
      var rl = R - WEB.labelIn;
      return Math.max((set.names.length - 1) * s, (WEB.labelClear + set.w) / rl);
    }
    function around(R, s) {
      var sum = sets.length * gapFor(R, s);
      sets.forEach(function (set) { sum += spanFor(R, s, set); });
      return sum;
    }
    function least(R) { return WEB.row / (R + WEB.nameGap); }
    // Room to breathe while the ring is small, then only what the names must have.
    while (!opts.compact && R < WEB.fullRadius && around(R, (WEB.row * 1.4) / (R + WEB.nameGap)) > FULL) R += 4;
    for (var tries = 0; tries < 200 && around(R, least(R)) > FULL; tries++) {
      R = Math.ceil(R * Math.min(1.5, Math.max(1.02, around(R, least(R)) / FULL)));
    }
    var lo = least(R);
    var hi = FULL;
    for (var n = 0; n < 50; n++) {
      var mid = (lo + hi) / 2;
      if (around(R, mid) > FULL) hi = mid; else lo = mid;
    }
    var step = lo;
    var rl = R - WEB.labelIn;
    var gap = gapFor(R, step);
    var xs = [-root.r, root.r];
    var ys = [-root.r, root.r];
    function at(r, a) { return [r * Math.sin(a), -r * Math.cos(a)]; }
    function seen(p) { xs.push(p[0]); ys.push(p[1]); }

    var nodes = [];
    var bands = [];
    // One or two names sit at the sides, where a name set outward reads level.
    var angle = total <= 2 ? Math.PI / 2 : 0;
    sets.forEach(function (set, g) {
      var from = angle;
      var span = spanFor(R, step, set);
      set.names.forEach(function (name, index) {
        var a = from + index * step;
        var p = at(R, a);
        var deg = ((a * 180) / Math.PI) % 360;
        var right = deg < 180;
        var start = at(R + WEB.nameGap, a);
        // the name's own box, turned: from its first letter out to its last, half a row each side
        var along = [Math.sin(a), -Math.cos(a)];
        var across = [Math.cos(a), Math.sin(a)];
        var corners = [[0, -1], [0, 1], [1, -1], [1, 1]].map(function (c) {
          return [start[0] + along[0] * name.w * c[0] + across[0] * (WEB.row / 2) * c[1], start[1] + along[1] * name.w * c[0] + across[1] * (WEB.row / 2) * c[1]];
        });
        corners.forEach(seen);
        [[-16, 0], [16, 0], [0, -16], [0, 16]].forEach(function (d) { seen([p[0] + d[0], p[1] + d[1]]); });
        nodes.push({ group: g, index: index, angle: a, x: p[0], y: p[1], text: name.text, w: name.w, tx: start[0], ty: start[1], right: right, turn: right ? deg - 90 : deg + 90, corners: corners });
      });
      var to = from + (set.names.length - 1) * step;
      var labelFrom = from + WEB.labelClear / rl;
      var labelTo = from + span;
      var middle = (labelFrom + labelTo) / 2;
      bands.push({ label: set.label, w: set.w, from: from, to: to, labelFrom: labelFrom, labelTo: labelTo, flip: Math.cos(middle) < -0.2 });
      for (var a = from; a <= labelTo + 1e-9; a += Math.min(0.08, Math.max(1e-3, labelTo - from))) { seen(at(rl - 2, a)); seen(at(R - WEB.spineIn + 2, a)); }
      seen(at(rl - 2, labelTo)); seen(at(R - WEB.spineIn + 2, labelTo));
      angle += span + gap;
    });
    var minX = Math.min.apply(null, xs) - WEB.pad;
    var minY = Math.min.apply(null, ys) - WEB.pad;
    return {
      box: { x: Math.floor(minX), y: Math.floor(minY), w: Math.ceil(Math.max.apply(null, xs) + WEB.pad - Math.floor(minX)), h: Math.ceil(Math.max.apply(null, ys) + WEB.pad - Math.floor(minY)) },
      radius: R, spine: R - WEB.spineIn, labelRadius: rl, root: root, nodes: nodes, bands: bands, step: step
    };
  }

  // A web is drawn one unit to a pixel and shrunk to its column. Below this share of its
  // size its 13px names are under 9px, and it is not drawn.
  function readable(drawingWidth, columnWidth) {
    return columnWidth >= drawingWidth * 0.7;
  }

  function nextTab(current, count, key) {
    if (key === 'ArrowRight') return (current + 1) % count;
    if (key === 'ArrowLeft') return (current + count - 1) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return current;
  }

  // On a touch screen the first tap on a row shows its line; the second follows the link.
  function tapAction(selected, target, pointerType) {
    return pointerType === 'touch' && selected !== target ? 'select' : 'follow';
  }

  function toneClass(code) { return has(TONE_CLASS, code) ? TONE_CLASS[code] : ''; }

  // The words lib/templates/connections.js writes for a session count.
  function sessionsText(s) {
    if (!s || !s[0]) return '';
    if (s[0] === 1) return '1 session: ' + s[1];
    return s[0] + ' sessions, ' + s[1] + ' to ' + s[2];
  }

  function countText(s) {
    return s && s[0] ? s[0] + (s[0] === 1 ? ' session' : ' sessions') : '';
  }

  function initials(title) {
    var words = String(title).replace(/^(Miss|Mr|Mrs|Ms|Dr|Sir|Lady|Lord|Sitt|The)\s+/i, '').split(/\s+/).filter(Boolean);
    var out = words.slice(0, 2).map(function (w) { return w.charAt(0); }).join('');
    return out || '?';
  }

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // Only a relative path the build wrote is a link: no scheme, no leading slash or backslash,
  // no space or control character. Anything else is no link, and the item is drawn as text.
  function safeHref(h) {
    if (typeof h !== 'string' || !h) return null;
    if (/[\u0000- \u007f-\u009f\\]/.test(h)) return null;
    if (h.charAt(0) === '/' || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
    return h;
  }

  var isText = function (v) { return typeof v === 'string'; };

  // One item, or null when it has no name. A field that is the wrong shape is dropped, so
  // nothing prints "undefined".
  function validItem(it) {
    if (!it || typeof it !== 'object' || !isText(it.t) || !it.t) return null;
    var s = it.s;
    var sessions = Array.isArray(s) && typeof s[0] === 'number' && s[0] > 0 && isText(s[1]) && isText(s[2]) ? [s[0], s[1], s[2]] : null;
    return {
      t: it.t, h: safeHref(it.h), k: isText(it.k) ? it.k : '',
      o: has(TONE_CLASS, it.o) ? it.o : null,
      l: Array.isArray(it.l) ? it.l.filter(isText) : [],
      f: typeof it.f === 'number' && it.f >= 0 ? Math.floor(it.f) : 0,
      s: sessions, i: safeHref(it.i)
    };
  }

  // The island as the script uses it, or null when nothing usable is left. A malformed item,
  // group or tab is skipped; the rest is kept.
  function normalise(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.t)) return null;
    var tabs = [];
    data.t.forEach(function (tab) {
      if (!tab || typeof tab !== 'object' || !isText(tab.id) || !isText(tab.n) || !Array.isArray(tab.g)) return;
      var groups = [];
      tab.g.forEach(function (g) {
        if (!g || typeof g !== 'object' || !isText(g.n) || !Array.isArray(g.d)) return;
        var d = g.d.map(validItem).filter(Boolean);
        if (d.length) groups.push({ n: g.n, d: d });
      });
      if (groups.length) tabs.push({ id: tab.id, n: tab.n, g: groups });
    });
    var mentions = [];
    (Array.isArray(data.m) ? data.m : []).forEach(function (g) {
      if (!g || typeof g !== 'object' || !isText(g.n) || !Array.isArray(g.d)) return;
      var d = g.d.filter(function (q) { return Array.isArray(q) && isText(q[0]) && q[0] && safeHref(q[1]); }).map(function (q) { return [q[0], q[1]]; });
      if (d.length) mentions.push({ n: g.n, d: d });
    });
    if (!tabs.length && !mentions.length) return null;
    return { s: isText(data.s) ? data.s : '', tabs: tabs, mentions: mentions };
  }

  // ---- the tree's lines ----
  // Where the lines of a tree run, from the boxes its parts were measured at (in the
  // container's own coordinates). No line enters a box of text: each kind of line has a
  // channel of its own that no text is set in.
  //   subject  the subject's name          { left, right, top, bottom }
  //   heads    each group's heading cell   [{ left, right, top, bottom, count }]
  //   marks    each name's mark, in order  [{ left, top, bottom, o }]
  // Wide: the subject's dot is at the right of its name; a curve runs from it to the left
  // edge of the headings' column and then level, under the heading (which is set in the top
  // half of its cell), to the group's dot at the right of that column; a curve runs from
  // there to each name's mark across the gap between the two columns.
  // Narrow: a trunk down the left edge, an arm to each heading's dot, a spine down from
  // that dot past the group's names, and a short arm from the spine to each mark.
  // A name's own line carries its tone; a line shared by a group carries none.
  function treeLines(subject, heads, marks, narrow) {
    var paths = [];
    var dots = [];
    var f = function (v) { return Math.round(v * 10) / 10; };
    var mid = function (b) { return (b.top + b.bottom) / 2; };
    var first = 0;
    var rootX = narrow ? subject.left + 10 : subject.right + 14;
    var rootY = mid(subject);
    var column = Infinity;
    heads.forEach(function (h) { column = Math.min(column, h.left); });
    if (narrow && heads.length) {
      paths.push({ d: 'M' + f(rootX) + ' ' + f(rootY) + 'V' + f(mid(heads[heads.length - 1])), tone: null, kind: 'trunk' });
    }
    heads.forEach(function (h) {
      var y = mid(h);
      var x = narrow ? h.left - 10 : h.right + 12;
      if (narrow) {
        paths.push({ d: 'M' + f(rootX) + ' ' + f(y) + 'H' + f(x), tone: null, kind: 'trunk' });
        if (h.count) paths.push({ d: 'M' + f(x) + ' ' + f(y) + 'V' + f(mid(marks[first + h.count - 1])), tone: null, kind: 'trunk' });
      } else {
        var end = column - 6;
        var bend = (rootX + end) / 2;
        paths.push({ d: 'M' + f(rootX) + ' ' + f(rootY) + 'C' + f(bend) + ' ' + f(rootY) + ' ' + f(bend) + ' ' + f(y) + ' ' + f(end) + ' ' + f(y) + 'H' + f(x), tone: null, kind: 'trunk' });
      }
      dots.push({ x: x, y: y, r: narrow ? 4 : 5, kind: 'branch' });
      for (var k = 0; k < h.count; k++) {
        var mark = marks[first + k];
        var my = mid(mark);
        var mx = mark.left - 3;
        var d;
        if (narrow) {
          d = 'M' + f(x) + ' ' + f(my) + 'H' + f(mx);
        } else {
          var m = (x + mx) / 2;
          d = 'M' + f(x) + ' ' + f(y) + 'C' + f(m) + ' ' + f(y) + ' ' + f(m) + ' ' + f(my) + ' ' + f(mx) + ' ' + f(my);
        }
        paths.push({ d: d, tone: mark.o || null, kind: 'leaf' });
      }
      first += h.count;
    });
    dots.push({ x: rootX, y: rootY, r: 7, kind: 'root' });
    return { paths: paths, dots: dots };
  }

  // ---- colours ----
  // A colour as [r, g, b, a] from what a browser reports for one, or null.
  function parseColour(s) {
    if (typeof s !== 'string') return null;
    s = s.trim();
    var m = /^rgba?\(([^)]+)\)$/i.exec(s);
    var scale = 1;
    if (!m) { m = /^color\(srgb\s+([^)]+)\)$/i.exec(s); scale = 255; }
    if (!m) return null;
    var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    var out = [];
    for (var i = 0; i < 3; i++) {
      var v = parseFloat(parts[i]);
      if (isNaN(v)) return null;
      out.push(Math.max(0, Math.min(255, v * scale)));
    }
    var alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (isNaN(alpha)) return null;
    if (/%$/.test(parts[3] || '')) alpha /= 100;
    out.push(Math.max(0, Math.min(1, alpha)));
    return out;
  }

  function luminance(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }

  function contrast(a, b) {
    var x = luminance(a);
    var y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // One colour laid over another, by the first one's alpha.
  function over(top, base) { return mix(base, top, top.length > 3 ? top[3] : 1); }

  // What an element is drawn on, from its own layer outward (`chain`: each ancestor's
  // background colour, null when unreadable, and its background image). A layer with an image
  // and less than full colour is paper painted by the image (a sheet skin's gradient): the
  // palette's own ground at that point (`paper`) stands for it, rather than the colour behind
  // the page, which in the dark scheme is dark.
  function groundOf(chain, paper) {
    var stack = [], base = [255, 255, 255];
    for (var i = 0; i < chain.length; i++) {
      var c = chain[i].color;
      if (!c) return null;
      if (c.length < 4) c = [c[0], c[1], c[2], 1];
      if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
      var image = chain[i].image;
      if (paper && image && image !== 'none') { base = paper.slice(0, 3); break; }
    }
    for (var j = stack.length - 1; j >= 0; j--) base = over(stack[j], base);
    return base;
  }

  // A colour that can be read on every one of the grounds: the colour itself when it reaches
  // `need` on each, else moved toward the text colour a tenth at a time until it does, and
  // the text colour when nothing on the way does. So it is never worse than the plain text.
  // It must clear the need by a hair (SPARE), so a browser's own rounding cannot undo it.
  var SPARE = 0.03;
  function ink(colour, text, grounds, need) {
    for (var i = 0; i < 10; i++) {
      var c = mix(colour, text, i / 10).map(Math.round);   // as it will be written, in whole numbers
      var ok = true;
      for (var g = 0; g < grounds.length; g++) if (contrast(c, grounds[g]) < need + SPARE) ok = false;
      if (ok) return c;
    }
    return [text[0], text[1], text[2]];
  }

  // The section's colours from a palette: p.text, p.muted, p.accent, p.success, p.danger
  // and p.grounds (what they are drawn on). Words need 4.5 to 1; marks and lines 3 to 1.
  function inks(p) {
    var g = p.grounds;
    return {
      muted: ink(p.muted, p.text, g, 4.5),
      accent: ink(p.accent, p.text, g, 4.5),
      'warm-ink': ink(p.success, p.text, g, 4.5),
      'hostile-ink': ink(p.danger, p.text, g, 4.5),
      warm: ink(p.success, p.text, g, 3),
      hostile: ink(p.danger, p.text, g, 3),
      trunk: ink(mix(p.muted, g[0], 0.3), p.text, g, 3)
    };
  }

  var api = {
    treatmentFor: treatmentFor, treeLayout: treeLayout, webLayout: webLayout, nextTab: nextTab,
    tapAction: tapAction, toneClass: toneClass, sessionsText: sessionsText, treeLines: treeLines, safeHref: safeHref,
    parseColour: parseColour, groundOf: groundOf, contrast: contrast, ink: ink, inks: inks, readable: readable
  };

  function init(doc, win) {
    var sections = doc.querySelectorAll ? doc.querySelectorAll('section.cx') : [];
    for (var n = 0; n < sections.length; n++) {
      try { enhance(doc, win, sections[n], n); } catch (e) { undo(sections[n]); }
    }
  }
  api.init = init;

  // A section that failed part-way goes back to the lists as built.
  function undo(section) {
    var app = section.querySelector('div.cx-app');
    if (app && app.parentNode) app.parentNode.removeChild(app);
    section.classList.remove('cx-live');
  }

  function enhance(doc, win, section, n) {
    var island = section.querySelector('script.cx-data');
    if (!island) return;
    var data;
    try { data = normalise(JSON.parse(island.textContent)); } catch (e) { return; }
    if (!data || (!data.tabs.length && !data.mentions.length)) return;
    var mode = section.getAttribute('data-cx-mode');

    function make(tag, cls, value, ns) {
      var e = ns ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
      if (cls) e.setAttribute('class', cls);
      if (value !== undefined && value !== null) e.textContent = String(value);
      return e;
    }
    function svg(tag, cls, attrs) {
      var e = make(tag, cls, undefined, true);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      return e;
    }
    function clear(e) { while (e.lastChild) e.removeChild(e.lastChild); }
    function withTone(cls, code) { var t = toneClass(code); return t ? cls + ' ' + t : cls; }

    // One entry per tab, Mentions last. A tab with names is drawn the first time it is shown.
    var entries = data.tabs.map(function (tab) {
      var flat = [];
      tab.g.forEach(function (g) { g.d.forEach(function (it, index) { flat.push({ group: g.n, item: it, index: index }); }); });
      return { id: tab.id, label: tab.n, count: flat.length, tab: tab, flat: flat };
    });
    if (data.mentions.length) {
      var links = 0;
      data.mentions.forEach(function (g) { links += g.d.length; });
      entries.push({ id: 'mentions', label: 'Mentions', count: links, mentions: data.mentions });
    }

    var app = make('div', 'cx-app');
    var tablist = make('div', 'cx-tabs');
    tablist.setAttribute('role', 'tablist');
    var heading = section.getAttribute('aria-labelledby');
    if (heading) tablist.setAttribute('aria-labelledby', heading);
    app.appendChild(tablist);

    var lastPointer = 'mouse';
    var anyTone = false;
    var current = 0;

    entries.forEach(function (entry, k) {
      entry.tabId = 'cx-' + n + '-tab-' + entry.id;
      entry.panelId = 'cx-' + n + '-panel-' + entry.id;
      var button = make('button', 'cx-tab');
      button.setAttribute('type', 'button');
      button.setAttribute('role', 'tab');
      button.setAttribute('id', entry.tabId);
      button.setAttribute('aria-controls', entry.panelId);
      button.setAttribute('aria-label', entry.label + ' ' + entry.count);
      button.appendChild(make('span', 'cx-tab-label', entry.label));
      button.appendChild(make('span', 'cx-n', entry.count));
      button.addEventListener('click', function () { show(k, false); });
      tablist.appendChild(button);
      entry.button = button;
      var panel = make('div', 'cx-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', entry.panelId);
      panel.setAttribute('aria-labelledby', entry.tabId);
      panel.setAttribute('hidden', '');
      app.appendChild(panel);
      entry.panel = panel;
      entry.drawn = false;
      entry.selected = -1;
      if (entry.flat) entry.flat.forEach(function (f) { if (f.item.o) anyTone = true; });
    });

    // The measured width of an element: 0 while it is hidden or not yet laid out. Nothing
    // that needs a width is drawn from a 0.
    function widthOf(el) {
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return r && r.width > 0 ? r.width : 0;
    }

    function show(k, focus) {
      current = k;
      entries.forEach(function (entry, i) {
        var on = i === k;
        entry.button.setAttribute('aria-selected', on ? 'true' : 'false');
        entry.button.setAttribute('tabindex', on ? '0' : '-1');
        if (on) entry.panel.removeAttribute('hidden');
        else entry.panel.setAttribute('hidden', '');
      });
      var entry = entries[k];
      if (entry.mentions && !entry.drawn) {
        entry.drawn = true;
        entry.panel.appendChild(mentionsView(entry));
      }
      refresh();
      reveal(entry.button);
      if (focus && entry.button.focus) entry.button.focus();
    }

    // The tab row scrolls sideways on a narrow screen: the chosen tab is brought into it,
    // and an edge that has more tabs beyond it fades (cx-more-start, cx-more-end).
    function reveal(button) {
      if (typeof button.offsetLeft !== 'number' || typeof tablist.clientWidth !== 'number') return;
      var left = button.offsetLeft;
      var right = left + button.offsetWidth;
      if (left < tablist.scrollLeft + 28) tablist.scrollLeft = Math.max(0, left - 28);
      else if (right > tablist.scrollLeft + tablist.clientWidth - 28) tablist.scrollLeft = right - tablist.clientWidth + 28;
      hint();
    }
    function hint() {
      var spare = tablist.scrollWidth - tablist.clientWidth;
      var at = tablist.scrollLeft;
      tablist.classList[at > 2 ? 'add' : 'remove']('cx-more-start');
      tablist.classList[at < spare - 2 ? 'add' : 'remove']('cx-more-end');
    }
    tablist.addEventListener('scroll', hint);

    tablist.addEventListener('keydown', function (e) {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault();
      show(nextTab(current, entries.length, e.key), true);
    });

    // ---- the line under a tree or a web ----

    function lineOf(item, i, text) {
      var line = make('p', 'cx-line');
      line.appendChild(make('span', 'cx-line-text', text));
      if (i >= item.f) line.appendChild(make('span', 'cx-from', ' from ' + item.t + '’s page'));
      return line;
    }

    function fillStrip(strip, flat) {
      clear(strip);
      var item = flat.item;
      if (item.i) {
        var img = make('img', 'cx-avatar cx-portrait');
        img.setAttribute('src', item.i);
        img.setAttribute('alt', '');
        strip.appendChild(img);
      } else {
        strip.appendChild(make('div', 'cx-avatar', initials(item.t)));
      }
      var name = make('p', 'cx-strip-name', item.t);
      if (item.k) name.appendChild(make('span', 'cx-kind', item.k));
      strip.appendChild(name);
      var rel = make('p', 'cx-strip-rel', flat.group);
      if (item.o) {
        rel.appendChild(make('span', 'cx-sep', ' · '));
        rel.appendChild(make('span', withTone('cx-tone', item.o), TONE_WORD[item.o]));
      }
      strip.appendChild(rel);
      item.l.forEach(function (text, i) { strip.appendChild(lineOf(item, i, text)); });
      var sess = sessionsText(item.s);
      if (sess) strip.appendChild(make('p', 'cx-sess', sess));
      if (item.h) {
        var open = make('a', 'cx-open', 'Open page');
        open.setAttribute('href', item.h);
        strip.appendChild(open);
      }
    }

    // Draw a tree or a web: the picture, then the strip, with the events that fill the strip.
    function interactive(entry, picture) {
      var strip = make('div', 'cx-strip');
      strip.setAttribute('aria-live', 'polite');
      var chosen = null;
      function choose(el) {
        if (chosen) chosen.classList.remove('cx-sel');
        chosen = el;
        el.classList.add('cx-sel');
        entry.selected = Number(el.getAttribute('data-cx-i'));
        fillStrip(strip, entry.flat[entry.selected]);
      }
      function rowOf(target) { return target && target.closest ? target.closest('[data-cx-i]') : null; }
      picture.addEventListener('pointerover', function (e) {
        if (e.pointerType === 'touch') return;
        var row = rowOf(e.target);
        if (row && row !== chosen) choose(row);
      });
      picture.addEventListener('focusin', function (e) {
        var row = rowOf(e.target);
        // A tap that focuses before it clicks must still need its second tap.
        if (row && row !== chosen && lastPointer !== 'touch') choose(row);
      });
      picture.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || 'mouse'; });
      picture.addEventListener('pointercancel', function () { lastPointer = 'mouse'; });
      picture.addEventListener('click', function (e) {
        var pointer = lastPointer;
        lastPointer = 'mouse';
        if (e.detail === 0) pointer = 'keyboard';
        var row = rowOf(e.target);
        if (!row || tapAction(chosen, row, pointer) !== 'select') return;
        e.preventDefault();
        choose(row);
      });
      entry.panel.appendChild(picture);
      entry.panel.appendChild(strip);
      if (entry.selected >= 0) {
        var again = picture.querySelectorAll('[data-cx-i]');
        for (var i = 0; i < again.length; i++) if (Number(again[i].getAttribute('data-cx-i')) === entry.selected) choose(again[i]);
      }
    }

    // ---- the tree ----
    // Rows are plain HTML in the page's flow, so a long name wraps and its row grows. The
    // lines are drawn afterwards (layoutTree) from where the rows and headings ended up.

    function treeView(entry) {
      var wrap = make('div', 'cx-tree-wrap cx-wide');
      var lines = svg('svg', 'cx-lines', { 'aria-hidden': 'true', focusable: 'false' });
      var subject = make('p', 'cx-subject', data.s);
      var list = make('ul', 'cx-tree');
      var heads = [];
      var marks = [];
      var flatIndex = 0;
      entry.tab.g.forEach(function (group, g) {
        var branch = make('li', 'cx-branch');
        var head = make('p', 'cx-group');
        var label = make('span', 'cx-label', group.n);
        head.appendChild(label);
        var headId = 'cx-' + n + '-' + entry.id + '-g' + g;
        head.setAttribute('id', headId);
        var leaves = make('ul', 'cx-leaves');
        leaves.setAttribute('aria-labelledby', headId);
        group.d.forEach(function (item) {
          var li = make('li', 'cx-item');
          var row = make(item.h ? 'a' : 'span', 'cx-row' + (item.h ? '' : ' cx-text'));
          if (item.h) row.setAttribute('href', item.h);
          else row.setAttribute('tabindex', '0');
          row.setAttribute('data-no-preview', '');
          row.setAttribute('data-cx-i', flatIndex);
          var mark = make('span', withTone('cx-mark', item.o));
          row.appendChild(mark);
          row.appendChild(make('span', 'cx-name', item.t));
          var meta = [item.k, countText(item.s)].filter(Boolean).join(' · ');
          if (meta) row.appendChild(make('span', 'cx-meta', meta));
          li.appendChild(row);
          leaves.appendChild(li);
          marks.push({ el: mark, o: item.o });
          flatIndex++;
        });
        branch.appendChild(head);
        branch.appendChild(leaves);
        list.appendChild(branch);
        heads.push({ el: head, label: label, count: group.d.length });
      });
      wrap.appendChild(lines);
      wrap.appendChild(subject);
      wrap.appendChild(list);
      entry.tree = { wrap: wrap, lines: lines, subject: subject, heads: heads, marks: marks, shape: '', sig: '' };
      return wrap;
    }

    // Wide or narrow from the container's own width, then the lines from where the parts
    // landed. Does nothing while the container has no width (a hidden tab).
    function layoutTree(entry) {
      var t = entry.tree;
      if (!t) return;
      var box = t.wrap.getBoundingClientRect();
      if (!(box.width > 0)) return;
      var narrow = box.width < NARROW;
      var shape = narrow ? 'cx-narrow' : box.width < ROOMY ? 'cx-wide' : 'cx-wide cx-roomy';
      if (shape !== t.shape) {
        t.shape = shape;
        t.wrap.setAttribute('class', 'cx-tree-wrap ' + shape);
        box = t.wrap.getBoundingClientRect();
        if (!(box.width > 0)) return;
      }
      var sig = [Math.round(box.width), Math.round(box.height), shape].join('/');
      if (sig === t.sig) return;
      t.sig = sig;
      var at = function (el) {
        var r = el.getBoundingClientRect();
        return { left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top };
      };
      var heads = t.heads.map(function (h) { var b = at(h.el); b.count = h.count; return b; });
      var marks = t.marks.map(function (m) { var b = at(m.el); b.o = m.o; return b; });
      var geo = treeLines(at(t.subject), heads, marks, narrow);
      var w = Math.round(box.width);
      var h = Math.round(box.height);
      clear(t.lines);
      t.lines.setAttribute('width', w);
      t.lines.setAttribute('height', h);
      t.lines.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      geo.paths.forEach(function (p) {
        t.lines.appendChild(svg('path', 'cx-edge' + (p.kind === 'trunk' ? ' cx-trunk' : p.tone ? ' ' + toneClass(p.tone) : ''), { d: p.d }));
      });
      geo.dots.forEach(function (d) {
        t.lines.appendChild(svg('circle', 'cx-dot cx-' + d.kind + '-dot', { cx: d.x, cy: d.y, r: d.r }));
      });
    }

    // ---- the web ----

    // The width of a text as the page will draw it, from a hidden drawing with the web's own
    // type; an estimate where that cannot be had.
    var ruler = null;
    function measure(text, kind) {
      var guess = estimate(text, kind);
      if (!ruler) {
        var scratch = svg('svg', 'cx-ruler', { 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0 });
        ruler = svg('text', 'cx-name');
        scratch.appendChild(ruler);
        app.appendChild(scratch);
      }
      if (typeof ruler.getComputedTextLength !== 'function') return guess;
      ruler.setAttribute('class', kind === 'band' ? 'cx-band' : kind === 'root' ? 'cx-root' : 'cx-name');
      ruler.textContent = text;
      var w = ruler.getComputedTextLength();
      return w > 0 ? w + 1 : guess;
    }

    // A tone's mark in the web: the same three shapes as everywhere else.
    function webMark(item, x, y, k) {
      if (item.o === 'h') {
        var d = 7.5 * k;
        return svg('path', 'cx-mark cx-hostile', { d: 'M' + x + ' ' + (y - d) + 'L' + (x + d) + ' ' + y + 'L' + x + ' ' + (y + d) + 'L' + (x - d) + ' ' + y + 'Z' });
      }
      return svg('circle', withTone('cx-mark', item.o), { cx: x, cy: y, r: (item.o === 'w' ? 6 : 5) * k });
    }

    // The web's layout for a column, worked out once per kind (and again when a font arrives).
    // A wide column takes it as it comes. A narrow one takes the first that can still be read
    // when shrunk to fit: names at full length, or names and labels cut short on a small
    // ring; when neither can, there is no web for this width (null) and the tree is drawn.
    function webPlan(entry, width) {
      var plans = entry.plans || (entry.plans = {});
      function plan(key, opts) {
        if (!plans[key]) {
          opts.subject = data.s;
          opts.measure = measure;
          plans[key] = webLayout(entry.tab.g, opts);
          plans[key].key = key;
        }
        return plans[key];
      }
      if (width >= NARROW) return plan('wide', {});
      var full = plan('full', { compact: true });
      if (readable(full.box.w, width)) return full;
      var short = plan('short', { compact: true, clip: 14, clipLabel: 14 });
      return readable(short.box.w, width) ? short : null;
    }

    function webView(entry, lay) {
      var narrow = lay.key !== 'wide';
      var k = narrow ? SMALL : 1;
      var box = lay.box;
      var f = function (v) { return Math.round(v * 100) / 100; };
      var root = svg('svg', narrow ? 'cx-web cx-small' : 'cx-web', { viewBox: box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h, width: box.w, height: box.h, role: 'group', 'aria-label': 'Web of ' + entry.label });
      root.setAttribute('data-no-preview', '');
      var edges = svg('g', 'cx-edges', { 'aria-hidden': 'true' });
      var bandLayer = svg('g', 'cx-bands', { 'aria-hidden': 'true' });
      var nodes = svg('g', 'cx-nodes');
      function pt(r, a) { return [f(r * Math.sin(a)), f(-r * Math.cos(a))]; }
      function arc(r, from, to, back) {
        var a = pt(r, back ? to : from);
        var b = pt(r, back ? from : to);
        return 'M' + a[0] + ' ' + a[1] + 'A' + r + ' ' + r + ' 0 ' + (to - from > Math.PI ? 1 : 0) + ' ' + (back ? 0 : 1) + ' ' + b[0] + ' ' + b[1];
      }

      lay.bands.forEach(function (band, g) {
        var inner = pt(lay.root.r, band.from);
        var outer = pt(lay.spine, band.from);
        edges.appendChild(svg('line', 'cx-edge cx-trunk', { x1: inner[0], y1: inner[1], x2: outer[0], y2: outer[1] }));
        if (band.to > band.from) edges.appendChild(svg('path', 'cx-edge cx-trunk', { d: arc(lay.spine, band.from, band.to, false) }));
        edges.appendChild(svg('circle', 'cx-dot cx-branch-dot', { cx: outer[0], cy: outer[1], r: 3 }));
        // The label runs along its own arc; under the middle it is turned to read the right way up.
        var id = 'cx-' + n + '-' + entry.id + '-band' + g;
        var r = lay.labelRadius + (band.flip ? WEB.labelHigh : 0);
        bandLayer.appendChild(svg('path', 'cx-band-path', { id: id, fill: 'none', d: arc(r, band.labelFrom, band.labelTo, band.flip) }));
        var text = svg('text', 'cx-band');
        var along = svg('textPath', null, { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' });
        along.textContent = band.label;
        text.appendChild(along);
        bandLayer.appendChild(text);
      });

      lay.nodes.forEach(function (node, i) {
        var flat = entry.flat[i];
        var item = flat.item;
        var x = f(node.x);
        var y = f(node.y);
        var from = pt(lay.spine, node.angle);
        edges.appendChild(svg('line', withTone('cx-edge', item.o), { x1: from[0], y1: from[1], x2: x, y2: y }));
        var g = item.h ? svg('a', 'cx-node', { href: item.h }) : svg('g', 'cx-node cx-text', { tabindex: '0', role: 'img' });
        g.setAttribute('data-cx-i', i);
        g.setAttribute('data-no-preview', '');
        g.setAttribute('aria-label', item.t + ', ' + flat.group + (item.o ? ', ' + TONE_WORD[item.o] : ''));
        g.appendChild(svg('circle', 'cx-hit', { cx: x, cy: y, r: 14 }));
        g.appendChild(svg('circle', 'cx-ring', { cx: x, cy: y, r: 11.5 * k }));
        g.appendChild(webMark(item, x, y, k));
        var label = svg('text', 'cx-name', { x: f(node.tx), y: f(node.ty), dy: 4.5, 'text-anchor': node.right ? 'start' : 'end',
          transform: 'rotate(' + f(node.turn) + ' ' + f(node.tx) + ' ' + f(node.ty) + ')' });
        label.textContent = node.text;
        g.appendChild(label);
        nodes.appendChild(g);
      });

      root.appendChild(edges);
      root.appendChild(bandLayer);
      root.appendChild(svg('circle', 'cx-dot cx-root-dot', { cx: 0, cy: 0, r: lay.root.r }));
      lay.root.lines.forEach(function (line) {
        var centre = svg('text', 'cx-root', { x: 0, y: f(line.y), dy: 5, 'text-anchor': 'middle' });
        centre.textContent = line.text;
        root.appendChild(centre);
      });
      root.appendChild(nodes);
      return root;
    }

    // ---- cards ----

    function cardsView(entry) {
      var wrap = make('div', 'cx-cards');
      entry.tab.g.forEach(function (group) {
        wrap.appendChild(make('h4', 'cx-group', group.n));
        var grid = make('div', 'cx-grid');
        group.d.forEach(function (item) {
          var card = make('div', 'cx-card');
          if (item.i) {
            var img = make('img', 'cx-avatar cx-portrait');
            img.setAttribute('src', item.i);
            img.setAttribute('alt', '');
            img.setAttribute('loading', 'lazy');
            card.appendChild(img);
          } else {
            card.appendChild(make('div', 'cx-avatar', initials(item.t)));
          }
          var name = make('p', 'cx-card-name');
          var title = make(item.h ? 'a' : 'span', 'cx-name', item.t);
          if (item.h) title.setAttribute('href', item.h);
          name.appendChild(title);
          if (item.k) name.appendChild(make('span', 'cx-kind', item.k));
          card.appendChild(name);
          if (item.o) {
            var tone = make('p', 'cx-card-tone');
            tone.appendChild(make('span', withTone('cx-mark', item.o)));
            tone.appendChild(make('span', withTone('cx-tone', item.o), TONE_WORD[item.o]));
            card.appendChild(tone);
          }
          item.l.forEach(function (text, i) { card.appendChild(lineOf(item, i, text)); });
          var sess = sessionsText(item.s);
          if (sess) card.appendChild(make('p', 'cx-sess', sess));
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
      });
      return wrap;
    }

    function mentionsView(entry) {
      var wrap = make('div', 'cx-mentions-wrap');
      entry.mentions.forEach(function (group) {
        wrap.appendChild(make('h4', 'cx-group', group.n));
        var list = make('ul', 'cx-mlist');
        group.d.forEach(function (p) {
          var li = make('li', 'cx-mention');
          var a = make('a', null, p[0]);
          a.setAttribute('href', p[1]);
          li.appendChild(a);
          list.appendChild(li);
        });
        wrap.appendChild(list);
      });
      return wrap;
    }

    // Draw the open tab for the width it has now, and lay out a tree's lines. Called when a
    // tab is shown and whenever a container's size changes. The treatment comes from the
    // measured width; a tab that is hidden, or not yet laid out, is drawn when it has one.
    function refresh() {
      var entry = entries[current];
      if (!entry || entry.mentions) return;
      var width = widthOf(app);
      if (width <= 0 && mode !== 'cards') return;
      hint();
      var how = treatmentFor(mode, entry.count, width);
      var plan = how === 'web' ? webPlan(entry, width) : null;
      if (how === 'web' && !plan) how = 'tree';
      if (!entry.drawn || entry.how !== how || entry.plan !== plan) build(entry, how, plan);
      if (entry.how === 'tree') layoutTree(entry);
    }

    function build(entry, how, plan) {
      if (entry.tree && observer) observer.unobserve(entry.tree.wrap);
      entry.tree = null;
      clear(entry.panel);
      entry.drawn = true;
      entry.how = how;
      entry.plan = plan;
      if (how === 'cards') entry.panel.appendChild(cardsView(entry));
      else if (how === 'web') interactive(entry, webView(entry, plan));
      else {
        interactive(entry, treeView(entry));
        if (observer) observer.observe(entry.tree.wrap);
      }
    }

    if (anyTone) {
      var key = make('p', 'cx-key');
      ['w', 'h', 'n'].forEach(function (code) {
        var item = make('span', 'cx-key-item');
        item.appendChild(make('span', withTone('cx-mark', code)));
        item.appendChild(make('span', 'cx-key-word', TONE_WORD[code]));
        key.appendChild(item);
      });
      app.appendChild(key);
    }

    // ---- the section's colours ----
    // The stylesheet draws everything in the plain text colour. Here the palette's own
    // muted, accent, success and danger colours are read as the page resolves them, each is
    // checked against what it is drawn on (inks), and the ones that can be read are handed
    // to the stylesheet as --cxi-* (on the page) and --cxc-* (on a card or the strip, which
    // a sheet skin gives inks of their own). A colour that cannot be read is left out, and
    // the stylesheet falls back to the text colour.
    var probes = null;
    function colourAt(el, value) {
      el.style.color = value;
      return parseColour(win.getComputedStyle(el).color);
    }
    function groundBehind(el) {
      var chain = [];
      for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
        var cs = win.getComputedStyle(e);
        chain.push({ color: parseColour(cs.backgroundColor), image: cs.backgroundImage });
      }
      return groundOf(chain, colourAt(el, 'var(--bg)'));
    }
    function css(c) { return 'rgb(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ')'; }
    function paintScope(prefix, probe, card) {
      var names = ['muted', 'accent', 'warm-ink', 'hostile-ink', 'warm', 'hostile', 'trunk', 'ground', 'hover'];
      names.forEach(function (name) { section.style.removeProperty('--cx' + prefix + '-' + name); });
      var ground = groundBehind(probe);
      if (!ground) return;
      var p = { grounds: [ground] };
      var raw = { text: 'var(--text)', muted: 'var(--text-muted)', accent: 'var(--accent)', success: 'var(--success)', danger: 'var(--danger)' };
      for (var key in raw) {
        if (!has(raw, key)) continue;
        var c = colourAt(probe, raw[key]);
        if (!c) return;
        p[key] = over(c, ground);
      }
      // What else the words sit on: a card's portrait disc, or a row under the pointer.
      var other = colourAt(probe, card ? 'var(--bg)' : 'var(--accent-dim)');
      var second = other ? over(other, ground).map(Math.round) : null;   // as it will be painted
      if (second && (card || contrast(p.text, second) >= 4.5)) p.grounds.push(second);
      else second = null;
      var out = inks(p);
      for (var name in out) if (has(out, name)) section.style.setProperty('--cx' + prefix + '-' + name, css(out[name]));
      section.style.setProperty('--cx' + prefix + '-ground', css(ground));
      if (second && !card) section.style.setProperty('--cx' + prefix + '-hover', css(second));
    }
    function paint() {
      if (typeof win.getComputedStyle !== 'function' || !section.style || typeof section.style.setProperty !== 'function') return;
      if (!probes) {
        probes = [make('span', 'cx-probe'), make('span', 'cx-probe cx-strip')];
        probes.forEach(function (probe) { probe.setAttribute('aria-hidden', 'true'); app.appendChild(probe); });
      }
      try {
        paintScope('i', probes[0], false);
        paintScope('c', probes[1], true);
      } catch (e) { /* the stylesheet's own colours stand */ }
    }

    // Live before anything is measured, so the plain lists are already out of the way.
    section.appendChild(app);
    paint();
    section.classList.add('cx-live');
    // The light and dark switch, and a change of the reader's own scheme, change the palette.
    if (typeof win.MutationObserver === 'function' && doc.documentElement) {
      new win.MutationObserver(paint).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    }
    if (typeof win.matchMedia === 'function') {
      var scheme = win.matchMedia('(prefers-color-scheme: dark)');
      if (scheme && scheme.addEventListener) scheme.addEventListener('change', paint);
    }
    // A font that arrives after the first drawing changes what every text measures.
    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
      doc.fonts.ready.then(function () {
        entries.forEach(function (entry) {
          entry.plans = null;
          if (entry.how === 'web') entry.how = '';
          if (entry.tree) entry.tree.sig = '';
        });
        refresh();
      });
    }

    // A size change (a tab that was hidden opening, a window resize, a font arriving) draws
    // or lays out again. Without ResizeObserver the window's resize stands in.
    var observer = null;
    if (typeof win.ResizeObserver === 'function') {
      observer = new win.ResizeObserver(function () { refresh(); });
      observer.observe(app);
    } else {
      var timer = 0;
      win.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(refresh, 120);
      });
    }
    show(0, false);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined') init(document, window);
})();
