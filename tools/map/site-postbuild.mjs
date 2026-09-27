#!/usr/bin/env node
// Post-build step: publish the interactive star map at docs/map/.
// Stopgap until the map is built inside tools/publish (issue #250); wire it as a
// site "postbuild" script, and note that `deploy` skips postbuild (#248).
//
// 1. Rebuilds the PLAYER-SAFE map from the vault (build_map.py --player strips
//    Keeper callouts, secrets, gm-only/spoiler blocks and publish:false notes).
//    If the rebuild can't run, the last player build is used, never the GM copy.
// 2. Injects SITE_PAGES (note name -> published page) so the map's "Open page"
//    buttons land on wiki pages. Only pages present in docs/ are listed.
// 3. Adds "Star Map" under World in every page's nav.
// Like apply-overrides.mjs, it only touches generated docs/ output.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd(); // the site project
const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(ROOT, "docs");
const config = JSON.parse(readFileSync(join(ROOT, "vault.config.json"), "utf8"));
const MAPDIR = join(config.vaultPath, "_meta/map");
const BUILDER = process.env.GM_MAP_BUILDER || join(HERE, "build_map.py");
const PLAYER_MAP = join(MAPDIR, "star-map-player.html");

if (!existsSync(DOCS)) {
  console.warn("add-star-map: docs/ not found (run the build first) — skipping");
  process.exit(0);
}

if (existsSync(BUILDER)) {
  const r = spawnSync("python3", [BUILDER, "--vault", config.vaultPath, "--player"], { encoding: "utf8" });
  if (r.status === 0) console.log("add-star-map: " + r.stdout.split("\n")[0]);
  else console.warn("add-star-map: player map rebuild failed, using the last player build\n" + (r.stderr || r.error || ""));
}
if (!existsSync(PLAYER_MAP)) {
  console.warn("add-star-map: no star-map-player.html in the vault — skipping");
  process.exit(0);
}

const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "map") walk(p); }
    else if (f.endsWith(".html")) pages.push(p);
  }
})(DOCS);

// Note name -> page, from each page's <title>Name — Site Title</title>. Entity folders
// win when two pages share a title; for sessions the story-mode recap beats the chronicle entry.
const suffix = ` — ${config.siteTitle || ""}`;
const sitePages = {};
const rank = p => (/[\\/](locations|characters|factions|items|creatures|world)[\\/]/.test(p) ? 0 : /[\\/]story[\\/]/.test(p) ? 1 : 2);
for (const p of pages.sort((a, b) => rank(a) - rank(b))) {
  const m = /<title>([^<]*)<\/title>/.exec(readFileSync(p, "utf8"));
  if (!m) continue;
  const name = m[1].replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(suffix, "").trim();
  if (name && !(name in sitePages)) sitePages[name] = relative(DOCS, p).split(sep).join("/");
}

let html = readFileSync(PLAYER_MAP, "utf8");
if (!html.includes('"player": true')) {
  console.error("add-star-map: star-map-player.html is not a player build — refusing to publish it");
  process.exit(1);
}
const inject = `<script>window.SITE_PAGES = ${JSON.stringify(sitePages)};</script>\n<script>window.MAP_DATA =`;
html = html.replace("<script>window.MAP_DATA =", inject);
mkdirSync(join(DOCS, "map"), { recursive: true });
writeFileSync(join(DOCS, "map/index.html"), html);

let linked = 0;
for (const p of pages) {
  const src = readFileSync(p, "utf8");
  if (src.includes('map/index.html">Star Map</a>')) continue;
  const out = src.replace(/(<a href="((?:\.\.\/)*)world\/index\.html">World Overview<\/a>)/g,
    (_, a, up) => `${a}\n        <a href="${up}map/index.html">Star Map</a>`);
  if (out !== src) { writeFileSync(p, out); linked++; }
}
console.log(`add-star-map: docs/map/index.html (${Object.keys(sitePages).length} pages linkable); nav link added to ${linked} pages`);
