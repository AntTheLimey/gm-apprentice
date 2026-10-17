// Maps a campaign's system id to its live-tracking client. Single source of
// truth so pc.js does not hard-code any one system. Keyed by canonical system id; the
// aliases that name each are the shared list (shared-lists.js).
const { systemId } = require('../shared-lists');

const CLIENTS = {
  'gurps-4e': { script: 'gurps-live.js', domId: 'gurps-live-data' },
  'coc-7e': { script: 'coc-live.js', domId: 'coc-live-data' },
  'coc-7e-regency': { script: 'coc-live.js', domId: 'coc-live-data' },
  'dnd-5e-2024': { script: 'dnd-live.js', domId: 'dnd-live-data' },
};

function clientFor(system) {
  const id = systemId(system);
  return (id && CLIENTS[id]) || null;
}

// Ordered <script src> hrefs: the shared store must load before the client that
// reads window.__liveState. Empty when the system has no live client.
function liveScriptHrefs(rootHref, system) {
  const c = clientFor(system);
  if (!c) return [];
  return [rootHref + 'js/live-state.js', rootHref + 'js/' + c.script];
}

module.exports = { clientFor, liveScriptHrefs };
