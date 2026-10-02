// Many fixtures keep a legacy site file on purpose (they exercise the fallback), so every
// build in them ends with the "still holds campaign settings" line and ~70 copies bury the
// real warnings in the suite's output. Requiring this drops that one line from the printed
// output of the test file that requires it. A test that captures console.warn still sees it
// (its own capture sits on top of this one), and the tests that assert on it do not require
// this helper.
const printed = console.warn;
console.warn = (...args) => {
  if (String(args[0]).includes('vault.config.json still holds campaign settings')) return;
  printed.apply(console, args);
};
