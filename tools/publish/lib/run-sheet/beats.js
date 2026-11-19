'use strict';
// The beats of a session Plan: each `###` under `## Planned Scenes`, then each under
// `## Contingency Scenes`, read into what the GM sees when the PCs reach that scene.
//
// Works with what it has: a beat missing any part still reads, with '' / [] / null in its place
// and a warning (a prep note, never a condition). Nothing is dropped silently: every line of a
// beat's text is in a field or in `extra`. A line is claimed by a field only when the field holds
// all of it; a line it can hold only part of (a Handouts line with words after the link, a link the
// vault lacks) stays whole in `extra` as well.

const pt = require('./plan-text');
const { stemOf } = require('./notes');
const { beatKeys, itemKeys } = require('./keys');
const { playAsOf } = require('./people-from-notes');
const { parseWikilink } = require('../wikilink');
const { markersIn } = require('../markers');

const { LABEL, isBlank, nameKey } = pt;

const SCENE_N = /^\s*scene\s+\d+\s*:\s*/i;
const HUB_MARK = /\s*\((hub|routing)\)\s*/i;
// What a list of links may hold between them and still be only links: `and`, spaces, punctuation.
const SEPARATORS = /[\s,;&.·]+/g;
const onlySeparators = (s) => s.replace(/\band\b/gi, '').replace(SEPARATORS, '') === '';
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
// The hub block heads (`**Where they can go**`, legacy `**Open to the party**`): a scene holding one is a hub.
const WHERE_HEAD = /^\*\*(?:Where they can go|Open to the party):?\*\*[ \t]*(?:\([^)]*\))?[ \t]*$/i;
// A pointer bullet leads to another scene: it ends `— Scene N` (a parenthesis or a few words may
// follow), or its lead (a bold lead, or a bare link first) links a note of type scene. A link whose
// note is no scene, or is unknown, leads a place. plan_check.py holds the same rule.
const POINTER_BULLET = /^.*[—–-]\s*Scenes?\s+\d+(?:\s*\([^)]*\)|,?\s+\S+(?:\s+\S+){0,2})?[\s.]*$/;
const BARE_LINK_LEAD = /^(!?\[\[[^\]]+\]\])/;
const BOLD_LEAD = /^\*\*([^*\n]+?)\*\*/;
const BLOCK_NAMES = new Set(['npcs', 'points to land', 'if the players...', 'treasure', 'complications', 'then']);

const linesOf = (text) => pt.cleanText(text).split('\n');
const offset = (items, by) => items.map((x) => ({ ...x, start: x.start + by, end: x.end + by }));
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

// A scene note's body split at its GM fences: the public text, and each fenced part. The fences are
// read the one way the publish tool reads them (markers.js): `<!--gm-only-->` and `<!-- GM-ONLY -->`
// are fences too. An opener inside a fence, or a closer outside one, is a comment and changes nothing.
function splitGm(body) {
  const src = String(body || '');
  const pub = [];
  const gm = [];
  let from = 0;
  let open = false;
  for (const m of markersIn(src)) {
    if (m.name !== 'gm-only' || m.close !== open) continue;
    (open ? gm : pub).push(src.slice(from, m.index));
    from = m.index + m.length;
    open = !open;
  }
  (open ? gm : pub).push(src.slice(from));
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
    const why = index.linkProblem(target);
    if (why) warnings.push({ kind: why.kind, note: null, text: why.text });
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
    key: b.key, title: b.title, contingency: b.contingency, sceneNote: b.sceneNote, place: b.place, placeText: b.placeText, placeFrom: b.placeFrom,
    spots: b.spots.map((s) => ({ key: s.key, name: s.name, note: s.note, md: s.md, people: s.people })),
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
    // `### [[Note]]`, `### Scene 2: [[Note]]` and `### [[Note]] (hub)` all name a scene note.
    const mark = heading.match(HUB_MARK);
    const sm = title.replace(HUB_MARK, ' ').trim().match(LINK_ONLY);
    if (!sm && pt.links(heading).length) {
      warnings.push({ kind: 'scene-note-not-read', note: null, text: `${heading} holds a link but not only a link, so no scene note is read for it: make the heading the link alone` });
    }
    if (sm) {
      // The scene lives in its own note: its public text, then the Plan's lines; its fenced parts are gmNotes.
      const l = linkParts(sm[1]);
      title = (l.display || l.name) + (mark ? ` (${mark[1].toLowerCase()})` : '');
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
    const fenced = pt.fenceMask(lines);
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
        if (whole && onlySeparators(l.value.replace(LINK, ''))) claim(l.start, l.end);
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
    let place = entities.find((p) => typeOf(p) === 'location') || null;
    let placeFrom = null;
    if (place) placeFrom = noteFm && fmPaths(noteFm.locations).includes(place) ? 'scene-note' : 'entities';
    // The Plan's `**Place:**` wins over the scene note's and Entities: one link alone is the place;
    // anything else is words, kept as placeText, and gives no place.
    let placeText = '';
    const placeLines = labelsNamed('Place');
    if (placeLines.length) {
      placeLines.forEach((l) => claim(l.start, l.end));
      const lm = placeLines.length === 1 ? placeLines[0].value.match(LINK_ONLY) : null;
      const linked = lm ? resolve(linkParts(lm[1]).target) : null;
      if (linked) { place = linked; placeFrom = 'place'; } else {
        place = null;
        placeFrom = null;
        placeText = placeLines.map((l) => l.value).join('\n\n');
      }
    }

    // Who: the NPCs blocks, then the Who lines, then (in a hub) each spot's NPC lines.
    const who = [];
    const inWho = (note, name) => who.some((w) => (note ? w.note === note : !w.note && w.name === name));
    const npcFrom = (itemText) => {
      const m = itemText.match(NPC_LINE);
      if (!m) return null;
      const l = linkParts(m[1]);
      const paren = (m[2] !== undefined ? m[2] : m[3]);
      const p = paren === undefined ? '' : paren.trim();
      const counted = /^\d+$/.test(p);
      const count = counted ? Number(p) : 1;
      const knownAs = p && !counted ? p : l.display;
      return { target: l.target, name: l.name, knownAs, count, counted, wants: m[4].replace(/\s+/g, ' ').trim() };
    };
    const person = (note, n) => ({ note, name: n.name, knownAs: n.knownAs, count: n.count, wants: n.wants, playAs: playAsOf(note, index) });

    // Whether each entry's count was written as a number (`(3)`), by who index.
    const countedAt = [];
    const npcBlocks = blocksOf('NPCs');
    for (const b of npcBlocks) {
      blockHeads.push(b);
      for (const item of offset(pt.bullets(b.sub), b.start)) {
        const n = npcFrom(item.text);
        if (!n) continue;
        const note = resolve(n.target);
        const at = who.findIndex((w) => (note ? w.note === note : !w.note && w.name === n.name));
        if (at !== -1) {
          // One person listed twice: two written counts add up, and the second line's words join the
          // first's unless they say the same; otherwise the second line stays in extra.
          if (!(countedAt[at] && n.counted)) continue;
          who[at].count += n.count;
          const same = (a, b) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
          if (n.wants && !same(n.wants, who[at].wants)) who[at].wants = who[at].wants ? `${who[at].wants}; ${n.wants}` : n.wants;
        } else {
          countedAt[who.length] = n.counted;
          who.push(person(note, n));
        }
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
      if (onlySeparators(rest)) claim(l.start, l.end);
    }

    let spots = [];
    const isHub = /\(hub\)/i.test(heading) || lines.some((l, i) => !fenced[i] && WHERE_HEAD.test(l));
    if (isHub) {
      const found = [];
      const taken = (note, name) => (note && typeOf(note) === 'pc') || inWho(note, name);
      // Spot groups: a bare bold head with no field slot, one spot per top-level bullet under it.
      lines.forEach((line, i) => {
        if (fenced[i] || !isGroupHead(line)) return;
        let end = i;
        // every bullet is a spot here, a bold-named one (`- **The chapel:** …`) included
        for (let j = i + 1; j < lines.length && !fenced[j] && (/^[-*+]\s/.test(lines[j]) || !endsSpot(lines[j])); j++) if (!isBlank(lines[j])) end = j;
        const paren = Boolean(line.match(GROUP_HEAD)[2]);
        if (!paren) blockHeads.push({ head: i, start: i + 1, end }); // a parenthesis keeps the head in extra
        for (const item of offset(pt.bullets(lines.slice(i + 1, end + 1).join('\n')), i + 1)) {
          const [first, ...more] = item.text.split('\n');
          // a pointer bullet leads to another scene: no spot, and its line stays in extra
          const lead = first.match(BOLD_LEAD);
          const leadLinks = lead ? (lead[1].match(LINK) || []) : (first.match(BARE_LINK_LEAD) || []).slice(1);
          if (POINTER_BULLET.test(first)
              || leadLinks.some((m) => typeOf(resolve(linkParts(m.replace(/^!?\[\[|\]\]$/g, '')).target)) === 'scene')) continue;
          const nb = item.text.match(NAMED_BULLET);
          let name;
          let rest;
          if (nb) { name = nb[1].trim(); rest = nb[2]; } else {
            // a plain bullet is named by its first line
            const dash = first.indexOf(' — ');
            name = dash === -1 ? first : first.slice(0, dash);
            rest = (dash === -1 ? '' : first.slice(dash + 3)) + (more.length ? `\n${more.join('\n')}` : '');
          }
          const nameLinks = name.match(LINK) || [];
          const note = nameLinks.length ? resolve(linkParts(nameLinks[0].replace(/^!?\[\[|\]\]$/g, '')).target) : null;
          name = name.replace(LINK, (m) => { const l = linkParts(m.replace(/^!?\[\[|\]\]$/g, '')); return l.display || l.name; }).trim();
          // The bullet's words are the spot's (`md`); the NPCs and creatures it links join who, without
          // those words as their wants. The bullet is held whole.
          const md = rest.trim();
          const people = [];
          found.push({ i: item.start, name, note, md, people });
          for (const m of (md.match(LINK) || []).filter((x) => !x.startsWith('!'))) {
            const lp = linkParts(m.slice(2, -2));
            const p = resolve(lp.target);
            const type = typeOf(p);
            if (!p || type === 'location') continue;
            if (!people.includes(p)) people.push(p);
            if ((type !== 'npc' && type !== 'creature') || taken(p, lp.name)) continue;
            who.push(person(p, { name: lp.name, knownAs: lp.display, count: 1, wants: '' }));
          }
          claim(item.start, item.end);
        }
      });
      // Bold-name spot lines, each followed by its `- **[[Note]]:**` NPC lines.
      lines.forEach((line, i) => {
        if (fenced[i] || !isSpotLine(line)) return;
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
        for (let j = i + 1; j < lines.length && !fenced[j] && !endsSpot(lines[j]); j++) end = j;
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
      spots = found.sort((a, b) => a.i - b.i).map((x) => ({ name: x.name, note: x.note, md: x.md || '', people: x.people || [] }));
    } else if (place) {
      spots = [{ name: stemOf(place), note: place, md: '', people: [] }];
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
        const sep = r.start + 1 <= r.end && pt.isSeparatorRow(lines[r.start + 1]);
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
    const hubLike = isHub || /\((?:hub|routing)\)/i.test(heading) || /^\s*scene\s+0\b/i.test(heading) || type === 'transition';
    if (!contingency && who.length === 0 && !hubLike) {
      const why = npcBlocks.length ? 'has no NPC lines the sheet can read' : 'has no **NPCs** block';
      warnings.push({ kind: 'no-npcs-block', note: sceneNote, text: `${title} ${why}, so the page shows nobody here.` });
    }

    if (!contingency && !hubLike && !place && !placeText) {
      warnings.push({ kind: 'no-place', note: sceneNote, text: `${title} has no **Place:** line, so the page does not say where it happens.` });
    }

    return {
      title, contingency, sceneNote, place, placeText, placeFrom, spots, situation, startsIt, readAloud, gmNotes,
      complications, trigger, then, who, points, ifs, treasure, handouts, entities, extra,
    };
  }
}

module.exports = { readBeats, sceneSection };
