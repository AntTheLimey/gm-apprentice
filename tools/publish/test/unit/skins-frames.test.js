const { describe, it } = require('node:test');
const assert = require('node:assert');
const { FRAME_IDS } = require('../../lib/skins');
const { frameArt } = require('../../lib/skins/frames');

describe('skins: frames', () => {
  for (const id of FRAME_IDS) {
    it(`${id} draws inside the view box with a clip`, () => {
      const art = frameArt(id);
      assert.match(art.clip, /^(circle\(50%\)|inset\(0\)|polygon\([\d.% ,-]+\))$/);
      assert.ok(art.svg.length > 20);
      assert.doesNotMatch(art.svg, /NaN|undefined|<script|style=|#[0-9a-f]{3,6}\b|rgb/i, 'no bad numbers, scripts or literal colours');
      // every element carries one of the layer's classes, so a skin can colour it
      for (const el of art.svg.match(/<(circle|rect|path|polygon|polyline|line|ellipse)\b[^>]*>/g)) {
        assert.match(el, /class="(s1|s3|s4|f|hi|jewel|plate)"/, el);
        // colour comes from the class alone: an attribute would beat nothing but would hide a skin's colour from a reader of the markup
        assert.doesNotMatch(el, /\s(fill|stroke)=/, el);
      }
      // balanced and self-closed
      assert.strictEqual((art.svg.match(/</g) || []).length, (art.svg.match(/\/>/g) || []).length);
    });
  }
  it('steel is cut to eight corners and hex to six', () => {
    const points = (id) => frameArt(id).clip.match(/^polygon\((.*)\)$/)[1].split(',').length;
    assert.strictEqual(points('steel'), 8);
    assert.strictEqual(points('hex'), 6);
  });
  it('is the same drawing each call', () => {
    for (const id of FRAME_IDS) assert.strictEqual(frameArt(id).svg, frameArt(id).svg);
  });
  it('refuses an id it does not know', () => {
    assert.throws(() => frameArt('none'));
    assert.throws(() => frameArt('vellum'));
  });
});
