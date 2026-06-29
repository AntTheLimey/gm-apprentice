'use strict';

// ============================================================
// GURPS 4e derived-value compute functions
// These are the character's own computed data (from their own ST/HP/BL),
// analogous to the existing Encumbrance block — NOT reproduced rules text.
// ============================================================

/**
 * Parse a Basic Lift value string to a number in lb.
 * Accepts "29 lbs", "29 lb", "29", "80 lbs", etc.
 * Returns null if unparseable.
 */
function parseBasicLift(blString) {
  if (blString == null) return null;
  const s = String(blString).trim();
  const m = s.match(/^([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) ? n : null;
}

/**
 * Format a weight value in lb.
 * If ≥ 2000 lb, show as "N tn" (rounded to nearest ton, minimum 1).
 * Otherwise show as "N lb" (integer).
 */
function formatWeight(lb) {
  if (lb >= 2000) {
    const tons = Math.round(lb / 2000);
    return `${tons} tn`;
  }
  return `${Math.round(lb)} lb`;
}

/**
 * Compute GURPS Lifting Feats from Basic Lift (in lb).
 * Multipliers per B353: One-Handed ×2, Two-Handed ×8,
 * Shove/Knock Over ×12, Carry on Back ×15, Shift Slightly ×50.
 * Returns an array of { label, value (formatted string) }.
 *
 * ORACLE (BL 80): 160 / 640 / 960 / 1200 / "2 tn" (4000 lb)
 * ORACLE (BL 29): 58 / 232 / 348 / 435 / 1450 lb
 */
function computeLiftingFeats(blLb) {
  if (blLb == null || !isFinite(blLb)) return [];
  return [
    { label: 'One-Handed Lift',      value: formatWeight(blLb * 2)  },
    { label: 'Two-Handed Lift',      value: formatWeight(blLb * 8)  },
    { label: 'Shove & Knock Over',   value: formatWeight(blLb * 12) },
    { label: 'Carry on Back',        value: formatWeight(blLb * 15) },
    { label: 'Shift Slightly',       value: formatWeight(blLb * 50) },
  ];
}

/**
 * Convert a GURPS slam damage value (HP×velocity/100) to a dice string.
 * Rules (B368):
 *   raw < 1d:
 *     ≤ 0.25 → "1d-3"
 *     ≤ 0.50 → "1d-2"
 *     > 0.50 → "1d-1"
 *   raw ≥ 1d: round to nearest full die (0.5+ rounds up), express as Nd.
 *
 * ORACLE (HP 20):
 *   v=1 → raw=0.20 → "1d-3"
 *   v=2 → raw=0.40 → "1d-2"
 *   v=3 → raw=0.60 → "1d-1"
 *   v=4 → raw=0.80 → "1d-1"
 *   v=5 → raw=1.00 → "1d"
 *   v=6 → raw=1.20 → "1d"
 *   v=7 → raw=1.40 → "1d"
 *   v=8 → raw=1.60 → "2d"
 *  v=12 → raw=2.40 → "2d"
 */
function slamDiceString(raw) {
  if (raw <= 0.25) return '1d-3';
  if (raw <= 0.50) return '1d-2';
  if (raw < 1.0)   return '1d-1';
  // ≥ 1: round to nearest die (0.5+ rounds up)
  const dice = Math.round(raw);  // 1.0→1, 1.5→2, etc.
  return `${dice}d`;
}

/**
 * Compute a GURPS Slam Table from HP and maxVelocity (Basic Move).
 * Returns an array of { velocity (number), damage (string) }.
 * Only shows distinct bands (when dice string changes), then one final
 * entry at maxVelocity if it differs from the previous band.
 *
 * ORACLE (HP 20, maxVelocity 8):
 *   v=1 → "1d-3", v=2 → "1d-2", v=3 → "1d-1", v=5 → "1d", v=8 → "2d"
 */
function computeSlamTable(hp, maxVelocity) {
  if (!hp || !maxVelocity || hp <= 0 || maxVelocity <= 0) return [];
  const rows = [];
  let lastDice = null;
  for (let v = 1; v <= maxVelocity; v++) {
    const raw = (hp * v) / 100;
    const d = slamDiceString(raw);
    if (d !== lastDice) {
      rows.push({ velocity: v, damage: d });
      lastDice = d;
    }
  }
  return rows;
}

module.exports = { parseBasicLift, formatWeight, computeLiftingFeats, slamDiceString, computeSlamTable };
