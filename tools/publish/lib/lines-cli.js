'use strict';

// `lines` command: answer, for text handed in on stdin, what the build would publish.
//
// vault_check (Python) has to know which lines of a note reach the site: its leak
// checks scan only those, and its writers refuse a repair that would publish a line
// that was hidden. It used to keep its own copy of the strip chain and the section
// filter, held "line for line" with processor.js by hand. This command is that
// knowledge asked for instead of copied: every answer comes from the functions the
// build itself calls, so there is nothing to drift.
//
// One JSON request per input line, one JSON answer per output line, in order, until
// stdin closes. A caller with many notes keeps one process open for its whole run.
//
//   {"op":"published","text":…,"excludeSections":[…],"publish":"all|stub|none","include":[…]}
//       -> {"text":…}        the body the site renders (the `publish:` gate, then
//                            playerSafeMarkdown), exclude list only
//   {"op":"sections","text":…,"excludeSections":[…]}
//       -> {"withheldBy":[…]}  per line of `text`: the excluded section that
//                            withholds it, or null
//   {"op":"stub","text":…,"include":[…],"excludeSections":[…]}
//       -> {"kept":[…]}      per line of `text`: whether a `publish: stub` page with
//                            these `publish_include_sections` keeps it. A line in a
//                            gm-only block, a spoiler block or a comment is not kept;
//                            nor, when `excludeSections` is given, one it withholds
//
//   {"op":"withheld","text":…}
//       -> {"withheld":…,"names":[…]}  for a whole note: whether the build reads it as withheld (its YAML reader, its
//                            flag rule), and the names its title, aliases and gm_aliases give it, as the build reads them
//
//   {"op":"cut","text":…}
//       -> {"cut":[…]}       per line of `text`: the line as the strip chain leaves it
//                            (the build's own: gm-only, spoiler, HTML and %% comments),
//                            or null when the chain removes it; and {"unbalanced":[…]}, each
//                            gm-only or spoiler marker the block strips found unbalanced:
//                            {line (of `text`), marker, close}, a closer with nothing open
//                            or an opener never closed (a tool older than #441 leaves it out).
//   {"op":"cut","text":…,"excludeSections":[…],"type":…,"pcKeepSections":[…]|null,"excludeCallouts":…}
//       -> also {"withheldBy":[…]}  with the page's section rules (`excludeSections` given; `type`, the note's
//                            `type:`; `pcKeepSections` while sheets are off; `excludeCallouts`, the hidden callouts,
//                            true or a list of types): the hidden callouts are cut too, and per line of `text` the
//                            section that withholds it, or null, as the build reads it (#447: a withheld heading
//                            in a hidden block withholds the text after the block). A tool older than that answers
//                            without `withheldBy`.
//                            vault_check's gm-leak reads a note's lines from this answer
//                            (`build_lines`), not from a model of its own
//
//   {"op":"site","vault":…}
//       -> {"publishes":…,"site":…,"siteDir":…}  whether the vault's settings have the site's
//                            block (`player_site:`; `publish:` on the old file), whether the vault
//                            has a site (`player_site.publish`; unset, a folder says yes), and the
//                            site folder `player_site.folder` names (an absolute path; null when the site is off or no
//                            folder is named, which for a site that is on means it is still
//                            to be set up). Read with the build's own YAML parser, so
//                            vault_check does not read that file a second way.
//
//   {"op":"google-fonts","vault":…,"config":…}
//       -> {"families":[…]}  the families the site would load from Google for the vault
//                            (`config`, the site's vault.config.json, is optional); none
//                            when the fonts are hosted.
//
// A request that cannot be answered gets {"error":…}; the process carries on.
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSettings, nameIn, fileLabel, layoutOf } = require('./settings');
const { cutLines, playerSafeMarkdown, keepOnlySections, keptSectionFlags, sectionVerdicts, isWithheld, nameList, gmAliasList } = require('./processor');
const { parseNote } = require('./frontmatter');
const { labelsForLinks } = require('./wikilink');

// A request is checked, not coerced: a list that is not a list read as "no list"
// would answer "nothing is withheld".
function list(request, key) {
  const value = request[key];
  if (!Array.isArray(value) || value.some((s) => typeof s !== 'string')) {
    throw new Error(`${key} must be a list of strings`);
  }
  return value;
}

// What the vault's settings file says about publishing, from one read through the settings
// package. A file that is not there says nothing publishes; one that cannot be parsed is
// an error (the reader throws it), not a "no".
function site(vault) {
  if (typeof vault !== 'string' || vault === '') throw new Error('vault must be a path');
  const { values, origins, faults, file } = readSettings({ vaultPath: vault, siteConfig: {} });
  if (!file.exists || !file.hasSiteBlock) {
    // A stray `publish` at the top: on the old file it is the block of settings, written as something
    // else; on the new file it is not a setting at all, the site's settings go under player_site.
    if (faults.some((f) => f.name === 'publish')) {
      throw new Error(layoutOf(vault) === 'new'
        ? `publish in ${fileLabel(vault)} is not a setting; the site's settings go under player_site`
        : `publish: in ${fileLabel(vault)} is not a block of settings`);
    }
    return { publishes: false, site: false, siteDir: null };
  }
  // `publish.site` is the switch, decided where the build decides it. Off: there is no
  // site, whatever site_dir says. Unset, in a vault written before the switch, a site_dir
  // says on. An unreadable value is off, as for the other switches.
  const on = values.player_site.publish;
  const raw = values.player_site.folder;
  const origin = origins['player_site.folder'];
  const blank = origin === 'default' || (typeof raw === 'string' && raw.trim() === '');
  if (!on || blank) return { publishes: true, site: on, siteDir: null };
  if (origin === 'fault' || typeof raw !== 'string') throw new Error(`${nameIn(vault, 'player_site.folder')} in ${fileLabel(vault)} is not a path`);
  return { publishes: true, site: true, siteDir: siteDirPath(vault, raw) };
}

// The folder a `publish.site_dir` value names: `~` is the home folder (`~/` or `~\`), and a relative
// path is taken from the vault. `init` and `update-pin` compare sites through this too.
function siteDirPath(vault, raw) {
  const text = raw.trim();
  const expanded = text === '~' || text.startsWith('~/') || text.startsWith('~\\') ? path.join(os.homedir(), text.slice(1)) : text;
  return path.resolve(vault, expanded);
}

function googleFonts(vault, config) {
  if (typeof vault !== 'string' || vault === '') throw new Error('vault must be a path');
  if (config !== undefined && config !== null && (typeof config !== 'string' || config === '')) throw new Error('config must be a path');
  const { loadVaultConfig } = require('./config');
  const file = config ? path.resolve(config) : null;
  const siteConfig = file && fs.existsSync(file) ? loadVaultConfig(file) : {};
  return { families: require('./fonts').googleFontsFor(path.resolve(vault), siteConfig) };
}

function answer(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('a request is a JSON object');
  if (request.op === 'site') return site(request.vault);
  if (request.op === 'google-fonts') return googleFonts(request.vault, request.config);
  if (typeof request.text !== 'string') throw new Error('text must be a string');
  const { text } = request;
  switch (request.op) {
    case 'published': {
      const publish = request.publish === undefined ? 'all' : request.publish;
      if (!['all', 'stub', 'none'].includes(publish)) throw new Error('publish must be all, stub or none');
      const excludeSections = list(request, 'excludeSections');
      const include = publish === 'stub' ? list(request, 'include') : [];
      if (publish === 'none') return { text: '' };
      // The stub reduction runs first, as in the build (see sheet-cli playerSafeBody).
      const body = publish === 'stub' ? keepOnlySections(text, include, { excludeSections }) : text;
      return { text: playerSafeMarkdown(body, { excludeSections }).text };
    }
    case 'sections':
      return { withheldBy: sectionVerdicts(text, list(request, 'excludeSections')) };
    case 'stub':
      return { kept: keptSectionFlags(text, list(request, 'include'),
        { excludeSections: request.excludeSections === undefined ? [] : list(request, 'excludeSections') }) };
    case 'withheld': {
      let fm;
      try { fm = parseNote(text).data || {}; } catch (e) { throw new Error(`the frontmatter cannot be read (${String(e.message).split('\n')[0]})`); }
      const title = typeof fm.title === 'string' ? labelsForLinks(fm.title).trim() : '';
      return { withheld: isWithheld(fm), names: [...(title ? [title] : []), ...nameList(fm.aliases), ...gmAliasList(fm)] };
    }
    case 'cut': {
      // The page's section rules, when they are asked about: `excludeSections` says they are.
      if (request.excludeSections === undefined) return cutLines(text);
      const type = request.type;
      if (type !== undefined && type !== null && typeof type !== 'string') throw new Error('type must be a string');
      const callouts = request.excludeCallouts === undefined ? false : request.excludeCallouts;
      if (typeof callouts !== 'boolean') list(request, 'excludeCallouts');
      return cutLines(text, {
        excludeSections: list(request, 'excludeSections'),
        frontmatter: type ? { type } : null,
        pcKeepSections: request.pcKeepSections === undefined || request.pcKeepSections === null ? null : list(request, 'pcKeepSections'),
        excludeCallouts: callouts,
      });
    }
    default:
      throw new Error(`unknown op: ${JSON.stringify(request.op)}`);
  }
}

function answerLine(line) {
  try {
    return JSON.stringify(answer(JSON.parse(line)));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// Resolves 0 when stdin closes. `deps.input` / `deps.write` are test seams.
// Requests are split on `\n` alone: readline also breaks at U+2028 and U+2029, which
// are legal inside a JSON string, and one split request would put every later answer
// out of step with its question.
function runLines(deps) {
  const d = deps || {};
  const input = d.input || process.stdin;
  const write = d.write || ((s) => process.stdout.write(s));
  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const take = (line) => {
      const request = line.replace(/\r$/, '');
      if (request.trim() !== '') write(`${answerLine(request)}\n`);
    };
    input.on('data', (chunk) => {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let at;
      while ((at = pending.indexOf('\n')) !== -1) {
        take(pending.slice(0, at));
        pending = pending.slice(at + 1);
      }
    });
    input.on('end', () => {
      take(pending + decoder.end());
      resolve(0);
    });
  });
}

module.exports = { runLines, answer, answerLine, siteDirPath };
