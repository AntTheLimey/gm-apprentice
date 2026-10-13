'use strict';
const { readSettings } = require('./read');
const { stops, formatFault, makeFault, nearest } = require('./faults');
const { REGISTRY, entry, names, legacyNameOf, resolve } = require('./registry');
const { movedKeys } = require('./legacy');
const { layoutOf, fileLabel, nameIn, fileLabelFor, nameInFor } = require('./layout');

module.exports = { readSettings, layoutOf, fileLabel, nameIn, fileLabelFor, nameInFor, stops, formatFault, makeFault, nearest, REGISTRY, entry, names, movedKeys, legacyNameOf, resolve };
