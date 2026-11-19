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
const BLOCK_HEAD = /^\*\*([^*\n]+?):?\*\*[ \t]*$/;
const HEADING = /^#{1,6}\s/;
const isQuote = (l) => /^\s*>/.test(l);
const isBlank = (l) => l.trim() === '';
const nameKey = (s) => String(s == null ? '' : s).trim().toLowerCase();

const SCENE_N = /^\s*scene\s+\d+\s*:\s*/i;
const LINK_ONLY = /^\s*\[\[([^\]]+)\]\]\s*$/;
const LINK = /!?\[\[[^\]]*\]\]/g;
// `**[[Note]]:** wants`, `**[[Note]] (3):** wants`, `**[[Note]]** (known as): wants` (bullet marker removed)
const NPC_LINE = /^\*\*\[\[([^\]]+)\]\](?:\s*\(([^)]*)\))?:?\*\*:?[ \t]*(?:\(([^)]*)\)[ \t]*:)?\s*([\s\S]*)$/;
// A hub spot: a bold name at a line start that is not a label (`**X:**`).
const SPOT = /^\*\*([^*\n]+?)\*\*(?!\*)(.*)$/;
const BLOCK_NAMES = new Set(['npcs', 'points to land', 'if the players...', 'treasure', 'complications', 'then']);

const linesOf = (text) => pt.cleanText(text).split('\n');
const offset = (items, by) => items.map((x) => ({ ...x, start: x.start + by, end: x.end + by }));
const stemOf = (p) => path.posix.basename(p, path.posix.extname(p));
const linkParts = (body) => {
  const w = parseWikilink(body);
  const target = String(w.target || '').trim();
  return { target, display: String(w.display || '').trim(), name: target.split('/').pop() };
};

// Every block headed `**name**` / `**name:**` alone on a line: the lines after it up to the next
// label, bare bold line, quote or heading. Unlike plan-text's block(), a label whose name is a link
// (`- **[[Ash]]:** wants X`) is content and does not end the block, and every block of the name is
// found (a scene note's and the Plan's).
function blocks(lines, name) {
  const key = nameKey(name);
  const out = [];
  for (let at = 0; at < lines.length; at++) {
    const h = lines[at].match(BLOCK_HEAD);
    if (!h || nameKey(h[1]) !== key) continue;
    let end = at;
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i];
      const lb = l.match(LABEL);
      if ((lb && !lb[1].trim().startsWith('[[')) || BLOCK_HEAD.test(l) || isQuote(l) || HEADING.test(l)) break;
      if (!isBlank(l)) end = i;
    }
    const sub = lines.slice(at + 1, end + 1).join('\n');
    out.push({ head: at, start: at + 1, end, sub, value: sub.trim() });
    at = end;
  }
  return out;
}

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
    const want = nameKey(sec.title);
    if (want !== 'planned scenes' && want !== 'contingency scenes') continue;
    claimed[sec.title] = true;
    pt.sections(sec.text, 3).forEach((s, i) => {
      if (i === 0 && s.title === '') {
        preamble[sec.title] = preamble[sec.title] ? `${preamble[sec.title]}\n\n${s.text}` : s.text;
        return;
      }
      heads.push({ heading: s.title, text: s.text, contingency: want === 'contingency scenes' });
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
  return { beats: ordered, claimed, preamble, warnings };

  function readBeat({ heading, text: planText, contingency }) {
    let title = heading.replace(SCENE_N, '').trim();
    let sceneNote = null;
    let gmNotes = '';
    let text = planText;
    let noteFm = null;
    const sm = heading.match(LINK_ONLY);
    if (sm) {
      // The scene lives in its own note: its text before the GM fence, then the Plan's lines.
      const l = linkParts(sm[1]);
      title = l.display || l.name;
      sceneNote = resolve(l.target);
      if (sceneNote) {
        const note = index.read(sceneNote);
        noteFm = note.fm || {};
        const body = String(note.body || '');
        const at = body.indexOf('<!-- gm-only -->');
        const pub = at === -1 ? body : body.slice(0, at);
        if (at !== -1) {
          const gm = body.slice(at + '<!-- gm-only -->'.length).split('<!-- /gm-only -->')[0];
          gmNotes = pt.cleanText(gm).replace(/^##[ \t]+GM Notes[ \t#]*$/im, '').trim();
        }
        text = pub.trim() ? `${pub.trim()}\n\n${planText}` : planText;
      }
    }

    const lines = linesOf(text);
    const ranges = [];
    const claim = (start, end = start) => ranges.push({ start, end });
    const isClaimed = (i) => ranges.some((r) => i >= r.start && i <= r.end);
    const blockHeads = [];
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

    for (const b of blocks(lines, 'NPCs')) {
      blockHeads.push(b);
      for (const item of offset(pt.bullets(b.sub), b.start)) {
        const n = npcFrom(item.text);
        if (!n) continue;
        who.push(person(resolve(n.target), n));
        claim(item.start, item.end);
      }
    }

    const whoWords = [];
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
      claim(l.start, l.end);
      const words = rest.split(/\s*(?:,|;|&|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean).join(', ');
      if (words) whoWords.push(`**Who:** ${words}`);
    }

    let spots = [];
    if (/\(hub\)/i.test(heading)) {
      const at = [];
      lines.forEach((line, i) => {
        const m = line.match(SPOT);
        if (!m || LABEL.test(line) || m[1].trim().endsWith(':')) return;
        if (BLOCK_HEAD.test(line) && BLOCK_NAMES.has(nameKey(m[1]))) return;
        at.push({ i, name: m[1].trim() });
      });
      at.forEach((s, k) => {
        const lm = s.name.match(LINK_ONLY);
        let note = null;
        let name = s.name;
        if (lm) {
          const l = linkParts(lm[1]);
          note = resolve(l.target);
          name = l.display || l.name;
        }
        spots.push({ name, note });
        // the spot's NPC lines: up to the next spot, heading, label or bold block head
        let end = s.i;
        const stop = k + 1 < at.length ? at[k + 1].i : lines.length;
        for (let i = s.i + 1; i < stop; i++) {
          const l = lines[i];
          const lb = l.match(LABEL);
          if ((lb && !lb[1].trim().startsWith('[[')) || BLOCK_HEAD.test(l) || HEADING.test(l) || isQuote(l)) break;
          end = i;
        }
        const sub = lines.slice(s.i + 1, end + 1).join('\n');
        for (const item of offset(pt.bullets(sub), s.i + 1)) {
          if (isClaimed(item.start)) continue;
          const n = npcFrom(item.text);
          if (!n) continue;
          const p = resolve(n.target);
          if ((p && typeOf(p) === 'pc') || inWho(p, n.name)) continue; // left in extra
          who.push(person(p, n));
          claim(item.start, item.end);
        }
      });
    } else if (place) {
      spots = [{ name: stemOf(place), note: place }];
    }

    // Lists and tables.
    const listOf = (name) => {
      const out = [];
      for (const b of blocks(lines, name)) {
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
    for (const b of blocks(lines, 'If the players...')) {
      blockHeads.push(b);
      for (const r of pt.tableRows(b.sub)) ifs.push({ do: r[0] || '', then: r.slice(1).filter(Boolean).join(' · ') });
      offset(pt.tableRanges(b.sub), b.start).forEach((r) => claim(r.start, r.end));
    }
    const wholeBlock = (name) => blocks(lines, name).map((b) => {
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
    pt.readAloudRanges(text).forEach((r) => claim(r.start, r.end));

    // A block head is claimed when every line under it is; otherwise it stays to head its leftovers.
    for (const b of blockHeads) {
      let all = true;
      for (let i = b.start; i <= b.end; i++) if (!isBlank(lines[i]) && !isClaimed(i)) all = false;
      if (all) claim(b.head);
    }

    const left = pt.unclaimed(text, ranges).replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
    const extra = [left, ...whoWords].filter(Boolean).join('\n\n');

    const type = nameKey(pt.label(text, 'Type'));
    if (!contingency && who.length === 0 && !/\((?:hub|routing)\)/i.test(heading)
        && !/^\s*scene\s+0\b/i.test(heading) && type !== 'transition') {
      warnings.push({ kind: 'no-npcs-block', note: sceneNote, text: `${title} has no **NPCs** block, so the page shows nobody here.` });
    }

    return {
      title, contingency, sceneNote, place, spots, situation, startsIt, readAloud, gmNotes,
      complications, trigger, then, who, points, ifs, treasure, handouts, entities, extra,
    };
  }
}

module.exports = { readBeats };
