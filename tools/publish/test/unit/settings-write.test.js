'use strict';
// The one writer: every case runs on the new file and on the old file's frontmatter, and asserts the whole text.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyChanges } = require('../../lib/settings/write');
const { NEW_FILE, OLD_FILE, at } = require('../../lib/settings/layout');

const BODY = '\n# Notes\n\nSome prose of the GM.\n';

function vaultWith(rel, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-'));
  const file = at(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { dir, file, read: () => fs.readFileSync(file, 'utf8') };
}

// Runs `change` on the new-layout text and on the legacy frontmatter text, checks both whole texts.
function both(name, { nw, old, changes, newOut, oldOut, eol = '\n' }) {
  it(`${name} (new file)`, () => {
    const v = vaultWith(NEW_FILE, nw);
    applyChanges(v.dir, changes.new);
    assert.strictEqual(v.read(), newOut);
  });
  it(`${name} (old file)`, () => {
    const v = vaultWith(OLD_FILE, `---${eol}${old}---${BODY.replace(/\n/g, eol)}`);
    applyChanges(v.dir, changes.old || changes.new);
    assert.strictEqual(v.read(), `---${eol}${oldOut}---${BODY.replace(/\n/g, eol)}`);
  });
}

const SEC = 'player_site.hide.sections';
const FLD = 'player_site.hide.fields';

describe('settings writer: comments and lists', () => {
  both('a comment on the key line of a list survives set', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    sections:  # mine\n      - a\n      - b\n',
    old: 'publish:\n  exclude_sections:  # mine\n    - a\n    - b\n',
    changes: { new: [{ op: 'set', name: SEC, value: ['x', 'y'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    sections:  # mine\n      - x\n      - y\n',
    oldOut: 'publish:\n  exclude_sections:  # mine\n    - x\n    - y\n',
  });
  both('a comment on the key line of a list survives add', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    sections:  # mine\n      - a\n',
    old: 'publish:\n  exclude_sections:  # mine\n    - a\n',
    changes: { new: [{ op: 'add', name: SEC, entries: ['b'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    sections:  # mine\n      - a\n      - b\n',
    oldOut: 'publish:\n  exclude_sections:  # mine\n    - a\n    - b\n',
  });
  both('item comments survive add of another item', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    sections:\n      - a  # one\n      - b  # two\n    fields: [q]\n',
    old: 'publish:\n  exclude_sections:\n    - a  # one\n    - b  # two\n  exclude_fields: [q]\n',
    changes: { new: [{ op: 'add', name: SEC, entries: ['c'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    sections:\n      - a  # one\n      - b  # two\n      - c\n    fields: [q]\n',
    oldOut: 'publish:\n  exclude_sections:\n    - a  # one\n    - b  # two\n    - c\n  exclude_fields: [q]\n',
  });
  both('item comments survive remove of another item', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    sections:\n      - a  # one\n      - b  # two\n      - c  # three\n',
    old: 'publish:\n  exclude_sections:\n    - a  # one\n    - b  # two\n    - c  # three\n',
    changes: { new: [{ op: 'remove', name: SEC, entries: ['b'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    sections:\n      - a  # one\n      - c  # three\n',
    oldOut: 'publish:\n  exclude_sections:\n    - a  # one\n    - c  # three\n',
  });
  both('a flow list stays a flow list after add', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    fields: [a, b]\n',
    old: 'publish:\n  exclude_fields: [a, b]\n',
    changes: { new: [{ op: 'add', name: FLD, entries: ['c'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    fields: [a, b, c]\n',
    oldOut: 'publish:\n  exclude_fields: [a, b, c]\n',
  });
  both('a block list stays a block list after add', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    fields:\n    - a\n',
    old: 'publish:\n  exclude_fields:\n  - a\n',
    changes: { new: [{ op: 'add', name: FLD, entries: ['c'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    fields:\n    - a\n    - c\n',
    oldOut: 'publish:\n  exclude_fields:\n  - a\n  - c\n',
  });
  both('removing the last entry leaves an empty list, not an empty key', {
    nw: 'version: 1\nplayer_site:\n  hide:\n    sections:  # mine\n      - a\n    fields: [q]\n',
    old: 'publish:\n  exclude_sections:  # mine\n    - a\n  exclude_fields: [q]\n',
    changes: { new: [{ op: 'remove', name: SEC, entries: ['a'] }] },
    newOut: 'version: 1\nplayer_site:\n  hide:\n    sections: []  # mine\n    fields: [q]\n',
    oldOut: 'publish:\n  exclude_sections: []  # mine\n  exclude_fields: [q]\n',
  });
});

describe('settings writer: where things go', () => {
  both('set of an existing key leaves it where it is, and keeps its comment', {
    nw: 'version: 1\nplayer_site:\n  title: Old   # the name\n  footer: f\n',
    old: 'publish:\n  site_title: Old   # the name\n  footer: f\n',
    changes: { new: [{ op: 'set', name: 'player_site.title', value: 'New' }] },
    newOut: 'version: 1\nplayer_site:\n  title: New   # the name\n  footer: f\n',
    oldOut: 'publish:\n  site_title: New   # the name\n  footer: f\n',
  });
  both('a new key goes at the end of its group, a new group at the end of its parent', {
    nw: 'version: 1\nvault:\n  system: gurps\nplayer_site:\n  title: T  # t\n',
    old: 'type: meta\npublish:\n  site_title: T  # t\n',
    changes: { new: [{ op: 'set', name: 'player_site.footer', value: 'F' }, { op: 'set', name: 'player_site.theme.tagline', value: 'Hi' }] },
    newOut: 'version: 1\nvault:\n  system: gurps\nplayer_site:\n  title: T  # t\n  footer: F\n  theme:\n    tagline: Hi\n',
    oldOut: 'type: meta\npublish:\n  site_title: T  # t\n  footer: F\n  theme:\n    tagline: Hi\n',
  });
  both('a new group is made when the parent has none', {
    nw: 'version: 1\n',
    old: 'type: meta\n',
    changes: { new: [{ op: 'set', name: 'player_site.title', value: 'T' }] },
    newOut: 'version: 1\nplayer_site:\n  title: T\n',
    oldOut: 'type: meta\npublish:\n  site_title: T\n',
  });
  both('four-space indentation is kept for new lines', {
    nw: 'version: 1\nplayer_site:\n    title: T\n    hide:\n        sections: [a]\n',
    old: 'publish:\n    site_title: T\n',
    changes: { new: [{ op: 'set', name: 'player_site.footer', value: 'F' }] },
    newOut: 'version: 1\nplayer_site:\n    title: T\n    hide:\n        sections: [a]\n    footer: F\n',
    oldOut: 'publish:\n    site_title: T\n    footer: F\n',
  });
});

describe('settings writer: values', () => {
  both('a quoted value stays quoted; a number given to a text setting is text', {
    nw: 'version: 1\nplayer_site:\n  title: "Quoted"\n  footer: plain\n',
    old: 'publish:\n  site_title: "Quoted"\n  footer: plain\n',
    changes: { new: [{ op: 'set', name: 'player_site.title', value: 'Other' }, { op: 'set', name: 'player_site.footer', value: 5 }] },
    newOut: 'version: 1\nplayer_site:\n  title: "Other"\n  footer: "5"\n',
    oldOut: 'publish:\n  site_title: "Other"\n  footer: "5"\n',
  });
  both('a text setting given yes is written as text', {
    nw: 'version: 1\nplayer_site:\n  title: a\n',
    old: 'publish:\n  site_title: a\n',
    changes: { new: [{ op: 'set', name: 'player_site.title', value: 'yes' }] },
    newOut: 'version: 1\nplayer_site:\n  title: yes\n',
    oldOut: 'publish:\n  site_title: yes\n',
  });
  both('vault.setting_year is written (under vault, or at the left edge of the old file)', {
    nw: 'version: 1\nvault:\n  system: gurps\n',
    old: 'type: meta\npublish:\n  site_title: T\n',
    changes: { new: [{ op: 'set', name: 'vault.setting_year', value: 1925 }] },
    newOut: 'version: 1\nvault:\n  system: gurps\n  setting_year: "1925"\n',
    oldOut: 'type: meta\npublish:\n  site_title: T\nsetting_year: "1925"\n',
  });
});

describe('settings writer: unset', () => {
  both('unset of the last key in a group removes the empty group', {
    nw: 'version: 1\nplayer_site:\n  title: T\n  theme:\n    # about the look\n    tagline: Hi\n  footer: F\n',
    old: 'publish:\n  site_title: T\n  theme:\n    tagline: Hi\n  footer: F\n',
    changes: { new: [{ op: 'unset', name: 'player_site.theme.tagline' }] },
    newOut: 'version: 1\nplayer_site:\n  title: T\n  footer: F\n',
    oldOut: 'publish:\n  site_title: T\n  footer: F\n',
  });
  it('unset of a group is refused and lists what is in it', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\nplayer_site:\n  theme:\n    tagline: Hi\n');
    assert.throws(() => applyChanges(v.dir, [{ op: 'unset', name: 'player_site.theme' }]), (e) => /unset each setting in it/.test(e.message) && /player_site\.theme\.tagline/.test(e.message));
    assert.strictEqual(v.read(), 'version: 1\nplayer_site:\n  theme:\n    tagline: Hi\n');
  });
});

describe('settings writer: all or nothing, line endings, the rest of the file', () => {
  it('a failed multi-change leaves the file byte-identical (both layouts)', () => {
    const changes = [
      { op: 'set', name: 'player_site.title', value: 'T' },
      { op: 'set', name: 'player_site.features.search', value: 'maybe' },
      { op: 'set', name: 'player_site.footer', value: 'F' },
    ];
    for (const [rel, text] of [[NEW_FILE, 'version: 1\n'], [OLD_FILE, `---\ntype: meta\n---\n${BODY}`]]) {
      const v = vaultWith(rel, text);
      assert.throws(() => applyChanges(v.dir, changes), /player_site\.features\.search/);
      assert.strictEqual(v.read(), text);
    }
  });
  it('one error lists every refusal', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\n');
    try {
      applyChanges(v.dir, [{ op: 'set', name: 'nope.thing', value: 1 }, { op: 'set', name: 'player_site.features.search', value: 'maybe' }]);
      assert.fail('should refuse');
    } catch (e) {
      assert.strictEqual(e.refusals.length, 2);
      assert.strictEqual(e.message.split('\n').length, 2);
    }
  });
  both('CRLF line endings are kept', {
    nw: 'version: 1\r\nplayer_site:\r\n  title: T\r\n  hide:\r\n    sections:\r\n      - a\r\n',
    old: 'publish:\r\n  site_title: T\r\n  exclude_sections:\r\n    - a\r\n',
    changes: { new: [{ op: 'set', name: 'player_site.footer', value: 'F' }, { op: 'add', name: SEC, entries: ['b'] }] },
    newOut: 'version: 1\r\nplayer_site:\r\n  title: T\r\n  hide:\r\n    sections:\r\n      - a\r\n      - b\r\n  footer: F\r\n',
    oldOut: 'publish:\r\n  site_title: T\r\n  exclude_sections:\r\n    - a\r\n    - b\r\n  footer: F\r\n',
    eol: '\r\n',
  });
  it('a file with no trailing newline keeps none', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\nplayer_site:\n  title: T');
    applyChanges(v.dir, [{ op: 'set', name: 'player_site.footer', value: 'F' }]);
    assert.strictEqual(v.read(), 'version: 1\nplayer_site:\n  title: T\n  footer: F');
    applyChanges(v.dir, [{ op: 'unset', name: 'player_site.footer' }]);
    assert.strictEqual(v.read(), 'version: 1\nplayer_site:\n  title: T');
  });
  it('the old file keeps its body and its other keys byte for byte', () => {
    const head = '# a note\ntype: meta\ncampaign: "X"   # the name\n\npublish:\n  site_title: T\n\n# about the next\nchapter_naming: "Ch"\n';
    const v = vaultWith(OLD_FILE, `---\n${head}---\n${BODY}`);
    applyChanges(v.dir, [{ op: 'set', name: 'player_site.title', value: 'U' }]);
    assert.strictEqual(v.read(), `---\n${head.replace('site_title: T', 'site_title: U')}---\n${BODY}`);
  });
  it('a hiding key written beside publish: can be moved under it (unset-raw, then set)', () => {
    const v = vaultWith(OLD_FILE, `---\ntype: meta\nexclude_sections: [a]\npublish:\n  site_title: T\n---\n${BODY}`);
    applyChanges(v.dir, [{ op: 'unset-raw', path: ['exclude_sections'] }, { op: 'set', name: SEC, value: ['a'] }]);
    assert.strictEqual(v.read(), `---\ntype: meta\npublish:\n  site_title: T\n  exclude_sections:\n    - a\n---\n${BODY}`);
  });
});

describe('settings writer: the old file, older spellings', () => {
  it('set of an older spelling writes the primary name once, in place', () => {
    const v = vaultWith(OLD_FILE, '---\npublish:\n  images:\n    maxWidth: 800  # wide\n    quality: 80\n---\n');
    const out = applyChanges(v.dir, [{ op: 'set', name: 'player_site.images.max_width', value: 900 }]);
    const text = v.read();
    assert.ok(!/maxWidth/.test(text), text);
    assert.ok(/max_width: 900  # wide/.test(text), text);
    assert.deepStrictEqual(out.wrote, ['publish.images.max_width']);
  });
  it('set across different parents removes the older spelling', () => {
    const v = vaultWith(OLD_FILE, '---\npublish:\n  backend:\n    statusBar: true\n  site_title: T\n---\n');
    applyChanges(v.dir, [{ op: 'set', name: 'player_site.features.live_stats', value: false }]);
    assert.strictEqual(v.read(), '---\npublish:\n  site_title: T\n  live_stats: false\n---\n');
  });
  it('unset removes every spelling present and says which', () => {
    const v = vaultWith(OLD_FILE, '---\npublish:\n  live_stats: true\n  backend:\n    statusBar: true\n  site_title: T\n---\n');
    const out = applyChanges(v.dir, [{ op: 'unset', name: 'player_site.features.live_stats' }]);
    assert.strictEqual(v.read(), '---\npublish:\n  site_title: T\n---\n');
    assert.deepStrictEqual(out.removed.sort(), ['publish.backend.statusBar', 'publish.live_stats']);
  });
  it('a setting new in this layout is refused on the old file', () => {
    const v = vaultWith(OLD_FILE, '---\ntype: meta\n---\n');
    assert.throws(() => applyChanges(v.dir, [{ op: 'set', name: 'vault.kept_by', value: 'gm' }]), /needs the new settings file; run the update first/);
  });
});

describe('settings writer: no file', () => {
  it('refuses without create, and says to use --create', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-'));
    assert.throws(() => applyChanges(dir, [{ op: 'set', name: 'player_site.title', value: 'T' }]), /--create/);
    assert.ok(!fs.existsSync(at(dir, NEW_FILE)));
  });
  it('with create makes the new file, version first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-'));
    const out = applyChanges(dir, [{ op: 'set', name: 'player_site.title', value: 'T' }], { create: true });
    assert.strictEqual(fs.readFileSync(at(dir, NEW_FILE), 'utf8'), 'version: 1\nplayer_site:\n  title: T\n');
    assert.strictEqual(out.created, true);
  });
});

describe('settings writer: the write itself', () => {
  it('a failed rename leaves the file as it was and no temp file behind', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\n');
    const failing = () => { throw new Error('rename refused'); };
    assert.throws(() => applyChanges(v.dir, [{ op: 'set', name: 'player_site.title', value: 'T' }], { rename: failing }), /rename refused/);
    assert.strictEqual(v.read(), 'version: 1\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(v.dir, '_meta')), ['vault-config.yaml']);
  });
  it('a change that changes nothing does not rewrite the file', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\nplayer_site:\n  title: T\n');
    const old = new Date(2020, 0, 1);
    fs.utimesSync(v.file, old, old);
    const out = applyChanges(v.dir, [{ op: 'set', name: 'player_site.title', value: 'T' }]);
    assert.deepStrictEqual(out.changed, []);
    assert.strictEqual(fs.statSync(v.file).mtimeMs, old.getTime());
  });
  it('writes through a symlinked settings file and keeps its permission bits', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-link-'));
    const real = path.join(dir, 'shared', 'real.yaml');
    fs.mkdirSync(path.dirname(real));
    fs.writeFileSync(real, 'version: 1\n');
    fs.chmodSync(real, 0o640);
    const vault = path.join(dir, 'vault');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    const link = at(vault, NEW_FILE);
    fs.symlinkSync(real, link);
    applyChanges(vault, [{ op: 'set', name: 'player_site.title', value: 'T' }]);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.match(fs.readFileSync(real, 'utf8'), /title: T/);
    assert.strictEqual(fs.statSync(real).mode & 0o777, 0o640);
  });
  it('a settings file written by a newer gm-apprentice is not written', () => {
    const v = vaultWith(NEW_FILE, 'version: 2\n');
    assert.throws(() => applyChanges(v.dir, [{ op: 'set', name: 'player_site.title', value: 'T' }]), /newer gm-apprentice/);
  });
  it('a top-level group that is not a group is refused, not overwritten', () => {
    const v = vaultWith(NEW_FILE, 'version: 1\nplayer_site: nope\n');
    assert.throws(() => applyChanges(v.dir, [{ op: 'set', name: 'player_site.title', value: 'T' }]), /not a group/);
    assert.strictEqual(v.read(), 'version: 1\nplayer_site: nope\n');
  });
  it('a one-line group is written again with the change', () => {
    const v = vaultWith(OLD_FILE, '---\npublish: {site_title: X}\n---\n');
    applyChanges(v.dir, [{ op: 'set', name: 'player_site.footer', value: 'F' }]);
    assert.strictEqual(v.read(), '---\npublish: {site_title: X, footer: F}\n---\n');
  });
});
