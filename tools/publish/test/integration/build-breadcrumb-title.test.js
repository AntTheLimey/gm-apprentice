'use strict';
// Ruling 48: a page's last breadcrumb is the page's own title, from the same source as its heading (`title:`), not
// its file name title-cased. A note with no `title:` keeps the crumb it always had.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');

const crumbsOf = (html) => {
  const m = /<nav class="breadcrumbs" aria-label="Breadcrumb">([\s\S]*?)<\/nav>/.exec(html);
  return m ? m[1] : null;
};
const pageOf = (site, re) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/')).find((r) => re.test(r));

describe('the last breadcrumb', () => {
  const s = buildBoth({
    'Documents/pratap-introduction-letter.md': '---\ntype: document\ntitle: "Pratap\'s Letter of Introduction"\n---\nA letter.\n',
    'Documents/the_old_ledger.md': '---\ntype: document\n---\nA ledger.\n',
    'Documents/Props/pratap-paper.md': '---\ntype: prop\ntitle: The Pratap Paper\n---\nA paper.\n',
  });
  after(() => s.cleanup());

  it('is the title: a note gives, as its heading shows it', () => {
    for (const site of [s.player, s.gm]) {
      for (const [re, title] of [[/pratap-introduction-letter\.html$/, 'Pratap&#39;s Letter of Introduction'], [/pratap-paper\.html$/, 'The Pratap Paper']]) {
        const rel = pageOf(site, re);
        assert.ok(rel, re.source);
        const crumbs = crumbsOf(site.read(...rel.split('/')));
        assert.ok(crumbs, rel);
        const last = crumbs.split('<span class="sep">&rsaquo;</span>').pop();
        assert.ok([title, title.replace('&#39;', "'"), title.replace('&#39;', '&#x27;')].includes(last), `${rel}: ${last}`);
      }
    }
  });

  it('a note with no title: keeps the file name title-cased, as before', () => {
    const rel = pageOf(s.player, /the-old-ledger\.html$/);
    const crumbs = crumbsOf(s.player.read(...rel.split('/')));
    assert.equal(crumbs.split('<span class="sep">&rsaquo;</span>').pop(), 'The Old Ledger');
  });
});
