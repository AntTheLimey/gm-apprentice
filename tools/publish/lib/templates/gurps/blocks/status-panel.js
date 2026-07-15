const { escapeHtml } = require('../../../processor');

// One persistent status panel above the tab bar (replaces the twice-rendered
// inline status block). Editors are always visible; the effects row and badges
// are hidden until the client detects Reeling/Tired. Guarded to vitals present.
function vitalEditor(kind, label, cur, max, badgeClass, badgeText) {
  return `<div class="gl-vital" data-vital="${kind}">` +
    `<span class="gl-vital-label">${label}</span>` +
    `<button type="button" class="gl-step" data-gl-step="${kind}" data-delta="-1" aria-label="Decrease ${label}">−</button>` +
    `<input class="gl-vital-input" data-gl-vital="${kind}" type="number" inputmode="numeric" step="1" value="${escapeHtml(String(cur))}" aria-label="Current ${label}">` +
    `<span class="gl-vital-max">/${escapeHtml(String(max))}</span>` +
    `<button type="button" class="gl-step" data-gl-step="${kind}" data-delta="1" aria-label="Increase ${label}">+</button>` +
    `<span class="gl-badge ${badgeClass}" hidden>⚠ ${badgeText}</span>` +
    `</div>`;
}

function deltaSpan(field, afterAttr) {
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  return `<span class="gl-delta" data-gl-delta="${field}" hidden>${label} ` +
    `<span class="gl-delta-before"></span>→` +
    `<span class="gl-delta-after"${afterAttr}></span></span>`;
}

function renderStatusPanel(model, vitals) {
  if (!vitals) return null;
  const editors =
    vitalEditor('hp', 'HP', vitals.hp.cur, vitals.hp.max, 'gl-badge-reeling', 'REELING') +
    vitalEditor('fp', 'FP', vitals.fp.cur, vitals.fp.max, 'gl-badge-tired', 'TIRED');
  const effects =
    `<div class="gl-status-effects" hidden>` +
    deltaSpan('move', '') +
    deltaSpan('dodge', '') +
    // The ST after-value doubles as the canonical live ST hook (data-gl-field="st"),
    // seeded to the bought ST; the Attributes ST card stays the point-costed value.
    `<span class="gl-delta" data-gl-delta="st" hidden>ST ` +
    `<span class="gl-delta-before"></span>→` +
    `<span class="gl-delta-after" data-gl-field="st">${escapeHtml(String(vitals.st))}</span></span>` +
    `<span class="gl-status-note" hidden></span>` +
    `</div>`;
  return `<div class="gl-status-panel"><div class="gl-vitals">${editors}</div>${effects}</div>`;
}

module.exports = { renderStatusPanel };
