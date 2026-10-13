'use strict';
// Runs a move in its own process and kills that process (no rollback, nothing tidied) at one point in the
// commit: just before, or just after, the Nth rename or removal. Used by settings-move.test.js.
//   node kill-move.js <vault> <site file or -> <N> <before|after>
// Prints how many renames and removals the move made when it was not killed (N past the end).
const fs = require('node:fs');
const { planMove, applyMove } = require('../../lib/settings/move');

const [vault, siteArg, nArg, when] = process.argv.slice(2);
const n = Number(nArg);
let count = 0;
const step = (what) => (...args) => {
  count += 1;
  if (count === n && when === 'before') process.exit(9);
  what(...args);
  if (count === n && when === 'after') process.exit(9);
};
const plan = planMove({ vaultPath: vault, siteConfigPath: siteArg === '-' ? null : siteArg });
if (!plan.ok) {
  console.error(plan.blockers.join('\n'));
  process.exit(2);
}
applyMove(plan, { rename: step((a, b) => fs.renameSync(a, b)), remove: step((f) => fs.rmSync(f, { force: true })) });
console.log(count);
