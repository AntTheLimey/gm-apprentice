const { DIR_LABELS, cssPath, rootPath, baseShell, stubBadge, TYPE_BADGE_FIELDS, metadataBadgesFor, portraitImg } = require('./base');
const { generateNav } = require('./nav');
const { pcTemplate } = require('./pc');
const { npcTemplate } = require('./npc');
const { creatureTemplate } = require('./creature');
const { locationTemplate } = require('./location');
const { itemTemplate } = require('./item');
const { factionTemplate } = require('./faction');
const { wikiTemplate } = require('./wiki');
const { indexTemplate } = require('./index-page');
const { landingTemplate } = require('./landing');

module.exports = {
  DIR_LABELS,
  cssPath,
  rootPath,
  baseShell,
  stubBadge,
  TYPE_BADGE_FIELDS,
  metadataBadgesFor,
  portraitImg,
  generateNav,
  pcTemplate,
  npcTemplate,
  creatureTemplate,
  locationTemplate,
  itemTemplate,
  factionTemplate,
  wikiTemplate,
  indexTemplate,
  landingTemplate,
};
