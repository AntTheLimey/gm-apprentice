'use strict';
// A build step for tests: appends its first argument as a line to the file named by its second.
const fs = require('node:fs');
const path = require('node:path');

const [line, file] = process.argv.slice(2);
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
fs.appendFileSync(file, `${line}\n`);
