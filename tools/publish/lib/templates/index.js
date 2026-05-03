const { DIR_LABELS, cssPath, rootPath, baseShell, confidenceBadge, TYPE_BADGE_FIELDS, metadataBadgesFor, portraitImg } = require('./base');
const { generateNav } = require('./nav');
const { pcTemplate } = require('./pc');
const { npcTemplate } = require('./npc');
const { creatureTemplate } = require('./creature');
const { locationTemplate } = require('./location');
const { itemTemplate } = require('./item');
const { factionTemplate } = require('./faction');
const { eventTemplate } = require('./event');
const { wikiTemplate } = require('./wiki');
const { indexTemplate } = require('./index-page');
const { landingTemplate } = require('./landing');
const { fourOhFourTemplate } = require('./four-oh-four');
const { getRenderer } = require('./pc-registry');

module.exports = {
  DIR_LABELS,
  cssPath,
  rootPath,
  baseShell,
  confidenceBadge,
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
  eventTemplate,
  wikiTemplate,
  indexTemplate,
  landingTemplate,
  fourOhFourTemplate,
  getRenderer,
};
