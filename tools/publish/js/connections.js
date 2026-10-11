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
  var WEB_SIZE = 720;

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

  // Names on one ring, in group order, one empty slot between groups. Angles run clockwise
  // from the top; a band is the arc its group covers.
  function webLayout(groups, size) {
    var total = 0;
    groups.forEach(function (g) { total += g.d.length; });
    var slots = total + (groups.length > 1 ? groups.length : 0);
    var step = slots ? (2 * Math.PI) / slots : 0;
    var c = size / 2;
    var radius = size * 0.208;
    var nodes = [];
    var bands = [];
    var slot = 0;
    groups.forEach(function (group, g) {
      var from = slot * step;
      group.d.forEach(function (item, index) {
        var angle = (slot + 0.5) * step;
        nodes.push({ group: g, index: index, angle: angle, x: c + radius * Math.sin(angle), y: c - radius * Math.cos(angle) });
        slot++;
      });
      bands.push({ label: group.n, from: from, to: slot * step });
      if (groups.length > 1) slot++;
    });
    return { nodes: nodes, bands: bands, center: c, radius: radius };
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

  // The lines of a tree from where the rows and group headings were measured (centres, in
  // the container's own coordinates), so a row of any height has a line that meets it.
  //   rows      [{ x, y, o }]            the mark of each name, in order: the line ends at x, y
  //   branches  [{ x, y, first, count }] each group's dot, and which rows are its own
  //   g         { narrow, rootX, rootY } the subject's dot
  // Wide: a curve from the subject to each group, then to each name. Narrow: an indented
  // trunk with an elbow to each name.
  function treeLines(rows, branches, g) {
    var paths = [];
    var dots = [{ x: g.rootX, y: g.rootY, r: g.narrow ? 7 : 9, kind: 'root' }];
    var f = function (v) { return Math.round(v * 10) / 10; };
    if (g.narrow && branches.length) {
      paths.push({ d: 'M' + f(g.rootX) + ' ' + f(g.rootY) + 'V' + f(branches[branches.length - 1].y), tone: null, kind: 'trunk' });
    }
    branches.forEach(function (b) {
      if (g.narrow) {
        paths.push({ d: 'M' + f(g.rootX) + ' ' + f(b.y) + 'H' + f(b.x), tone: null, kind: 'trunk' });
      } else {
        var mx = (g.rootX + b.x) / 2;
        paths.push({ d: 'M' + f(g.rootX) + ' ' + f(g.rootY) + 'C' + f(mx) + ' ' + f(g.rootY) + ' ' + f(mx) + ' ' + f(b.y) + ' ' + f(b.x) + ' ' + f(b.y), tone: null, kind: 'trunk' });
      }
      dots.push({ x: b.x, y: b.y, r: g.narrow ? 4 : 5, kind: 'branch' });
      for (var k = 0; k < b.count; k++) {
        var row = rows[b.first + k];
        var d;
        if (g.narrow) {
          d = 'M' + f(b.x) + ' ' + f(k ? rows[b.first + k - 1].y : b.y) + 'V' + f(row.y) + 'H' + f(row.x);
        } else {
          var m = (b.x + row.x) / 2;
          d = 'M' + f(b.x) + ' ' + f(b.y) + 'C' + f(m) + ' ' + f(b.y) + ' ' + f(m) + ' ' + f(row.y) + ' ' + f(row.x) + ' ' + f(row.y);
        }
        paths.push({ d: d, tone: row.o || null, kind: 'leaf' });
      }
    });
    return { paths: paths, dots: dots };
  }

  var api = {
    treatmentFor: treatmentFor, treeLayout: treeLayout, webLayout: webLayout, nextTab: nextTab,
    tapAction: tapAction, toneClass: toneClass, sessionsText: sessionsText, treeLines: treeLines, safeHref: safeHref
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
      if (focus && entry.button.focus) entry.button.focus();
    }

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
        var head = make('p', 'cx-group', group.n);
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
        heads.push({ el: head, count: group.d.length });
      });
      wrap.appendChild(lines);
      wrap.appendChild(subject);
      wrap.appendChild(list);
      entry.tree = { wrap: wrap, lines: lines, subject: subject, heads: heads, marks: marks, narrow: null, sig: '' };
      return wrap;
    }

    // Wide or narrow from the container's own width, then the lines from the measured
    // centres. Does nothing while the container has no width (a hidden tab).
    function layoutTree(entry) {
      var t = entry.tree;
      if (!t) return;
      var box = t.wrap.getBoundingClientRect();
      if (!(box.width > 0)) return;
      var narrow = box.width < NARROW;
      if (narrow !== t.narrow) {
        t.narrow = narrow;
        t.wrap.setAttribute('class', 'cx-tree-wrap ' + (narrow ? 'cx-narrow' : 'cx-wide'));
        box = t.wrap.getBoundingClientRect();
        if (!(box.width > 0)) return;
      }
      var sig = [Math.round(box.width), Math.round(box.height), narrow].join('/');
      if (sig === t.sig) return;
      t.sig = sig;
      var at = function (el) {
        var r = el.getBoundingClientRect();
        return { left: r.left - box.left, right: r.right - box.left, x: (r.left + r.right) / 2 - box.left, y: (r.top + r.bottom) / 2 - box.top };
      };
      var subject = at(t.subject);
      var rows = t.marks.map(function (m) { var c = at(m.el); return { x: c.left - 4, y: c.y, o: m.o }; });
      var first = 0;
      var branches = t.heads.map(function (h) {
        var c = at(h.el);
        var b = { x: narrow ? c.left - 10 : c.right + 10, y: c.y, first: first, count: h.count };
        first += h.count;
        return b;
      });
      var geo = treeLines(rows, branches, { narrow: narrow, rootX: Math.max(7, subject.left - 14), rootY: subject.y });
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

    function webView(entry) {
      var S = WEB_SIZE;
      var lay = webLayout(entry.tab.g, S);
      var c = lay.center;
      var R = lay.radius;
      var root = svg('svg', 'cx-web', { viewBox: '0 0 ' + S + ' ' + S, role: 'group', 'aria-label': 'Web of ' + entry.label });
      root.setAttribute('data-no-preview', '');
      var edges = svg('g', 'cx-edges', { 'aria-hidden': 'true' });
      var bandLayer = svg('g', 'cx-bands', { 'aria-hidden': 'true' });
      var nodes = svg('g', 'cx-nodes');
      function pt(r, a) { return [c + r * Math.sin(a), c - r * Math.cos(a)]; }

      lay.nodes.forEach(function (node, i) {
        var flat = entry.flat[i];
        var item = flat.item;
        edges.appendChild(svg('line', withTone('cx-edge', item.o), { x1: c, y1: c, x2: node.x, y2: node.y }));
        var g = item.h ? svg('a', 'cx-node', { href: item.h }) : svg('g', 'cx-node cx-text', { tabindex: '0', role: 'img' });
        g.setAttribute('data-cx-i', i);
        g.setAttribute('aria-label', item.t + ', ' + flat.group + (item.o ? ', ' + TONE_WORD[item.o] : ''));
        g.appendChild(svg('circle', withTone('cx-dot cx-mark', item.o), { cx: node.x, cy: node.y, r: 6 }));
        var deg = (node.angle * 180) / Math.PI;
        var right = deg % 360 < 180;
        var t = pt(R + 12, node.angle);
        var label = svg('text', 'cx-name', { x: t[0], y: t[1], dy: 4, 'text-anchor': right ? 'start' : 'end',
          transform: 'rotate(' + (right ? deg - 90 : deg + 90) + ' ' + t[0] + ' ' + t[1] + ')' });
        label.textContent = clip(item.t, 26);
        g.appendChild(label);
        nodes.appendChild(g);
      });

      lay.bands.forEach(function (band, g) {
        var span = band.to - band.from;
        var mid = band.from + span / 2;
        var la = Math.min(span, 2 * Math.PI * 0.8) / 2 - 0.02;
        var bottom = Math.cos(mid) < -0.2;
        var r = R - 22 + (bottom ? 9 : 0);
        var a = pt(r, bottom ? mid + la : mid - la);
        var b = pt(r, bottom ? mid - la : mid + la);
        var id = 'cx-' + n + '-' + entry.id + '-band' + g;
        bandLayer.appendChild(svg('path', 'cx-band-path', { id: id, fill: 'none',
          d: 'M' + a[0] + ' ' + a[1] + 'A' + r + ' ' + r + ' 0 ' + (la * 2 > Math.PI ? 1 : 0) + ' ' + (bottom ? 0 : 1) + ' ' + b[0] + ' ' + b[1] }));
        var text = svg('text', 'cx-band');
        var along = svg('textPath', null, { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' });
        along.textContent = band.label;
        text.appendChild(along);
        bandLayer.appendChild(text);
      });

      root.appendChild(edges);
      root.appendChild(svg('circle', 'cx-hub', { cx: c, cy: c, r: R - 34, 'aria-hidden': 'true' }));
      root.appendChild(bandLayer);
      root.appendChild(svg('circle', 'cx-dot cx-root-dot', { cx: c, cy: c, r: 34 }));
      var centre = svg('text', 'cx-root', { x: c, y: c + 6, 'text-anchor': 'middle', 'font-size': 16 });
      centre.textContent = clip(data.s.split(/\s+/)[0] || data.s, 11);
      root.appendChild(centre);
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
      var how = treatmentFor(mode, entry.count, width);
      if (!entry.drawn || entry.how !== how) build(entry, how);
      if (entry.how === 'tree') layoutTree(entry);
    }

    function build(entry, how) {
      if (entry.tree && observer) observer.unobserve(entry.tree.wrap);
      entry.tree = null;
      clear(entry.panel);
      entry.drawn = true;
      entry.how = how;
      if (how === 'cards') entry.panel.appendChild(cardsView(entry));
      else if (how === 'web') interactive(entry, webView(entry));
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

    // Live before anything is measured, so the plain lists are already out of the way.
    section.appendChild(app);
    section.classList.add('cx-live');

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
