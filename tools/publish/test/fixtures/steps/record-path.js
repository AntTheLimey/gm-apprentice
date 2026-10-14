'use strict';
// A build step for tests: writes the first folder on its PATH to the file named by its first argument.
const fs = require('node:fs');
const path = require('node:path');

const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path');
fs.writeFileSync(process.argv[2], `${process.env[key].split(path.delimiter)[0]}\n`);
