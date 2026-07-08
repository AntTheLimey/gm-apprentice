const { escapeHtml } = require('./processor');

const SHAPE_MAP = {
  pc: 'circle',
  npc: 'circle',
  creature: 'circle',
  location: 'rounded-square',
  faction: 'hexagon',
  organization: 'hexagon',
  item: 'diamond',
};

// Section-index pages (source file index.md -> scanner title 'index')
// link to everything by design; including them wires the whole vault
// into one hub, so graphs exclude them as nodes, sources, and targets.
function isIndexTitle(title) {
  return String(title).toLowerCase() === 'index';
}

function buildRelationshipGraph(centerTitle, pages, backlinks) {
  if (isIndexTitle(centerTitle)) return { nodes: [], edges: [] };
  const pageMap = {};
  for (const p of pages) {
    pageMap[p.title] = p;
    if (p.frontmatter.aliases) {
      for (const a of p.frontmatter.aliases) pageMap[a] = p;
    }
  }

  const nodes = new Map();
  const edges = [];

  function addNode(title, hop) {
    if (nodes.has(title)) return;
    const page = pageMap[title];
    nodes.set(title, {
      id: title,
      displayTitle: page ? page.displayTitle : title.replace(/_/g, ' '),
      outputPath: page ? page.outputPath : null,
      type: page ? page.frontmatter.type : 'unknown',
      shape: SHAPE_MAP[(page ? page.frontmatter.type : '')] || 'circle',
      hop,
    });
  }

  function getRelationships(title) {
    const page = pageMap[title];
    if (!page) return [];
    const rels = [];
    const raw = page.frontmatter.relationships;
    if (Array.isArray(raw)) {
      for (const r of raw) {
        const target = String(r.target).replace(/\[\[|\]\]/g, '').trim();
        rels.push({ target, type: r.type });
      }
    } else if (raw && typeof raw === 'object') {
      for (const [type, targets] of Object.entries(raw)) {
        const list = Array.isArray(targets) ? targets : [targets];
        for (const t of list) {
          const target = String(t).replace(/\[\[|\]\]/g, '').trim();
          rels.push({ target, type });
        }
      }
    }
    const bl = backlinks[title] || [];
    for (const b of bl) {
      if (isIndexTitle(b.title)) continue;
      if (!rels.some(r => r.target === b.title)) {
        rels.push({ target: b.title, type: 'mentioned_in' });
      }
    }
    return rels.filter(r => !isIndexTitle(r.target));
  }

  addNode(centerTitle, 0);

  const hop1Rels = getRelationships(centerTitle);
  for (const rel of hop1Rels) {
    addNode(rel.target, 1);
    edges.push({ from: centerTitle, to: rel.target, type: rel.type });
  }

  const maxNodes = 20;
  for (const [title, node] of nodes) {
    if (node.hop !== 1) continue;
    if (nodes.size >= maxNodes) break;
    const hop2Rels = getRelationships(title);
    for (const rel of hop2Rels) {
      if (nodes.size >= maxNodes) break;
      if (nodes.has(rel.target)) continue;
      addNode(rel.target, 2);
      edges.push({ from: title, to: rel.target, type: rel.type });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

function relPath(from, to) {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
  const ups = fromParts.length - common;
  return '../'.repeat(ups) + toParts.slice(common).join('/');
}

function renderRelationshipSVG(graph, options = {}) {
  if (graph.nodes.length <= 1) return '';

  const width = options.width || 600;
  const height = options.height || 400;
  const cx = width / 2;
  const cy = height / 2;

  const center = graph.nodes.find(n => n.hop === 0);
  const hop1 = graph.nodes.filter(n => n.hop === 1);
  const hop2 = graph.nodes.filter(n => n.hop === 2);

  const positions = new Map();
  positions.set(center.id, { x: cx, y: cy });

  const r1 = Math.min(width, height) * 0.3;
  hop1.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / hop1.length - Math.PI / 2;
    positions.set(n.id, { x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle) });
  });

  const r2 = Math.min(width, height) * 0.45;
  hop2.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(hop2.length, 1) - Math.PI / 4;
    positions.set(n.id, { x: cx + r2 * Math.cos(angle), y: cy + r2 * Math.sin(angle) });
  });

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: var(--font-body, system-ui);">\n`;

  for (const edge of graph.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const fromNode = graph.nodes.find(n => n.id === edge.from);
    const toNode = graph.nodes.find(n => n.id === edge.to);
    const isHop2 = (fromNode && fromNode.hop >= 1) && (toNode && toNode.hop >= 1);
    const dash = isHop2 ? ' stroke-dasharray="4,4"' : '';
    svg += `  <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="var(--border, #30363d)" stroke-width="1.5"${dash}/>\n`;
  }

  for (const node of graph.nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const size = node.hop === 0 ? 28 : node.hop === 1 ? 20 : 14;
    const opacity = node.hop === 2 ? 0.5 : 1;
    const fill = node.hop === 0 ? 'var(--accent, #58a6ff)' : 'var(--bg-card, #232830)';
    const stroke = node.hop === 0 ? 'var(--accent, #58a6ff)' : 'var(--border, #30363d)';

    const href = (node.outputPath && options.currentOutputPath) ? relPath(options.currentOutputPath, node.outputPath) : node.outputPath;
    const linkOpen = href ? `<a href="${escapeHtml(href)}">` : '';
    const linkClose = href ? '</a>' : '';

    svg += `  ${linkOpen}<g opacity="${opacity}">\n`;

    if (node.shape === 'rounded-square') {
      svg += `    <rect x="${pos.x - size}" y="${pos.y - size}" width="${size * 2}" height="${size * 2}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>\n`;
    } else if (node.shape === 'hexagon') {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push(`${pos.x + size * Math.cos(a)},${pos.y + size * Math.sin(a)}`);
      }
      svg += `    <polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>\n`;
    } else if (node.shape === 'diamond') {
      svg += `    <polygon points="${pos.x},${pos.y - size} ${pos.x + size},${pos.y} ${pos.x},${pos.y + size} ${pos.x - size},${pos.y}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>\n`;
    } else {
      svg += `    <circle cx="${pos.x}" cy="${pos.y}" r="${size}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>\n`;
    }

    const fontSize = node.hop === 2 ? 9 : 11;
    const label = node.displayTitle.length > 15 ? node.displayTitle.slice(0, 13) + '…' : node.displayTitle;
    svg += `    <text x="${pos.x}" y="${pos.y + size + fontSize + 4}" text-anchor="middle" font-size="${fontSize}" fill="var(--text, #c9d1d9)">${escapeHtml(label)}</text>\n`;
    svg += `  </g>${linkClose}\n`;
  }

  svg += '</svg>';
  return svg;
}

module.exports = { buildRelationshipGraph, renderRelationshipSVG };
