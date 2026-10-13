const { describe, it } = require('node:test');
const assert = require('node:assert');
const { assertNoStops } = require('../../lib/config');
const { makeFault, formatFault } = require('../../lib/settings');
const { entry } = require('../../lib/settings');

const stop = makeFault({ name: 'publish.mode', kind: 'not-allowed', level: 'stop', value: 'players', entry: entry('player_site.hide.mode') });
const warn = makeFault({ name: 'publish.zebra', kind: 'unknown-name', level: 'warn', value: 1, suggest: null });

describe('assertNoStops', () => {
  it('throws for a stop, with what stopped, the fault lines and what to do', () => {
    assert.throws(() => assertNoStops({ faults: [warn, stop] }, 'build'), (err) => {
      assert.strictEqual(err.message,
        'build stopped: the settings have a fault that could show players more than you meant.\n'
        + `  ${formatFault(stop)}\n`
        + 'Fix it, or ask the apprentice to run the Settings check.');
      return true;
    });
  });
  it('names every stop, one line each', () => {
    const second = makeFault({ name: 'publish.exclude_drafts', kind: 'not-allowed', level: 'stop', value: 'maybe', entry: entry('player_site.hide.drafts') });
    assert.throws(() => assertNoStops({ faults: [stop, second] }, 'deploy'), (err) => err.message.split('\n').length === 4);
  });
  it('returns quietly for warnings only and for no faults', () => {
    assert.strictEqual(assertNoStops({ faults: [warn] }, 'build'), undefined);
    assert.strictEqual(assertNoStops({ faults: [] }, 'build'), undefined);
    assert.strictEqual(assertNoStops({}, 'build'), undefined);
  });
});
