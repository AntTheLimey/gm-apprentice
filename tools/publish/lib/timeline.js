function buildTimelineData(pages) {
  const events = pages
    .filter(p => p.frontmatter.type === 'event' && p.frontmatter.date)
    .map(p => ({ title: p.displayTitle, date: new Date(p.frontmatter.date), type: 'event', outputPath: p.outputPath }));

  const sessions = pages
    .filter(p => p.frontmatter.type === 'session' && p.frontmatter.actual_date)
    .map(p => ({ title: p.displayTitle, date: new Date(p.frontmatter.actual_date), type: 'session', outputPath: p.outputPath, number: p.frontmatter.session_number }));

  const chapters = pages
    .filter(p => p.frontmatter.type === 'chapter')
    .map(p => ({ title: p.displayTitle, sortOrder: p.frontmatter.sort_order || 0, type: 'chapter', outputPath: p.outputPath }));

  const allDated = [...events, ...sessions]
    .filter(e => !isNaN(e.date.getTime()))
    .sort((a, b) => a.date - b.date);

  return { events: allDated, chapters };
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncLabel(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function renderTimelineNodes(events, startX, spacing, y, height) {
  if (events.length === 0) return '';

  const width = startX * 2 + (events.length - 1) * spacing;
  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:var(--font-body,system-ui)">\n`;

  svg += `  <line x1="${startX}" y1="${y}" x2="${startX + (events.length - 1) * spacing}" y2="${y}" stroke="var(--border,#30363d)" stroke-width="2"/>\n`;

  events.forEach((evt, i) => {
    const x = startX + i * spacing;
    const label = truncLabel(evt.title, 16);
    const dateStr = evt.date.toISOString().slice(0, 10);

    svg += `  <a href="${escapeXml(evt.outputPath)}">\n`;
    if (evt.type === 'session') {
      svg += `    <rect x="${x - 6}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--accent,#58a6ff)" stroke="var(--bg,#1a1f25)" stroke-width="2"/>\n`;
    } else {
      svg += `    <circle cx="${x}" cy="${y}" r="6" fill="var(--accent,#58a6ff)" stroke="var(--bg,#1a1f25)" stroke-width="2"/>\n`;
    }
    svg += `    <text x="${x}" y="${y - 14}" text-anchor="middle" font-size="10" fill="var(--text,#c9d1d9)">${escapeXml(label)}</text>\n`;
    svg += `    <text x="${x}" y="${y + 20}" text-anchor="middle" font-size="8" fill="var(--text-muted,#8b949e)">${escapeXml(dateStr)}</text>\n`;
    svg += `  </a>\n`;
  });

  svg += '</svg>';
  return svg;
}

function renderTimelineSVG(data, options) {
  if (data.events.length === 0) return '';
  const spacing = (options && options.spacing) || 100;
  return renderTimelineNodes(data.events, 60, spacing, 50, 90);
}

function renderTimelineStrip(data, options) {
  const maxEvents = (options && options.maxEvents) || 10;
  const recent = data.events.slice(-maxEvents);
  if (recent.length === 0) return '';
  return renderTimelineNodes(recent, 40, 80, 35, 70);
}

module.exports = { buildTimelineData, renderTimelineSVG, renderTimelineStrip };
