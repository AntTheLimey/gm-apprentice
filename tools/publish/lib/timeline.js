const { escapeHtml } = require('./processor');

function parseDate(value) {
  const s = String(value);
  const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (parts) return new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));

  // Handle vague/seasonal dates like "Autumn 1813", "Late Spring 1813", "Summer 1813"
  const yearMatch = s.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const year = +yearMatch[1];
    const lower = s.toLowerCase();
    const seasonMap = { spring: 3, summer: 6, autumn: 9, fall: 9, winter: 0 };
    let month = null;
    for (const [season, baseMonth] of Object.entries(seasonMap)) {
      if (lower.includes(season)) {
        month = baseMonth;
        if (lower.includes('early')) month = Math.max(0, month - 1);
        if (lower.includes('late')) month = Math.min(11, month + 1);
        break;
      }
    }
    if (month === null) month = 5; // no season keyword — default to June
    return new Date(Date.UTC(year, month, 1));
  }

  return new Date(s);
}

function buildTimelineData(pages) {
  const events = pages
    .filter(p => p.frontmatter.type === 'event' && (p.frontmatter.in_game_date || p.frontmatter.date))
    .map(p => ({
      title: p.displayTitle,
      date: parseDate(p.frontmatter.in_game_date || p.frontmatter.date),
      type: 'event',
      outputPath: p.outputPath,
      outcome: p.frontmatter.outcome || '',
      location: p.frontmatter.location
        ? String(p.frontmatter.location).replace(/\[\[|\]\]/g, '').trim()
        : '',
    }));

  const sessions = pages
    .filter(p => p.frontmatter.type === 'session' && p.frontmatter.in_game_date)
    .flatMap(p => {
      const dates = Array.isArray(p.frontmatter.in_game_date)
        ? p.frontmatter.in_game_date
        : [p.frontmatter.in_game_date];
      return dates.map(d => ({
        title: p.displayTitle,
        date: parseDate(d),
        type: 'session',
        outputPath: p.outputPath,
        number: p.frontmatter.session_number,
        outcome: '',
        location: p.frontmatter.location
          ? String(p.frontmatter.location).replace(/\[\[|\]\]/g, '').trim()
          : '',
      }));
    });

  const chapters = pages
    .filter(p => p.frontmatter.type === 'chapter')
    .map(p => ({
      title: p.displayTitle,
      sortOrder: p.frontmatter.sort_order || 0,
      type: 'chapter',
      outputPath: p.outputPath,
    }));

  const allDated = [...events, ...sessions]
    .filter(e => !isNaN(e.date.getTime()))
    .sort((a, b) => a.date - b.date);

  return { events: allDated, chapters };
}

function formatDateParts(d) {
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return { month, day, year };
}

function renderTimelineHTML(data) {
  if (data.events.length === 0) return '';

  const nodes = data.events.map(evt => {
    const dp = formatDateParts(evt.date);
    const typeClass = evt.type === 'session' ? 'tl-session' : 'tl-event';
    const badge = evt.type === 'session' ? 'Session' : 'Event';
    const details = [];
    if (evt.outcome) details.push(evt.outcome);
    if (evt.location) details.push(evt.location);

    return `<div class="tl-entry ${typeClass}">
  <div class="tl-date-col">
    <div class="tl-year">${dp.year}</div>
    <div class="tl-monthday">${escapeHtml(dp.month)} ${dp.day}</div>
  </div>
  <div class="tl-line-col">
    <div class="tl-dot"></div>
  </div>
  <div class="tl-detail-col">
    <span class="tl-type">${escapeHtml(badge)}</span>
    <h3><a href="${escapeHtml(evt.outputPath)}">${escapeHtml(evt.title)}</a></h3>
    ${details.length ? `<p>${escapeHtml(details.join(' — '))}</p>` : ''}
  </div>
</div>`;
  }).join('\n');

  return `<div class="tl-timeline">\n${nodes}\n</div>`;
}

function renderTimelineStrip(data, options) {
  const maxEvents = (options && options.maxEvents) || 10;
  const recent = data.events.slice(-maxEvents);
  if (recent.length === 0) return '';

  const nodes = recent.map(evt => {
    const dp = formatDateParts(evt.date);
    const typeClass = evt.type === 'session' ? 'tl-session' : 'tl-event';

    return `<div class="tl-entry ${typeClass}">
  <div class="tl-date-col">
    <div class="tl-year">${dp.year}</div>
    <div class="tl-monthday">${escapeHtml(dp.month)} ${dp.day}</div>
  </div>
  <div class="tl-line-col">
    <div class="tl-dot"></div>
  </div>
  <div class="tl-detail-col">
    <h3><a href="${escapeHtml(evt.outputPath)}">${escapeHtml(evt.title)}</a></h3>
  </div>
</div>`;
  }).join('\n');

  return `<div class="tl-timeline tl-compact">\n${nodes}\n</div>`;
}

module.exports = { buildTimelineData, renderTimelineHTML, renderTimelineStrip };
