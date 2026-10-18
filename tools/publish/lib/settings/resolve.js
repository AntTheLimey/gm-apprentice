'use strict';
// forSite: the one place a site's values are decided from the vault's settings. The player site is
// `player_site` as read. The GM site is the player site with whatever is written under `gm_site` laid
// over, by name, a whole value at a time; build steps that do not inherit (`gmDefault`), and the live
// features the GM site never has, set here. Only settings the registry lists as twins are laid over:
// any other name a file holds under `gm_site` is never read as a value of the site.
const { REGISTRY } = require('./registry');
const { getPath, setIn } = require('./types');

const TWINS = REGISTRY.filter((e) => e.twinOf && !e.container);
const GM_OFF = ['features.live_stats', 'features.inbox'];

// `origins` is the site's: the read's origins, with each twin the file wrote copied onto its player
// name, so a check that asks "did the GM write this" asks it for the site being built. A twin that
// failed to read (origin `fault`, no value) is treated as unset and keeps the player site's origin.
function forSite(read, site) {
  const { values, origins } = read;
  const gmValues = values.gm_site || {};
  const gm = { publish: gmValues.publish === true, folder: gmValues.folder || null, show: { ...(gmValues.show || {}) } };
  if (site === 'player') return { vault: values.vault, site: values.player_site, origins, gm };
  if (site !== 'gm') throw new Error(`forSite: unknown site "${site}"`);
  const out = structuredClone(values.player_site);
  const siteOrigins = { ...origins };
  for (const t of TWINS) {
    const rest = t.name.split('.').slice(1);
    const own = origins[t.name] === 'file' ? getPath(gmValues, rest) : undefined;
    if (own !== undefined) {
      setIn(out, rest.join('.'), structuredClone(own));
      siteOrigins[`player_site.${rest.join('.')}`] = 'file';
    } else if (t.gmDefault !== undefined) setIn(out, rest.join('.'), structuredClone(t.gmDefault));
  }
  for (const name of GM_OFF) setIn(out, name, false);
  return { vault: values.vault, site: out, origins: siteOrigins, gm };
}

module.exports = { forSite };
