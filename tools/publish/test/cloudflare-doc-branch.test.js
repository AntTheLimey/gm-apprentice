'use strict';
// CodeRabbit: the by-hand wrangler deploy in the Cloudflare guide must send to main, as gm-publish deploy does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every by-hand `npx wrangler@4 pages deploy` command in the Cloudflare guide names --branch=main', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../../../skills/publish-site/references/cloudflare-pages.md'), 'utf8');
  const lines = doc.split('\n').filter((l) => /^npx wrangler@4 pages deploy\b/.test(l));
  assert.ok(lines.length >= 2, 'expected the two by-hand deploy commands');
  for (const l of lines) assert.match(l, /--branch=main/, l);
});
