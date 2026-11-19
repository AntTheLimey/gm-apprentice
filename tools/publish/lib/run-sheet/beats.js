'use strict';
// The beats of a session Plan: each `###` under `## Planned Scenes`, then each under
// `## Contingency Scenes`, read into what the GM sees when the PCs reach that scene.
//
// Works with what it has: a beat missing any part still reads, with '' / [] / null in its place
// and a warning (a prep note, never a condition). Nothing is dropped silently: every line of a
// beat's text is in a field or in `extra`. A line is claimed by a field only when the field holds
// all of it; a line it can hold only part of (a Handouts line with words after the link, a link the
// vault lacks) stays whole in `extra` as well.

const path = require('node:path');
const pt = require('./plan-text');
const { beatKeys, itemKeys } = require('./keys');
const { playAsOf } = require('./people-from-notes');
const { parseWikilink } = require('../wikilink');

// The same line shapes plan-text.js reads.
const LABEL = /^(?:[-*+]\s+)?\*\*([^*\n]+?):\*\*[ \t]*(.*)$/;
const isBlank = (l) => l.trim() === '';
const nameKey = (s) => String(s == null ? '' : s).trim().toLowerCase();

const SCENE_N = /^\s*scene\s+\d+\s*:\s*/i;
const LINK_ONLY = /^\s*\[\[([^\]]+)\]\]\s*$/;
const LINK = /!?\[\[[^\]]*\]\]/g;
// `**[[Note]]:** wants`, `**[[Note]] (3):** wants`, `**[[Note]]** (known as): wants` (bullet marker removed)
const NPC_LINE = /^\*\*\[\[([^\]]+)\]\](?:\s*\(([^)]*)\))?:?\*\*:?[ \t]*(?:\(([^)]*)\)[ \t]*:)?\s*([\s\S]*)$/;
// A hub spot line: a bold name at a line start that is not a label (`**X:**`).
const SPOT = /^\*\*([^*\n]+?)\*\*(?!\*)(.*)$/;
// A bare bold head, maybe with a parenthesis after it: `**Open to the party** (scenes 1-8)`.
const GROUP_HEAD = /^\*\*([^*\n]+?):?\*\*[ \t]*(\([^)]*\))?[ \t]*$/;
// A spot group bullet led by a bold name: `**The guest wing:** rest` (bullet marker removed).
const NAMED_BULLET = /^\*\*([^*\n]+?):?\*\*:?[ \t]*([\s\S]*)$/;
const BLOCK_NAMES = new Set(['npcs', 'points to land', 'if the players...', 'treasure', 'complications', 'then']);
const GM_OPEN = '<!-- gm-only -->';
const GM_CLOSE = '<!-- /gm-only -->';

const linesOf = (text) => pt.cleanText(text).split('\n');
const offset = (items, by) => items.map((x) => ({ ...x, start: x.start + by, end: x.end + by }));
const stemOf = (p) => path.posix.basename(p, path.posix.extname(p));
const linkParts = (body) => {
  const w = parseWikilink(body);
  const target = String(w.target || '').trim();
  return { target, display: String(w.display || '').trim(), name: target.split('/').pop() };
};
// A bare bold head that names no field and no note opens a hub's spot group.
const isGroupHead = (line) => {
  const g = line.match(GROUP_HEAD);
  return Boolean(g) && !g[1].trim().startsWith('[[') && !BLOCK_NAMES.has(nameKey(g[1]));
};
// The brief's hub shape: `**[[The Gate House]]**: words` or `**The orchard**: words` on its own line.
const isSpotLine = (line) => {
  const m = line.match(SPOT);
  return Boolean(m) && !LABEL.test(line) && !m[1].trim().endsWith(':') && !isGroupHead(line)
    && !(GROUP_HEAD.test(line) && BLOCK_NAMES.has(nameKey(m[1])));
};
const endsSpot = (line) => pt.endsBlock(line) || GROUP_HEAD.test(line) || isSpotLine(line);

// A scene note's body split at its GM fences: the public text, and each fenced part.
function splitGm(body) {
  const pub = [];
  const gm = [];
  let rest = String(body || '');
  for (;;) {
    const at = rest.indexOf(GM_OPEN);
    if (at === -1) { pub.push(rest); break; }
    pub.push(rest.slice(0, at));
    rest = rest.slice(at + GM_OPEN.length);
    const close = rest.indexOf(GM_CLOSE);
    if (close === -1) { gm.push(rest); break; }
    gm.push(rest.slice(0, close));
    rest = rest.slice(close + GM_CLOSE.length);
  }
  return {
    pub: pub.map((x) => x.trim()).filter(Boolean).join('\n\n'),
    gm: gm.map((x) => pt.cleanText(x).replace(/^##[ \t]+GM Notes[ \t#]*$/im, '').trim()).filter(Boolean).join('\n\n'),
  };
}

// 'planned' or 'contingency' for the two `##` sections beats are read from, else null.
const sceneSection = (title) => ({ 'planned scenes': 'planned', 'contingency scenes': 'contingency' })[nameKey(title)] || null;

function readBeats(planBody, index) {
  const warnings = [];
  const missing = new Set();
  const warnMissing = (target) => {
    const k = nameKey(target);
    if (missing.has(k)) return;
    missing.add(k);
    warnings.push({ kind: 'missing-note', note: null, text: `[[${target}]] matches no note in the vault` });
  };
  const resolve = (target) => {
    const p = index.resolve(target);
    if (p === null && String(target || '').trim()) warnMissing(String(target).trim());
    return p;
  };
  const typeOf = (p) => (p ? nameKey(index.read(p).fm.type) : '');

  const claimed = {};
  const preamble = {};
  const heads = [];
  for (const sec of pt.sections(planBody, 2)) {
    const kind = sceneSection(sec.title);
    if (!kind) continue;
    claimed[sec.title] = true;
    pt.sections(sec.text, 3).forEach((s, i) => {
      if (i === 0 && s.title === '') {
        preamble[sec.title] = preamble[sec.title] ? `${preamble[sec.title]}\n\n${s.text}` : s.text;
        return;
      }
      heads.push({ heading: s.title, text: s.text, contingency: kind === 'contingency', section: sec.title });
    });
  }

  const beats = heads.map((h) => readBeat(h));
  const keys = beatKeys(beats.map((b) => ({ title: b.title, contingency: b.contingency })));
  beats.forEach((b, i) => {
    b.key = keys[i];
    const whoKeys = itemKeys(b.key, 'who', b.who.map((w) => w.note || w.name));
    b.who.forEach((w, j) => { w.key = whoKeys[j]; });
    const spotKeys = itemKeys(b.key, 'spot', b.spots.map((s) => s.note || s.name));
    b.spots.forEach((s, j) => { s.key = spotKeys[j]; });
    for (const [field, kind, textOf] of [['points', 'pt', (x) => x.text], ['treasure', 'loot', (x) => x.text], ['ifs', 'if', (x) => x.do]]) {
      const ks = itemKeys(b.key, kind, b[field].map(textOf));
      b[field].forEach((x, j) => { x.key = ks[j]; });
    }
  });
  // Keys first in each object, in the model's field order.
  const ordered = beats.map((b) => ({
    key: b.key, title: b.title, contingency: b.contingency, sceneNote: b.sceneNote, place: b.place,
    spots: b.spots.map((s) => ({ key: s.key, name: s.name, note: s.note })),
    situation: b.situation, startsIt: b.startsIt, readAloud: b.readAloud, gmNotes: b.gmNotes,
    complications: b.complications, trigger: b.trigger, then: b.then,
    who: b.who.map((w) => ({ key: w.key, note: w.note, name: w.name, knownAs: w.knownAs, count: w.count, wants: w.wants, playAs: w.playAs })),
    points: b.points.map((x) => ({ key: x.key, text: x.text, box: x.box })),
    ifs: b.ifs.map((x) => ({ key: x.key, do: x.do, then: x.then })),
    treasure: b.treasure.map((x) => ({ key: x.key, text: x.text, box: x.box })),
    handouts: b.handouts, entities: b.entities, foes: [], extra: b.extra,
  }));
  // `sections[i]` is the `##` title beat i was read under.
  return { beats: ordered, sections: heads.map((h) => h.section), claimed, preamble, warnings };

  function readBeat({ heading, text: planText, contingency }) {
    let title = heading.replace(SCENE_N, '').trim();
    let sceneNote = null;
    let gmNotes = '';
    let text = planText;
    let noteFm = null;
    const sm = heading.match(LINK_ONLY);
    if (sm) {
      // The scene lives in its own note: its public text, then the Plan's lines; its fenced parts are gmNotes.
      const l = linkParts(sm[1]);
      title = l.display || l.name;
      sceneNote = resolve(l.target);
      if (sceneNote) {
        const note = index.read(sceneNote);
        noteFm = note.fm || {};
        const { pub, gm } = splitGm(note.body);
        gmNotes = gm;
        text = pub ? `${pub}\n\n${planText}` : planText;
      }
    }

    const lines = linesOf(text);
    const ranges = [];
    const claim = (start, end = start) => ranges.push({ start, end });
    const isClaimed = (i) => ranges.some((r) => i >= r.start && i <= r.end);
    const blockHeads = [];
    const blocksOf = (name) => pt.blocks(text, name).map((b) => ({ head: b.start, start: b.start + 1, end: b.end, sub: b.sub, value: b.value }));
    const allLabels = pt.labels(text);
    const labelsNamed = (name) => allLabels.filter((l) => nameKey(l.name) === nameKey(name) && l.value !== '');
    const labelValue = (name) => {
      const ls = labelsNamed(name);
      ls.forEach((l) => claim(l.start, l.end));
      return ls.map((l) => l.value).join('\n\n');
    };

    // A line of links: its resolved notes; the line is claimed only when it is nothing but
    // links the vault holds and separators.
    const linkLine = (name) => {
      const out = [];
      for (const l of labelsNamed(name)) {
        let whole = true;
        for (const t of pt.links(l.value)) {
          const p = resolve(t);
          if (p) out.push(p); else whole = false;
        }
        const rest = l.value.replace(LINK, '').replace(/\band\b/gi, '').replace(/[\s,;&·]+/g, '');
        if (whole && rest === '') claim(l.start, l.end);
      }
      return out;
    };

    // Entities: the note's locations, the scene note, the Plan's **Entities:**, the note's entities.
    const fmTargets = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).flatMap((x) => {
      const s = String(x == null ? '' : x);
      const ls = pt.links(s);
      return ls.length ? ls : (s.trim() ? [s.trim()] : []);
    });
    const fmPaths = (v) => fmTargets(v).map(resolve).filter(Boolean);
    const entities = [];
    const addEntity = (p) => { if (p && !entities.includes(p)) entities.push(p); };
    if (noteFm) fmPaths(noteFm.locations).forEach(addEntity);
    addEntity(sceneNote);
    linkLine('Entities').forEach(addEntity);
    if (noteFm) fmPaths(noteFm.entities).forEach(addEntity);
    const place = entities.find((p) => typeOf(p) === 'location') || null;

    // Who: the NPCs blocks, then the Who lines, then (in a hub) each spot's NPC lines.
    const who = [];
    const inWho = (note, name) => who.some((w) => (note ? w.note === note : !w.note && w.name === name));
    const npcFrom = (itemText) => {
      const m = itemText.match(NPC_LINE);
      if (!m) return null;
      const l = linkParts(m[1]);
      const paren = (m[2] !== undefined ? m[2] : m[3]);
      const p = paren === undefined ? '' : paren.trim();
      const count = /^\d+$/.test(p) ? Number(p) : 1;
      const knownAs = p && !/^\d+$/.test(p) ? p : l.display;
      return { target: l.target, name: l.name, knownAs, count, wants: m[4].replace(/\s+/g, ' ').trim() };
    };
    const person = (note, n) => ({ note, name: n.name, knownAs: n.knownAs, count: n.count, wants: n.wants, playAs: playAsOf(note, index) });

    const npcBlocks = blocksOf('NPCs');
    for (const b of npcBlocks) {
      blockHeads.push(b);
      for (const item of offset(pt.bullets(b.sub), b.start)) {
        const n = npcFrom(item.text);
        if (!n) continue;
        who.push(person(resolve(n.target), n));
        claim(item.start, item.end);
      }
    }

    for (const l of labelsNamed('Who')) {
      let rest = l.value;
      for (const m of l.value.match(LINK) || []) {
        if (m.startsWith('!')) continue;
        const lp = linkParts(m.slice(2, -2));
        const note = resolve(lp.target);
        const type = typeOf(note);
        if (note && type === 'pc') { rest = rest.replace(m, ''); continue; } // PCs are the party
        if (note && type !== 'npc' && type !== 'creature') continue; // a place or thing: its words stay
        if (!inWho(note, lp.name)) {
          who.push(person(note, { name: lp.name, knownAs: lp.display, count: 1, wants: '' }));
        }
        rest = rest.replace(m, '');
      }
      // Nothing left but list separators: the line is held. Any other words (`or`, `the bell-ringer`,
      // a place's link) mean the line is only partly held, so it stays whole in extra.
      if (rest.replace(/\band\b/gi, '').replace(/[\s,;&.]+/g, '') === '') claim(l.start, l.end);
    }

    let spots = [];
    if (/\(hub\)/i.test(heading)) {
      const found = [];
      const taken = (note, name) => (note && typeOf(note) === 'pc') || inWho(note, name);
      // Spot groups: a bare bold head with no field slot, one spot per top-level bullet under it.
      lines.forEach((line, i) => {
        if (!isGroupHead(line)) return;
        let end = i;
        // every bullet is a spot here, a bold-named one (`- **The chapel:** …`) included
        for (let j = i + 1; j < lines.length && (/^[-*+]\s/.test(lines[j]) || !endsSpot(lines[j])); j++) if (!isBlank(lines[j])) end = j;
        const paren = Boolean(line.match(GROUP_HEAD)[2]);
        if (!paren) blockHeads.push({ head: i, start: i + 1, end }); // a parenthesis keeps the head in extra
        for (const item of offset(pt.bullets(lines.slice(i + 1, end + 1).join('\n')), i + 1)) {
          const nb = item.text.match(NAMED_BULLET);
          let name;
          let rest;
          if (nb) { name = nb[1].trim(); rest = nb[2]; } else {
            // a plain bullet is named by its first line; nested or wrapped lines stay in extra
            const [first, ...more] = item.text.split('\n');
            const dash = first.indexOf(' — ');
            name = dash === -1 ? first : first.slice(0, dash);
            rest = (dash === -1 ? '' : first.slice(dash + 3)) + more.join('\n');
          }
          const nameLinks = name.match(LINK) || [];
          const note = nameLinks.length ? resolve(linkParts(nameLinks[0].replace(/^!?\[\[|\]\]$/g, '')).target) : null;
          name = name.replace(LINK, (m) => { const l = linkParts(m.replace(/^!?\[\[|\]\]$/g, '')); return l.display || l.name; }).trim();
          found.push({ i: item.start, name, note });
          // A bold-named bullet's NPC and creature links join who; each `;` part's words are its wants.
          let held = rest.trim() === '';
          if (nb && !held) {
            held = true;
            for (const part of rest.split(';')) {
              if (part.trim() === '') continue;
              const ls = (part.match(LINK) || []).filter((m) => !m.startsWith('!'));
              if (ls.length === 0) { held = false; continue; }
              for (const m of ls) {
                const lp = linkParts(m.slice(2, -2));
                const p = resolve(lp.target);
                const type = typeOf(p);
                if (!p || (type !== 'npc' && type !== 'creature') || taken(p, lp.name)) { held = false; continue; }
                const wants = part.replace(m, '').replace(/\s+/g, ' ').replace(/^[\s,;:—–-]+|[\s,;]+$/g, '');
                who.push(person(p, { name: lp.name, knownAs: lp.display, count: 1, wants }));
              }
            }
          }
          if (held) claim(item.start, item.end);
        }
      });
      // Bold-name spot lines, each followed by its `- **[[Note]]:**` NPC lines.
      lines.forEach((line, i) => {
        if (!isSpotLine(line)) return;
        const raw = line.match(SPOT)[1].trim();
        const lm = raw.match(LINK_ONLY);
        let note = null;
        let name = raw;
        if (lm) {
          const l = linkParts(lm[1]);
          note = resolve(l.target);
          name = l.display || l.name;
        }
        found.push({ i, name, note });
        let end = i;
        for (let j = i + 1; j < lines.length && !endsSpot(lines[j]); j++) end = j;
        for (const item of offset(pt.bullets(lines.slice(i + 1, end + 1).join('\n')), i + 1)) {
          if (isClaimed(item.start)) continue;
          const n = npcFrom(item.text);
          if (!n) continue;
          const p = resolve(n.target);
          if (taken(p, n.name)) continue; // left in extra
          who.push(person(p, n));
          claim(item.start, item.end);
        }
      });
      spots = found.sort((a, b) => a.i - b.i).map((x) => ({ name: x.name, note: x.note }));
    } else if (place) {
      spots = [{ name: stemOf(place), note: place }];
    }

    // Lists and tables.
    const listOf = (name) => {
      const out = [];
      for (const b of blocksOf(name)) {
        blockHeads.push(b);
        for (const item of offset(pt.bullets(b.sub), b.start)) {
          out.push({ text: item.text, box: item.box });
          claim(item.start, item.end);
        }
      }
      return out;
    };
    const points = listOf('Points to land');
    const treasure = listOf('Treasure');
    const ifs = [];
    for (const b of blocksOf('If the players...')) {
      blockHeads.push(b);
      for (const r of pt.tableRows(b.sub)) ifs.push({ do: r[0] || '', then: r.slice(1).filter(Boolean).join(' · ') });
      for (const r of offset(pt.tableRanges(b.sub), b.start)) {
        // A header other than `| Do | Then |` says something: it stays in extra.
        const sep = r.start + 1 <= r.end && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[r.start + 1]);
        const cells = lines[r.start].split('|').map((c) => nameKey(c)).filter(Boolean);
        const plain = cells.length === 2 && cells[0] === 'do' && cells[1] === 'then';
        claim(sep && !plain ? r.start + 1 : r.start, r.end);
      }
    }
    const wholeBlock = (name) => blocksOf(name).map((b) => {
      claim(b.head, b.end);
      return b.value;
    }).filter(Boolean).join('\n\n');
    const complications = wholeBlock('Complications');
    const then = wholeBlock('Then');

    const handouts = [];
    linkLine('Handouts').forEach((p) => { if (!handouts.includes(p)) handouts.push(p); });

    const situation = labelValue('Situation');
    const startsIt = labelValue('Starts it');
    const trigger = labelValue('Trigger');
    const readAloud = pt.readAloud(text);
    for (const r of pt.readAloudRanges(text)) {
      // A callout title (`> [!note] Title words`) is not read aloud: its line stays in extra.
      for (let i = r.start; i <= r.end; i++) if (!/^\s*>\s*\[![^\]]*\][+-]?[ \t]*\S/.test(lines[i])) claim(i);
    }

    // A block head is claimed when every line under it is; otherwise it stays to head its leftovers.
    for (const b of blockHeads) {
      let all = true;
      for (let i = b.start; i <= b.end; i++) if (!isBlank(lines[i]) && !isClaimed(i)) all = false;
      if (all) claim(b.head);
    }

    const left = pt.unclaimed(text, ranges).replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
    const extra = left;

    const type = nameKey(pt.label(text, 'Type'));
    if (!contingency && who.length === 0 && !/\((?:hub|routing)\)/i.test(heading)
        && !/^\s*scene\s+0\b/i.test(heading) && type !== 'transition') {
      const why = npcBlocks.length ? 'has no NPC lines the sheet can read' : 'has no **NPCs** block';
      warnings.push({ kind: 'no-npcs-block', note: sceneNote, text: `${title} ${why}, so the page shows nobody here.` });
    }

    return {
      title, contingency, sceneNote, place, spots, situation, startsIt, readAloud, gmNotes,
      complications, trigger, then, who, points, ifs, treasure, handouts, entities, extra,
    };
  }
}

module.exports = { readBeats, sceneSection };
