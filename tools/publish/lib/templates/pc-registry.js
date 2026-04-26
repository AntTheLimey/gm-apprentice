const renderers = {};

function getRenderer(system) {
  if (!system) return null;
  return renderers[system] || null;
}

module.exports = { getRenderer };
