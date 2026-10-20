'use strict';
// `relationships check`: every relationship rule the skills used to check by eye, as a check.
// Reads the model readVault() builds and the ontology export; returns Findings.
//
//   Finding { level: 'ERROR'|'WARNING'|'INFO', rel, line, kind, message, fix, edgeIndex, form, mobrpg }
//   fix     null (nothing to do, or the tool must not touch it) or { certain, choices?, flip? }:
//           certain means the fix step may apply it without asking.
//   edgeIndex / form / mobrpg   the edge the finding is about (null for a finding about a note or a
//           field), so the fix step finds the edge by (rel, form, mobrpg, edgeIndex).
//
// The text form is one TSV row per finding, `LEVEL<TAB>rel:line<TAB>message`, sorted by rel then
// line, under a `# count: N` header (what vault_check.py prints).
//
// The whole vault is read; only notes the run was scoped to (`inScope`) are reported on. Notes out
// of scope still count where a rule looks at both ends (mirrored, same fact, hubs, containers).
// Edges in a `mobrpg:` node are machine-managed: they are checked for vocabulary and nothing else,
// and never get a fix.
const { vaultVocabulary } = require('./words');

const KIND_ORDER = [
  'off-vocabulary', 'tone', 'mirrored', 'same-fact', 'bidirectional', 'strength', 'place-missing-tie',
  'place-missing-field', 'place-disagrees', 'not-an-edge', 'genre-subset', 'childless-container', 'hub', 'unreadable',
];
const MAP_HINT = ' (map it via shared/relationship-normalization.md)';
const HUB_MIN_NOTES = 5;
// A note with fewer ties than this is no hub, however empty its type is (one tie among notes with none is not a crowd).
const HUB_MIN_TIES = 5;

// difflib.get_close_matches(word, possibilities, n=3, cutoff=0.6) of Python, ported whole so the near
// names are the ones vault_check.py has always offered: SequenceMatcher's longest-match rule (earliest in
// `a`, then earliest in `b`), ratio 2*M/T, and the largest three by (ratio, string).
function matchedCount(a, b) {
  const b2j = new Map();
  b.forEach((ch, j) => {
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(j);
  });
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };
  let total = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    total += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return total;
}

function closeMatches(word, possibilities, n = 3, cutoff = 0.6) {
  const b = Array.from(word);
  const scored = [];
  for (const x of possibilities) {
    const a = Array.from(x);
    const ratio = a.length + b.length ? (2 * matchedCount(a, b)) / (a.length + b.length) : 1;
    if (ratio >= cutoff) scored.push([ratio, x]);
  }
  scored.sort((p, q) => (q[0] - p[0]) || (p[1] < q[1] ? 1 : p[1] > q[1] ? -1 : 0));
  return scored.slice(0, n).map((p) => p[1]);
}

const typeKey = (raw) => String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
const toneKey = (raw) => String(raw).split(/\s+/).filter(Boolean).join(' ').toLowerCase();

function check(model, ontology, { vaultPath } = {}) {
  const { notes } = model;
  const out = [];
  const byRel = new Map(notes.map((n) => [n.rel, n]));
  const vocabulary = ontology.predicates.map((p) => p.type);
  const vocab = new Set(vocabulary);
  const sortedVocabulary = [...vocabulary].sort();
  const symmetric = new Set(ontology.predicates.filter((p) => p.symmetric).map((p) => p.type));
  // Python's dict keeps the last of two predicates that share an inverse name; so does this.
  const inverseOf = new Map();
  // A name that has its own row in `verbs` (visited_by) keeps that row's findings; the site
  // reads it as an inverse name all the same (lib/ontology.js).
  for (const p of ontology.predicates) {
    if (p.inverse && !Object.prototype.hasOwnProperty.call(ontology.verbs, p.inverse)) inverseOf.set(p.inverse, p.type);
  }
  const toneWords = new Map();
  for (const [family, list] of Object.entries(ontology.tones)) for (const w of list) toneWords.set(w, family);
  const notEdgeTypes = new Set(ontology.not_edge_target_types);
  const listed = vaultPath ? vaultVocabulary(vaultPath) : { subset: false, types: null };

  const add = (note, edge, level, kind, line, message, fix) => {
    out.push({
      level, rel: note.rel, line, kind, message, fix,
      edgeIndex: edge ? edge.index : null,
      form: edge ? edge.form : null,
      mobrpg: edge ? edge.mobrpg : null,
    });
  };

  // (source rel, type, target rel) -> the edges that say it; the machine-managed ones are left out.
  const tieKey = (from, type, to) => `${from}\u0000${type}\u0000${to}`;
  const ties = new Map();
  const own = (note) => note.edges.filter((e) => !e.mobrpg);
  for (const note of notes) {
    for (const e of own(note)) {
      if (!e.targetRel) continue;
      const key = tieKey(note.rel, e.type, e.targetRel);
      if (!ties.has(key)) ties.set(key, []);
      ties.get(key).push(e);
    }
  }
  const tiesOf = (from, type, to) => ties.get(tieKey(from, type, to)) || [];
  const targetNote = (e) => (e.targetRel ? byRel.get(e.targetRel) : undefined);

  // --- vocabulary (off-vocabulary) and tone, edge by edge ---------------------------------------
  for (const note of notes) {
    for (const e of note.edges) {
      if (!note.inScope) continue;
      const key = e.mobrpg ? 'predicate' : 'type';
      if (!vocab.has(e.type)) {
        offVocabulary(note, e, key);
      }
      if (e.mobrpg) continue;
      if (e.tone !== null && e.tone !== undefined && !toneWords.has(e.tone)) {
        const lower = toneKey(e.tone);
        const fix = toneWords.has(lower) ? lower : ontology.tone_near[lower];
        add(note, e, 'WARNING', 'tone', e.toneLine || e.line,
          `tone '${e.tone}' is off the list; ` + (fix ? `use '${fix}'` : 'pick a listed tone (shared/entity-schema.md, Tones)'),
          null);
      }
    }
  }

  function offVocabulary(note, e, key) {
    const line = e.typeLine;
    const safe = (fix) => (e.mobrpg ? null : fix);
    if (!e.type) {
      add(note, e, 'ERROR', 'off-vocabulary', line,
        `blank relationship ${key} — every edge needs a sanctioned predicate${MAP_HINT}`, null);
      return;
    }
    const problem = `off-vocabulary relationship ${key} '${e.type}'`;
    const base = inverseOf.get(e.type);
    if (base) {
      add(note, e, 'ERROR', 'off-vocabulary', line,
        `${problem} — inverse of '${base}'; storage is single-direction, so record '${base}' on the other endpoint${MAP_HINT}`,
        safe({ certain: true, choices: [base], flip: true }));
      return;
    }
    const verb = Object.prototype.hasOwnProperty.call(ontology.verbs, typeKey(e.type)) ? ontology.verbs[typeKey(e.type)] : null;
    if (verb) {
      if (verb.length === 0) {
        add(note, e, 'ERROR', 'off-vocabulary', line, `${problem} — a log reference, not a graph edge; drop it`, safe({ certain: false, choices: [] }));
      } else if (verb.length === 1) {
        add(note, e, 'ERROR', 'off-vocabulary', line,
          `${problem} — means '${verb[0].use}'${verb[0].flip ? '; store it on the other note' : ''}`,
          safe({ certain: true, choices: [verb[0].use], flip: verb[0].flip }));
      } else {
        const names = verb.map((c) => c.use + (c.flip ? ' (store on the other note)' : ''));
        add(note, e, 'ERROR', 'off-vocabulary', line, `${problem} — one of: ${names.join(', ')}`,
          safe({ certain: false, choices: verb.map((c) => c.use) }));
      }
      return;
    }
    const near = closeMatches(e.type, sortedVocabulary);
    add(note, e, 'ERROR', 'off-vocabulary', line,
      `${problem} — ${near.length ? `did you mean ${near.join(', ')}?` : 'no close match'}${MAP_HINT}`,
      safe({ certain: false, choices: near }));
  }

  // --- a symmetric tie stored on both notes, and one fact said from both ends ---------------------
  // Reported on the later note by rel order; when that note is out of scope, on the earlier one if it is in.
  const seen = new Set();
  for (const note of notes) {
    for (const e of own(note)) {
      if (!e.targetRel || e.targetRel === note.rel || !symmetric.has(e.type)) continue;
      const other = byRel.get(e.targetRel);
      const back = tiesOf(other.rel, e.type, note.rel);
      if (!back.length) continue;
      const [a, b] = note.rel < other.rel ? [note, other] : [other, note];
      const id = `${a.rel}\u0000${b.rel}\u0000${e.type}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const reportOn = b.inScope ? b : a.inScope ? a : null;
      if (!reportOn) continue;
      const elsewhere = reportOn === a ? b : a;
      for (const m of tiesOf(reportOn.rel, e.type, elsewhere.rel)) {
        add(reportOn, m, 'WARNING', 'mirrored', m.line, `'${e.type}' with ${elsewhere.name} is stored on both notes; keep one`, { certain: true });
      }
    }
  }
  for (const [x, y] of ontology.same_fact) {
    const done = new Set();
    for (const note of notes) {
      for (const e of own(note)) {
        if (e.type !== x || !e.targetRel || e.targetRel === note.rel) continue;
        const other = byRel.get(e.targetRel);
        const back = tiesOf(other.rel, y, note.rel);
        if (!back.length) continue;
        if (note.inScope) {
          add(note, e, 'WARNING', 'same-fact', e.line,
            `'${x}' ${other.name} here and '${y}' this note on ${other.name} state one fact; keep one`, { certain: false });
        } else if (other.inScope) {
          for (const b of back) {
            const id = `${other.rel}\u0000${b.index}\u0000${b.form}`;
            if (done.has(id)) continue;
            done.add(id);
            add(other, b, 'WARNING', 'same-fact', b.line,
              `'${y}' ${note.name} here and '${x}' this note on ${note.name} state one fact; keep one`, { certain: false });
          }
        }
      }
    }
  }

  // --- bidirectional, strength, a tie to a log note -----------------------------------------------
  for (const note of notes) {
    if (!note.inScope) continue;
    for (const e of own(note)) {
      if (e.form === 'list' && vocab.has(e.type)) {
        if (symmetric.has(e.type) && e.bidirectional !== true) {
          add(note, e, 'WARNING', 'bidirectional', e.line, `'${e.type}' is two-way: set bidirectional: true`, { certain: true });
        } else if (!symmetric.has(e.type) && e.bidirectional === true) {
          add(note, e, 'WARNING', 'bidirectional', e.line, `'${e.type}' is one-way: remove bidirectional: true`, { certain: true });
        }
      }
      if (e.strength !== undefined && !(typeof e.strength === 'number' && Number.isInteger(e.strength) && e.strength >= 1 && e.strength <= 10)) {
        const shown = e.strength !== null && typeof e.strength === 'object' ? JSON.stringify(e.strength) : String(e.strength);
        add(note, e, 'WARNING', 'strength', e.strengthLine || e.line, `strength '${shown}' is not a whole number from 1 to 10`, { certain: false });
      }
      const t = targetNote(e);
      if (t && notEdgeTypes.has(typeKey(t.type))) {
        add(note, e, 'WARNING', 'not-an-edge', e.line, `tie to [[${t.name}]], a session note: a log reference, not a graph edge`, { certain: false });
      }
    }
  }

  // --- the place fields and their ties ------------------------------------------------------------
  for (const note of notes) {
    if (!note.inScope) continue;
    for (const pf of ontology.place_fields) {
      const field = note.fields[pf.field];
      if (pf.stored_on === 'self') {
        const parts = own(note).filter((e) => e.type === pf.predicate && e.targetRel);
        if (field && field.target) {
          const holder = byRel.get(field.target);
          if (parts.some((e) => e.targetRel === field.target)) continue;
          if (parts.length) {
            const named = [...new Set(parts.map((e) => `[[${byRel.get(e.targetRel).name}]]`))];
            add(note, null, 'WARNING', 'place-disagrees', field.line,
              `${pf.field} names [[${holder.name}]] but ${pf.predicate} names ${named.join(', ')}`, { certain: false });
          } else {
            add(note, null, 'WARNING', 'place-missing-tie', field.line,
              `${pf.field} names [[${holder.name}]] but there is no ${pf.predicate} tie to it`, { certain: true, choices: [holder.name] });
          }
        } else if (!field && pf.field === 'parent_location' && typeKey(note.type) === 'location') {
          // parent_location is a Location field; a faction's part_of has its own scalar.
          const places = [...new Set(parts.map((e) => e.targetRel))];
          if (places.length === 1) {
            const e = parts.find((p) => p.targetRel === places[0]);
            add(note, e, 'WARNING', 'place-missing-field', e.line,
              `${pf.predicate} [[${byRel.get(places[0]).name}]] but no ${pf.field}`, { certain: true, choices: [byRel.get(places[0]).name] });
          }
        }
      } else if (field && field.target) {
        // stored on the named note: current_holder wants an owns tie on the holder that names this note.
        const holder = byRel.get(field.target);
        if (!tiesOf(holder.rel, pf.predicate, note.rel).length) {
          add(note, null, 'WARNING', 'place-missing-tie', field.line,
            `${pf.field} names [[${holder.name}]] but [[${holder.name}]] has no ${pf.predicate} tie to this note`, { certain: true, choices: [holder.name] });
        }
      }
    }
  }

  // --- a genre subset: a type the vocabulary has but this vault's own list does not ---------------
  if (listed.subset) {
    for (const note of notes) {
      if (!note.inScope) continue;
      for (const e of own(note)) {
        if (vocab.has(e.type) && !listed.types.has(e.type)) {
          add(note, e, 'INFO', 'genre-subset', e.typeLine,
            `'${e.type}' is in the vocabulary but not in this vault's _meta/relationship-types.md`, null);
        }
      }
    }
  }

  // --- a container that lists would-be children as points of interest (prose mentions of a neighbour are not) ---------------------------------------------------
  const partOfTargets = (note) => own(note).filter((e) => e.type === 'part_of' && e.targetRel).map((e) => e.targetRel);
  const ancestors = (note) => {
    const found = new Set();
    const walk = (rel) => {
      for (const up of partOfTargets(byRel.get(rel))) if (!found.has(up) && byRel.has(up)) { found.add(up); walk(up); }
    };
    walk(note.rel);
    return found;
  };
  for (const note of notes) {
    if (!note.inScope) continue;
    const parents = own(note).filter((e) => e.type === 'part_of' && e.targetRel);
    if (!parents.length || !note.poiLinks.length) continue;
    const up = ancestors(note);
    const seenParent = new Set();
    for (const parentEdge of parents) {
      const parent = byRel.get(parentEdge.targetRel);
      // Containment is a part_of between notes of one kind (a place in a place, a faction in a faction); a person
      // part_of a group is membership, and a person's links are not children.
      if (seenParent.has(parent.rel) || !note.type || parent.type !== note.type) continue;
      seenParent.add(parent.rel);
      const candidates = [];
      for (const name of note.poiLinks) {
        const rel = model.resolve(name);
        const child = rel && byRel.get(rel);
        if (!child || child === note || up.has(child.rel) || candidates.includes(child)) continue;
        if (!child.type || child.type !== note.type) continue; // a container's children are the same kind of note
        const own1 = partOfTargets(child);
        if (own1.includes(note.rel)) continue;
        if (own1.some((r) => r !== parent.rel)) continue;
        const field = child.fields.parent_location;
        if (field && field.target && field.target !== parent.rel) continue;
        if (field && field.target === note.rel) continue;
        candidates.push(child);
      }
      if (candidates.length) {
        const names = candidates.map((c) => c.name);
        add(note, parentEdge, 'INFO', 'childless-container', parentEdge.line,
          `${note.name} is part_of ${parent.name} and lists ${names.join(', ')} as points of interest, which are part_of ${parent.name} or unplaced: should they be part_of ${note.name}?`,
          { certain: false, choices: names });
      }
    }
  }

  // --- a hub: more ties than 2 SD above the mean of its type --------------------------------------
  const degree = new Map(notes.map((n) => [n.rel, own(n).length]));
  for (const note of notes) {
    for (const e of own(note)) if (e.targetRel && degree.has(e.targetRel)) degree.set(e.targetRel, degree.get(e.targetRel) + 1);
  }
  const byType = new Map();
  for (const note of notes) {
    if (!note.type) continue;
    if (!byType.has(note.type)) byType.set(note.type, []);
    byType.get(note.type).push(note);
  }
  for (const [type, group] of byType) {
    if (group.length < HUB_MIN_NOTES) continue;
    const counts = group.map((n) => degree.get(n.rel));
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length);
    for (const note of group) {
      const n = degree.get(note.rel);
      if (note.inScope && n >= HUB_MIN_TIES && n > mean + 2 * sd) {
        add(note, null, 'INFO', 'hub', 1, `${n} ties; notes of type ${type} average ${mean.toFixed(1)}`, null);
      }
    }
  }

  // A note whose frontmatter does not read has no edges to check; it is one row, so it never looks clean.
  for (const fault of model.faults || []) {
    if (!fault.inScope) continue;
    out.push({
      level: 'ERROR', rel: fault.rel, line: 1, kind: 'unreadable',
      message: `its frontmatter does not read (${String(fault.message).replace(/\s+/g, ' ').trim()}); its relationships were not checked`,
      fix: null, edgeIndex: null, form: null, mobrpg: null,
    });
  }

  const rank = (f) => KIND_ORDER.indexOf(f.kind);
  return out
    .map((f, i) => [f, i])
    .sort((p, q) => (p[0].rel < q[0].rel ? -1 : p[0].rel > q[0].rel ? 1 : 0)
      || (p[0].line - q[0].line) || (rank(p[0]) - rank(q[0])) || (p[1] - q[1]))
    .map(([f]) => f);
}

function render(findings) {
  return [`# count: ${findings.length}`, ...findings.map((f) => `${f.level}\t${f.rel}:${f.line}\t${f.message}`)].join('\n');
}

module.exports = { check, render, closeMatches };
