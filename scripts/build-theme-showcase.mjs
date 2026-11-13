#!/usr/bin/env node
// Build the theme showcase: the benchmark campaign rendered once per
// theme preset, plus a gallery index. Local preview:
//   node scripts/build-theme-showcase.mjs --out showcase
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = require(path.join(repoRoot, 'tools/publish/lib/build.js'));
const YAML = require(path.join(repoRoot, 'tools/publish/node_modules/yaml'));

const PRESETS = [
  { id: 'fantasy',  name: 'Fantasy',  blurb: 'D&D, Pathfinder, classic fantasy', swatches: ['#1a1a2e', '#fbbf24', '#c8d6e5'] },
  { id: 'horror',   name: 'Horror',   blurb: 'CoC, gothic horror, dark mystery', swatches: ['#1a1410', '#c9a55a', '#d4c5a9'] },
  { id: 'military', name: 'Military', blurb: 'Tactical, modern ops',             swatches: ['#1a1f16', '#4ade80', '#bfc9b8'] },
  { id: 'noir',     name: 'Noir',     blurb: 'Blades in the Dark, crime, heist', swatches: ['#0d0d0d', '#c084fc', '#b0b0b0'] },
  { id: 'scifi',    name: 'Sci-fi',   blurb: 'Worn space-noir, hard SF, station crawls', swatches: ['#0d0b0a', '#f0a23a', '#3fd0d8'] },
];

const outArgIdx = process.argv.indexOf('--out');
const outDir = path.resolve(outArgIdx >= 0 ? process.argv[outArgIdx + 1] : 'showcase');
const sourceVault = path.join(repoRoot, 'tests/benchmark-campaign');

if (outDir === path.parse(outDir).root) {
  throw new Error(`Refusing to clean filesystem root: ${outDir}`);
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Build warnings that are known and accepted. Any other warning stops the showcase, so a preset that
// quietly lost its theme (a mistyped genre, a missing image) is never deployed.
const ALLOWED_WARNINGS = [/^Custom fonts .* are loaded from Google Fonts/];
// The unresolved wikilinks the fixture plants on purpose (note + target), read by the fixture's own test too.
const PLANTED_LINKS = new Set(JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/benchmark-planted-links.json'), 'utf8')));
const { runSiteDoctor } = require(path.join(repoRoot, 'tools/publish/lib/site-doctor.js'));
const unexpected = [];

for (const preset of PRESETS) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `showcase-${preset.id}-`));
  try {
    const vaultDir = path.join(work, 'vault');
    fs.cpSync(sourceVault, vaultDir, { recursive: true });
    // The campaign's own settings (folder map, hidden folders) stay as the vault holds them;
    // only what changes per preset is written over them, in the vault's settings file.
    const settingsPath = path.join(vaultDir, '_meta', 'vault-config.yaml');
    const settings = YAML.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.player_site = {
      ...settings.player_site,
      title: `The Ashford Case — ${preset.name}`,
      host: 'github-pages',
      url: 'https://antthelimey.github.io/gm-apprentice',
      theme: { genre: preset.id, tagline: `gm-apprentice publish theme: ${preset.name}` },
    };
    fs.writeFileSync(settingsPath, YAML.stringify(settings));

    // The site folder's vault.config.json only says where the vault is.
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vaultDir }, null, 2));

    console.log(`\n=== Building ${preset.name} showcase ===`);
    const { warnings = [] } = build({ configPath });
    for (const w of warnings) if (!ALLOWED_WARNINGS.some((re) => re.test(w))) unexpected.push(`${preset.name}: ${w}`);

    // The site's own audit says which wikilinks match no published page; only the planted ones may remain.
    let audit = '';
    await runSiteDoctor({ configPath, json: true }, { out: (t) => { audit += t; } });
    for (const f of JSON.parse(audit).findings) {
      if (f.code === 'LINK_UNRESOLVED') {
        const link = /^(\[\[[^\]]*\]\])/.exec(f.detail);
        const id = `${f.path}: ${link ? link[1] : f.detail}`;
        if (!PLANTED_LINKS.has(id)) unexpected.push(`${preset.name}: unresolved link ${id}`);
      } else if (f.severity === 'error') {
        unexpected.push(`${preset.name}: site audit ${f.code} ${f.path}: ${f.detail}`);
      }
    }
    fs.cpSync(path.join(work, 'docs'), path.join(outDir, preset.id), { recursive: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (unexpected.length) {
  console.error(`\nThe showcase build warned:\n${unexpected.map((w) => `  ${w}`).join('\n')}`);
  process.exit(1);
}

const cards = PRESETS.map(p => `    <a class="theme-card" href="${p.id}/index.html">
      <div class="swatches">${p.swatches.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <h2>${p.name}</h2>
      <p>${p.blurb}</p>
    </a>`).join('\n');

fs.writeFileSync(path.join(outDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gm-apprentice — Theme Showcase</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #14161a; color: #dfe4ea; }
  main { max-width: 60rem; margin: 0 auto; padding: 3rem 1.5rem; }
  h1 { font-size: 1.6rem; } p.lead { color: #9aa3ad; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; margin-top: 2rem; }
  .theme-card { display: block; padding: 1.25rem; border: 1px solid #2a2f36; border-radius: 0.5rem;
    background: #1b1e23; color: inherit; text-decoration: none; }
  .theme-card:hover { border-color: #4a5058; }
  .theme-card h2 { margin: 0.75rem 0 0.25rem; font-size: 1.1rem; }
  .theme-card p { margin: 0; color: #9aa3ad; font-size: 0.85rem; }
  .swatches span { display: inline-block; width: 1.5rem; height: 1.5rem; border-radius: 0.25rem;
    margin-right: 0.35rem; border: 1px solid #2a2f36; }
</style>
</head>
<body>
<main>
  <h1>gm-apprentice — Theme Showcase</h1>
  <p class="lead">The same benchmark campaign built once per theme preset.
  Set <code>player_site.theme.genre</code> in your vault's <code>_meta/vault-config.yaml</code>.</p>
  <div class="grid">
${cards}
  </div>
</main>
</body>
</html>
`);

console.log(`\nShowcase written to ${outDir}`);
