'use strict';
// A hand-made prop page whose script opens a picture named only in a data- attribute (a map plate shown full screen):
// the picture is a linked file of the prop, copied by the same rules as any other, and the leak gate owns it as the
// prop's file.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');
const { collectHidden } = require('../../lib/leak-gate/collect');

const MAPS = '<!doctype html><html><head><title>Maps</title></head><body>'
  + '<img src="assets/preview.jpg" alt="Plate">'
  + '<a class="plate-frame" data-map="assets/full.jpg" data-overlay="plate" href="#">Open the plate</a>'
  + '<a data-map="assets/Missing.jpg" href="#">A plate not in the vault</a>'
  + '<a data-map="../outside.jpg" href="#">A plate outside the folder</a>'
  + '<script>for (const a of document.querySelectorAll("[data-map]")) a.onclick = () => open(a.dataset.map);</script>'
  + '</body></html>';

describe('a picture named in a data- attribute', () => {
  const s = buildBoth({
    'Maps/The Maps.md': '---\ntype: prop\nprop_kind: supplied\nprop_file: maps.html\nprop_address: gazetteer/maps.html\n---\nThe maps.\n',
    'Maps/maps.html': MAPS,
    'Maps/assets/preview.jpg': 'JPEG-PREVIEW',
    'Maps/assets/full.jpg': 'JPEG-FULL',
    'outside.jpg': 'JPEG-OUT',
    '_meta/publish-list.yaml': listFileText({ publishing: ['Maps/The Maps.md'] }),
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('is copied beside the page, as an img src is', () => {
    assert.equal(s.player.read('gazetteer', 'assets', 'full.jpg'), 'JPEG-FULL');
    assert.equal(s.player.read('gazetteer', 'assets', 'preview.jpg'), 'JPEG-PREVIEW');
    assert.ok(!s.player.exists('outside.jpg') && !s.player.exists('gazetteer', 'outside.jpg'));
    // The same rows as any other link: a missing file and one outside the folder are named.
    assert.ok(s.logs.some((l) => /links "assets\/Missing\.jpg", which is not there/.test(l)), s.logs.join('\n'));
    assert.ok(s.logs.some((l) => /links "\.\.\/outside\.jpg", which is outside its folder/.test(l)), s.logs.join('\n'));
  });

  it('the leak gate owns it as the prop\'s file', () => {
    const hidden = collectHidden({ configPath: s.configPath });
    assert.deepEqual([...(hidden.propOwner.get('gazetteer/assets/full.jpg') || [])], ['Maps/The Maps.md']);
    assert.deepEqual([...(hidden.propOwner.get('gazetteer/assets/preview.jpg') || [])], ['Maps/The Maps.md']);
  });
});
