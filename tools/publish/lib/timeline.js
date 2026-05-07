const { escapeHtml } = require('./processor');

function buildTimelineData(pages) {
  const events = pages
    .filter(p => p.frontmatter.type === 'event' && p.frontmatter.date)
    .map(p => ({
      title: p.displayTitle,
      date: new Date(p.frontmatter.date),
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
        date: new Date(d),
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
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = d.getDate();
  const year = d.getFullYear();
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
