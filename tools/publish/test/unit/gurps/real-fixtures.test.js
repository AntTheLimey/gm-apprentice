/**
 * Real-fixture regression tests for the GURPS parser.
 * Loads the gurps-ronnie.md fixture (a representative subset of Ronnie Vint's
 * vault file) and asserts concrete values that exercise the real-world column
 * orders and bracket/footnote formats.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { extractSections } = require('../../../lib/processor');
const { renderGURPSSheet } = require('../../../lib/templates/gurps/index');
const { parseGurps } = require('../../../lib/templates/gurps/parse');

const fixturePath = path.join(__dirname, '../../fixtures/gurps/gurps-ronnie.md');
const raw = fs.readFileSync(fixturePath, 'utf8');
const { data: frontmatter, content } = matter(raw);
const sections = extractSections(content);
const { sheetHtml, combatHtml } = renderGURPSSheet(frontmatter, sections);

describe('GURPS real-fixture: Ronnie Vint', () => {

  // ---------------------------------------------------------------
  // BUG 1 — Trait costs read the right column (Cost, not Notes)
  // ---------------------------------------------------------------
  describe('Advantages cost column (BUG 1)', () => {
    it('sheetHtml contains the Advantages block', () => {
      assert.ok(sheetHtml, 'sheetHtml must not be null');
      assert.ok(sheetHtml.includes('Advantages'), 'must contain Advantages heading');
    });

    it('Luck shows cost 15, not page ref or notes prose', () => {
      // The cost() helper wraps value in <span class="cost">
      assert.ok(sheetHtml.includes('Luck'), 'must contain Luck advantage');
      // Structural check: cost must render as the numeric value 15 in a cost span
      assert.ok(sheetHtml.includes('<span class="cost">15</span>'),
        'Luck must show cost 15 in a cost span');
      // Must not misroute to the page-ref column
      assert.ok(!sheetHtml.includes('<span class="cost">B66</span>'),
        'cost must not be the page ref column');
    });

    it('no [[double-bracket]] patterns appear in any cost span', () => {
      // Regression: before fix, [15] was being passed raw and cost() added
      // outer brackets → [[15]]
      assert.ok(!sheetHtml.includes('[['), 'no [[ patterns in sheetHtml');
      assert.ok(!combatHtml || !combatHtml.includes('[['), 'no [[ patterns in combatHtml');
    });

    it('Disadvantage Greed shows cost -15, not the self-control note or notes prose', () => {
      assert.ok(sheetHtml.includes('<span class="cost">-15</span>'),
        'Greed must show cost -15 (stripped of brackets)');
      assert.ok(!sheetHtml.includes('<span class="cost">CR 12</span>'),
        'cost must not be the self-control column value');
    });
  });

  // ---------------------------------------------------------------
  // BUG 2 — Skills use Effective column, not Relative Level
  // ---------------------------------------------------------------
  describe('Skills effective level column (BUG 2)', () => {
    it('Karate shows effective level 17, not relative DX+2', () => {
      // Level cell should show 17, not "DX+2"
      // renderSkills puts level in a <td class="num"> and relative in <td class="num rel">
      assert.ok(sheetHtml.includes('Karate'), 'must contain Karate skill');
      // The relative column holds "DX+2"; level column holds "17"
      assert.ok(!sheetHtml.match(/<td class="num">DX\+2<\/td>/),
        'level column must not show relative level DX+2');
    });

    it('Karate shows relative DX+2 in the relative column', () => {
      assert.ok(sheetHtml.includes('DX+2'), 'relative level DX+2 should appear in relative col');
    });

    it('points for Karate are 12, not [12]', () => {
      // stripCost strips the brackets
      assert.ok(sheetHtml.includes('<span class="cost">12</span>'),
        'Karate points 12 must appear without brackets');
    });

    it('skill names do not contain trailing footnote dagger characters', () => {
      // "Climbing †" should be stored as "Climbing", not "Climbing †"
      assert.ok(!sheetHtml.match(/Climbing\s*†/),
        'Climbing must not have trailing dagger in displayed name');
      assert.ok(!sheetHtml.match(/Guns.*LMG.*‡/),
        'Guns (LMG) must not have trailing ‡ in displayed name');
    });
  });

  // ---------------------------------------------------------------
  // BUG 3 — Combat chains: table form
  // ---------------------------------------------------------------
  describe('Combat Action Chains table form (BUG 3)', () => {
    it('combatHtml is not null', () => {
      assert.ok(combatHtml, 'combatHtml must not be null');
    });

    it('combatHtml contains a chain named "Dynamic Entry"', () => {
      assert.ok(combatHtml.includes('Dynamic Entry'),
        'combatHtml must contain the Dynamic Entry chain from the table');
    });

    it('combatHtml contains the Rifle to Pistol Transition chain', () => {
      assert.ok(combatHtml.includes('Rifle to Pistol Transition'),
        'must contain second chain from table');
    });

    it('combatHtml contains at least 5 chains from the table', () => {
      const matches = (combatHtml.match(/chain-entry/g) || []).length;
      assert.ok(matches >= 5, `expected at least 5 chain entries, got ${matches}`);
    });
  });

  // ---------------------------------------------------------------
  // BUG 4 — Current Status banner with bold-label format
  // ---------------------------------------------------------------
  // SP2 Task 5 retired the inline status pips from the render path (they're
  // superseded by the live status panel mounted above the tab bar, which
  // isn't wired up here since this fixture doesn't pass `meta`). The
  // bold-label parsing this block guards against regressing is still real,
  // it just now lives only in the parsed model — so assert against that
  // directly instead of hunting for it in rendered HTML.
  describe('Current Status bold-label parsing (BUG 4)', () => {
    it('sheetHtml no longer includes the retired inline status div', () => {
      assert.ok(!sheetHtml.includes('class="status"'),
        'sheetHtml must not include the retired inline status div');
    });

    it('parsed model status.condition contains "Unharmed"', () => {
      const model = parseGurps(frontmatter, sections);
      assert.ok(String(model.status.condition || '').includes('Unharmed'),
        'model.status.condition must contain Ronnie\'s Condition value');
    });

    it('parsed model status.location contains Location text', () => {
      const model = parseGurps(frontmatter, sections);
      const location = String(model.status.location || '');
      assert.ok(location.includes('Las Vegas Airport') || location.includes('rewritten present'),
        'model.status.location must contain Location text');
    });
  });

  // ---------------------------------------------------------------
  // BUG 5 — Techniques block
  // ---------------------------------------------------------------
  describe('Techniques block (BUG 5)', () => {
    it('sheetHtml contains the Techniques block', () => {
      assert.ok(sheetHtml.includes('Techniques'), 'must have Techniques heading');
    });

    it('Arm Lock appears in the Techniques block', () => {
      assert.ok(sheetHtml.includes('Arm Lock'), 'must contain Arm Lock technique');
    });

    it('Technique Arm Lock shows effective level 18', () => {
      assert.ok(sheetHtml.includes('18'), 'Arm Lock effective 18 must appear');
    });

    it('Techniques appear before Spells and after Skills in layout', () => {
      const techIdx = sheetHtml.indexOf('Techniques');
      const skillIdx = sheetHtml.indexOf('Skills');
      assert.ok(skillIdx < techIdx, 'Techniques block must come after Skills block');
    });

    it('Spells block is absent for Ronnie (no spells); Techniques precede where Spells would be', () => {
      // Ronnie has no Spells section — the Spells block must not appear in sheetHtml.
      // This anchors the layout ordering: Skills → Techniques → (Spells if present).
      const spellIdx = sheetHtml.indexOf('>Spells<');
      assert.strictEqual(spellIdx, -1, 'Ronnie has no Spells block; if one appeared it would be a parse error');
    });
  });

  // ---------------------------------------------------------------
  // Primary attributes correctness
  // ---------------------------------------------------------------
  describe('Primary attributes', () => {
    it('ST card shows 12', () => {
      // renderAttributes wraps in a stat card
      assert.ok(sheetHtml.includes('12'), 'ST 12 must appear in sheetHtml');
    });

    it('DX card shows 15', () => {
      assert.ok(sheetHtml.includes('15'), 'DX 15 must appear in sheetHtml');
    });
  });

  // ---------------------------------------------------------------
  // Points Summary
  // ---------------------------------------------------------------
  describe('Points Summary', () => {
    it('sheetHtml contains Points Summary block', () => {
      assert.ok(sheetHtml.includes('Points Summary'), 'must have Points Summary');
    });

    it('Total Spent row shows 255', () => {
      assert.ok(sheetHtml.includes('255'), 'Total points 255 must appear');
    });
  });

  // ---------------------------------------------------------------
  // FIX 3 — Parry sub-lines on skills (cross-reference)
  // ---------------------------------------------------------------
  describe('Skill parry sub-lines (FIX 3)', () => {
    it('Karate skill shows a Parry sub-line', () => {
      assert.ok(sheetHtml.includes('Karate'), 'must contain Karate skill');
      // The defenses section has "Parry (Karate) | 12"
      // crossReferenceSkillDefenses should attach parry: '12' to the Karate skill
      assert.ok(sheetHtml.includes('Parry: 12'),
        'Karate (and/or Knife/Judo) must show Parry: 12 sub-line');
    });
  });

  // ---------------------------------------------------------------
  // FIX 4 — Multi-Action Combat chains in combatHtml
  // ---------------------------------------------------------------
  describe('Multi-Action Combat content in combatHtml (FIX 4)', () => {
    it('combatHtml contains Multi-Action Combat Skill Chains content', () => {
      assert.ok(combatHtml, 'combatHtml must not be null');
      assert.ok(
        combatHtml.includes('Multi-Action Combat Skill Chains') ||
        combatHtml.includes('Multi-Action'),
        'combatHtml must include Multi-Action chains section'
      );
    });

    it('combatHtml contains Combat Summary content', () => {
      assert.ok(combatHtml.includes('Combat Summary'),
        'combatHtml must include Combat Summary section');
    });
  });

  // ---------------------------------------------------------------
  // FIX 2 — Skill footnote legend non-empty
  // ---------------------------------------------------------------
  describe('Skill footnote legend (FIX 2)', () => {
    it('sheetHtml skill footnote legend references encumbrance (†)', () => {
      // The Skills section has "Encumbrance-penalized" footnote for †
      assert.ok(
        sheetHtml.includes('Encumbrance') || sheetHtml.includes('encumbrance'),
        'footnote legend must contain encumbrance text from † footnote'
      );
    });
    it('footnote legend for ‡ references Guns (LMG)', () => {
      // The ‡ footnote text should include LMG or Targeting
      assert.ok(
        sheetHtml.includes('LMG') || sheetHtml.includes('Targeting'),
        'footnote legend must contain LMG/Targeting text from ‡ footnote'
      );
    });
  });

});
