// Maps a campaign's system id to its live-tracking client. Single source of
// truth so pc.js does not hard-code any one system. Keys mirror pc-registry.js.
const CLIENTS = {
  'gurps-4e': { script: 'gurps-live.js', domId: 'gurps-live-data' },
  'gurps': { script: 'gurps-live.js', domId: 'gurps-live-data' },
  'coc-7e': { script: 'coc-live.js', domId: 'coc-live-data' },
  'coc': { script: 'coc-live.js', domId: 'coc-live-data' },
  'regency-cthulhu': { script: 'coc-live.js', domId: 'coc-live-data' },
};

function clientFor(system) {
  if (!system) return null;
  return CLIENTS[String(system).toLowerCase()] || null;
}

// Ordered <script src> hrefs: the shared store must load before the client that
// reads window.__liveState. Empty when the system has no live client.
function liveScriptHrefs(rootHref, system) {
  const c = clientFor(system);
  if (!c) return [];
  return [rootHref + 'js/live-state.js', rootHref + 'js/' + c.script];
}

module.exports = { clientFor, liveScriptHrefs };
