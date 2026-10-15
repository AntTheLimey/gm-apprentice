'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, hashTree } = require('../helpers/leak-site');
const { runDeploy } = require('../../lib/deploy-cli');

const NOTES = {
  '_meta/publish-list.yaml': 'publishing:\n  - NPCs/A.md\n',
  'NPCs/A.md': '---\ntype: npc\n---\nA baker.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n',
};

// The step runs after the build, in the site folder (where leak.js is written below), and writes the hidden text back.
const LEAK_JS =
  "const fs=require('fs');const p=require('path').join(process.env.GM_APPRENTICE_OUTPUT,'npcs','a.html');" +
  "fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('</main>','<p>The baker poisoned the mayor last winter.</p></main>'));";

function deps(uploads, out) {
  return {
    out: (l) => out.push(String(l)),
    // The real build with its steps, without the font fetch the default build starts with.
    build: async (o) => require('../../lib/build').build({ ...o, runSteps: true }),
    runWrangler: (args) => { uploads.push(args); return { code: 0, stdout: '', stderr: '' }; },
    runCommand: (cmd, args) => { uploads.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; },
    fetchStatus: async () => 200, sleep: async () => {},
  };
}

it('a build step that writes hidden text back is caught, and the site is left as built', async () => {
  const site = leakSite(NOTES, { player: { folder_map: { NPCs: 'npcs' }, after_build: ['node leak.js'] } });
  const saved = { log: console.log, warn: console.warn };
  try {
    fs.writeFileSync(path.join(path.dirname(site.configPath), 'leak.js'), LEAK_JS);
    const uploads = [];
    const out = [];
    console.log = () => {}; console.warn = () => {};
    let rc;
    try { rc = await runDeploy({ configPath: site.configPath }, deps(uploads, out)); } finally { Object.assign(console, saved); }
    assert.equal(rc, 1, out.join('\n'));
    assert.ok(!uploads.some((a) => a.includes('push') || (a[0] === 'pages' && a[1] === 'deploy')), JSON.stringify(uploads));
    assert.match(out.join('\n'), /npcs\/a\.html: "The baker poisoned the mayor last winter\."/);
    const before = hashTree(site.outputDir);
    const dry = [];
    assert.equal(await runDeploy({ configPath: site.configPath, dryRun: true }, deps([], dry)), 1);
    assert.match(dry.join('\n'), /would stop/i);
    assert.equal(hashTree(site.outputDir), before);
  } finally { Object.assign(console, saved); site.cleanup(); }
});

it('the same vault without the step deploys', async () => {
  const site = leakSite(NOTES, { player: { folder_map: { NPCs: 'npcs' } } });
  const saved = { log: console.log, warn: console.warn };
  try {
    const uploads = [];
    const out = [];
    console.log = () => {}; console.warn = () => {};
    let rc;
    try { rc = await runDeploy({ configPath: site.configPath }, deps(uploads, out)); } finally { Object.assign(console, saved); }
    assert.equal(rc, 0, out.join('\n'));
    assert.match(out.join('\n'), /Leak check: nothing hidden/);
  } finally { Object.assign(console, saved); site.cleanup(); }
});
