'use strict';
// An installed Chrome or Chromium, found by path or on PATH. The tests' browser helper and `props pages` both ask here.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const CANDIDATES = [
  process.env.GM_TEST_CHROME,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
].filter(Boolean);

function findChrome() {
  for (const c of CANDIDATES) {
    if (/[\\/]/.test(c) ? fs.existsSync(c) : spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  }
  return null;
}

// A file URL Chrome opens; `#`, `?` and spaces in the path are escaped.
const fileUrl = (p) => pathToFileURL(p).href;

// Ends every Chrome process still running on the profile folder `profile` (#565). A launch that runs out of time is
// killed by Node, but only the browser process: its helpers (GPU, renderer, network) carry the same
// `--user-data-dir` and live on as orphans, and a browser killed outright leaves its code-signing clone in the
// system's temp folder. So they are all asked to quit (SIGTERM lets Chrome clean up), and killed if they have not
// gone within `graceMs`. A profile folder no running Chrome uses is a no-op. Returns how many processes were found.
function stopChrome(profile, { graceMs = 3000, platform = process.platform } = {}) {
  if (!profile) return 0;
  const flag = `--user-data-dir=${profile}`;
  if (platform === 'win32') {
    // One PowerShell finds and stops them (Windows has no polite quit to send) and prints how many. Its own command
    // line holds the flag too, so it leaves itself out; the flag must end there (a quote, written `\x22` so no `"` has
    // to survive Windows' argument quoting, a space, or the end), so `…-abc` never matches a Chrome on `…-abcd`.
    const quoted = flag.replace(/'/g, "''");
    const script = `$m = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and `
      + `$_.CommandLine -match ([regex]::Escape('${quoted}') + '(\\x22|\\s|$)') }); `
      + '$m | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $m.Count';
    const run = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return Number(String(run.stdout || '').trim()) || 0;
  }
  // pkill and pgrep read the pattern as an extended regular expression: the profile path is matched literally, and
  // up to the end of its argument, so `…-abc` never matches a Chrome running on `…-abcd`.
  const pattern = `${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`;
  const pids = () => String(spawnSync('pgrep', ['-f', '--', pattern], { encoding: 'utf8' }).stdout || '').trim().split(/\s+/).filter(Boolean);
  const found = pids().length;
  if (!found) return 0;
  spawnSync('pkill', ['-TERM', '-f', '--', pattern]);
  const until = Date.now() + graceMs;
  while (pids().length && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  if (pids().length) spawnSync('pkill', ['-KILL', '-f', '--', pattern]);
  return found;
}

module.exports = { findChrome, fileUrl, stopChrome };
