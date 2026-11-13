const { escapeHtml } = require('../../../processor');
const { gravityDx } = require('../../../../js/gurps-live');

// A warning at the top of the sheet whenever local gravity is not what the character is used to (B350,
// #629): the DX penalty (worked out by js/gurps-live.js `gravityDx`, the one place) and the jump and
// throw change. The sheet shows no jump or throw figure, so the multiplier here is the whole change
// (1 / local gravity, B350; B89 for jumping). Nothing when neither `gravity` nor `home_gravity` is set.
function renderGravityNotice(model) {
  const fx = model.gravityFx;
  if (!fx) return null;
  const local = fx.local;
  const r = gravityDx(local, fx.home, fx.traits);
  const say = (n) => escapeHtml(String(n));
  const home = fx.home !== 1 ? ` (raised at ${say(fx.home)}G)` : '';
  let text;
  if (local === 0) {
    text = `0G${home}: no DX penalty from this rule; the Free Fall rules cover weightless tasks (B350)`;
  } else {
    const ratio = Math.round((1 / local) * 100) / 100;
    const dxText = r.dx
      ? `DX -${r.dx} to agility and ballistic tasks, Beam Weapons exempt`
      : `no DX penalty (within ${say(r.incrementG)}G steps of ${say(fx.home)}G)`;
    const tolerance = r.halved
      ? `; G-Experience halves it${r.assumed ? `, taken to cover ${say(local)}G` : ''}`
      : (r.incrementG > 0.2 ? `; Improved G-Tolerance makes the step ${say(r.incrementG)}G` : '');
    const jump = local === 1 ? '' : `; jumps and throws x${say(ratio)}`;
    text = `${say(local)}G${home}: ${dxText}${tolerance}${jump} (B350)`;
  }
  return `<div class="gl-grav-alert" role="note"><b>Gravity</b> ${text}</div>`;
}

module.exports = { renderGravityNotice };
