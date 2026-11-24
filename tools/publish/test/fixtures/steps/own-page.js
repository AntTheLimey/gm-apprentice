'use strict';
// A build step for tests: writes a hand-built, full-window page (a stand-in for a star map) at the address given,
// inside the site's output folder (docs/, or the folder given second). It fills its window, says how big that is, links to the site's home page,
// keeps a list of the keys and wheel turns it hears, and reads a system's name from its #fragment.
const fs = require('node:fs');
const path = require('node:path');

const [address, out = 'docs'] = process.argv.slice(2);
const file = path.join(out, ...address.split('/'));
const up = '../'.repeat(address.split('/').length - 1);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Star Map — T</title>
<style>html,body{margin:0;height:100%;background:#000;color:#9ff}#app{position:fixed;inset:0}#crumbs{position:fixed;top:14px;left:16px}</style>
</head><body>
<div id="app"></div>
<div id="crumbs"><a id="home" href="${up}index.html">Home</a> · <a id="here" href="#Eris">Eris</a></div>
<script>
window.heard = [];
addEventListener('keydown', function(e) { heard.push('key:' + e.key); });
addEventListener('wheel', function() { heard.push('wheel'); });
window.size = function() { return { w: innerWidth, h: innerHeight }; };
window.system = function() { return decodeURIComponent(location.hash.slice(1)); };
</script>
</body></html>
`);
