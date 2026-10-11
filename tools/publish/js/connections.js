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

  // Rows and branch points for the tree. A row's y is its centre. Wide: one trunk from the
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

  function safeHref(h) {
    if (typeof h !== 'string' || !h) return null;
    return /^\s*(javascript|data|vbscript):/i.test(h) ? null : h;
  }

  // The island as the script uses it, or null when it is not the shape the build writes.
  function normalise(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.t)) return null;
    var tabs = [];
    data.t.forEach(function (tab) {
      if (!tab || typeof tab !== 'object' || !Array.isArray(tab.g)) return;
      var groups = tab.g.filter(function (g) { return g && Array.isArray(g.d); }).map(function (g) {
        return { n: String(g.n), d: g.d.filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
          return {
            t: String(it.t), h: safeHref(it.h), k: it.k ? String(it.k) : '',
            o: has(TONE_CLASS, it.o) ? it.o : null,
            l: Array.isArray(it.l) ? it.l.map(String) : [],
            f: typeof it.f === 'number' ? it.f : 0,
            s: Array.isArray(it.s) ? it.s : null, i: safeHref(it.i)
          };
        }) };
      }).filter(function (g) { return g.d.length; });
      if (groups.length) tabs.push({ id: String(tab.id), n: String(tab.n), g: groups });
    });
    var mentions = (Array.isArray(data.m) ? data.m : []).filter(function (g) { return g && Array.isArray(g.d); }).map(function (g) {
      return { n: String(g.n), d: g.d.filter(function (p) { return Array.isArray(p) && safeHref(p[1]); }).map(function (p) { return [String(p[0]), p[1]]; }) };
    }).filter(function (g) { return g.d.length; });
    return { s: String(data.s || ''), tabs: tabs, mentions: mentions };
  }

  var api = {
    treatmentFor: treatmentFor, treeLayout: treeLayout, webLayout: webLayout, nextTab: nextTab,
    tapAction: tapAction, toneClass: toneClass, sessionsText: sessionsText
  };

  function init(doc, win) {
    var sections = doc.querySelectorAll ? doc.querySelectorAll('section.cx') : [];
    for (var n = 0; n < sections.length; n++) {
      try { enhance(doc, win, sections[n], n); } catch (e) { /* leave the lists as built */ }
    }
  }
  api.init = init;

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

    function panelWidth() {
      var r = app.getBoundingClientRect ? app.getBoundingClientRect() : null;
      var w = r && r.width ? Math.floor(r.width) : 0;
      return w || Math.floor(win.innerWidth || 0) || 340;
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
      if (!entry.drawn) draw(entry);
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

    function treeView(entry, width) {
      var lay = treeLayout(entry.tab.g, width);
      var wrap = make('div', 'cx-tree-wrap ' + (lay.narrow ? 'cx-narrow' : 'cx-wide'));
      wrap.style.position = 'relative';
      wrap.style.height = lay.height + 'px';
      var lines = svg('svg', 'cx-lines', { viewBox: '0 0 ' + width + ' ' + lay.height, width: width, height: lay.height, 'aria-hidden': 'true', focusable: 'false' });
      lines.style.position = 'absolute';
      lines.style.left = '0';
      lines.style.top = '0';
      lines.style.pointerEvents = 'none';
      var list = make('ul', 'cx-tree');
      var rx = lay.root.x;
      var ry = lay.root.y;
      var bx = lay.trunkX;
      var lx = lay.leafX;
      var rowAt = lay.rows;

      function place(li, left, top, w, h) {
        li.style.position = 'absolute';
        li.style.left = left + 'px';
        li.style.top = top + 'px';
        li.style.width = w + 'px';
        li.style.height = h + 'px';
      }
      function edge(d, tone) { lines.appendChild(svg('path', withTone('cx-edge', tone), { d: d })); }
      function trunk(d) { lines.appendChild(svg('path', 'cx-edge cx-trunk', { d: d })); }

      var subject = make('li', 'cx-subject', data.s);
      if (lay.narrow) place(subject, rx + 14, 4, width - rx - 14, 24);
      else place(subject, 0, ry - 42, Math.max(0, bx - 12), 24);
      list.appendChild(subject);

      if (lay.narrow && lay.branches.length) {
        trunk('M' + rx + ' 23V' + lay.branches[lay.branches.length - 1].y);
      }
      lay.branches.forEach(function (b, g) {
        var group = entry.tab.g[g];
        var head = make('li', 'cx-group', b.label);
        if (lay.narrow) {
          place(head, bx + 10, b.y - 10, width - bx - 10, 20);
          trunk('M' + rx + ' ' + b.y + 'H' + bx);
        } else {
          place(head, 0, b.y - 26, Math.max(0, bx - 12), 20);
          trunk('M' + rx + ' ' + ry + 'C' + (bx * 0.55) + ' ' + ry + ' ' + (bx * 0.55) + ' ' + b.y + ' ' + bx + ' ' + b.y);
        }
        lines.appendChild(svg('circle', 'cx-dot cx-branch-dot', { cx: bx, cy: b.y, r: lay.narrow ? 4 : 5 }));
        list.appendChild(head);
        group.d.forEach(function (item, k) {
          var flatIndex = b.first + k;
          var y = rowAt[flatIndex].y;
          var li = make('li', 'cx-item');
          place(li, lx - 5, y - ROW / 2, width - lx + 5, ROW);
          var row = make(item.h ? 'a' : 'span', 'cx-row' + (item.h ? '' : ' cx-text'));
          if (item.h) row.setAttribute('href', item.h);
          else row.setAttribute('tabindex', '0');
          row.setAttribute('data-no-preview', '');
          row.setAttribute('data-cx-i', flatIndex);
          row.appendChild(make('span', withTone('cx-mark', item.o)));
          row.appendChild(make('span', 'cx-name', item.t));
          if (!lay.narrow) {
            var meta = [item.k, countText(item.s)].filter(Boolean).join(' · ');
            if (meta) row.appendChild(make('span', 'cx-meta', meta));
          }
          li.appendChild(row);
          list.appendChild(li);
          if (lay.narrow) {
            edge('M' + bx + ' ' + (k ? rowAt[flatIndex - 1].y : b.y + 4) + 'V' + y + 'H' + (lx - 8), item.o);
          } else {
            var mx = (bx + lx) / 2;
            edge('M' + bx + ' ' + b.y + 'C' + mx + ' ' + b.y + ' ' + mx + ' ' + y + ' ' + lx + ' ' + y, item.o);
          }
        });
      });
      lines.appendChild(svg('circle', 'cx-dot cx-root-dot', { cx: rx, cy: lay.narrow ? 16 : ry, r: lay.narrow ? 7 : 9 }));
      wrap.appendChild(lines);
      wrap.appendChild(list);
      return wrap;
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

    function draw(entry) {
      clear(entry.panel);
      entry.drawn = true;
      entry.drawnWidth = panelWidth();
      if (entry.mentions) { entry.panel.appendChild(mentionsView(entry)); return; }
      var how = treatmentFor(mode, entry.count, entry.drawnWidth);
      entry.how = how;
      if (how === 'cards') entry.panel.appendChild(cardsView(entry));
      else if (how === 'web') interactive(entry, webView(entry));
      else interactive(entry, treeView(entry, entry.drawnWidth));
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

    section.appendChild(app);
    show(0, false);
    section.classList.add('cx-live');

    // A new width draws the open tab again (the tree is laid out in pixels); the others wait.
    var resizeTimer = 0;
    win.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var w = panelWidth();
        entries.forEach(function (entry, i) {
          if (!entry.drawn || entry.mentions || entry.drawnWidth === w) return;
          if (i === current) draw(entry);
          else entry.drawn = false;
        });
      }, 120);
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined') init(document, window);
})();
