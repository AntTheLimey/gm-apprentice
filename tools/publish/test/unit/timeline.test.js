const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildTimelineData, renderTimelineSVG, renderTimelineStrip } = require('../../lib/timeline');

describe('buildTimelineData', () => {
  const pages = [
    { displayTitle: 'Battle of Berlin', outputPath: 'events/battle.html', frontmatter: { type: 'event', date: '1945-04-16' } },
    { displayTitle: 'V-E Day', outputPath: 'events/ve-day.html', frontmatter: { type: 'event', date: '1945-05-08' } },
    { displayTitle: 'Session 1', outputPath: 'sessions/s1.html', frontmatter: { type: 'session', actual_date: '2024-01-15', session_number: 1 } },
    { displayTitle: 'Session 2', outputPath: 'sessions/s2.html', frontmatter: { type: 'session', actual_date: '2024-02-01', session_number: 2 } },
    { displayTitle: 'Chapter 1', outputPath: 'chapters/ch1.html', frontmatter: { type: 'chapter', sort_order: 1 } },
    { displayTitle: 'Some NPC', outputPath: 'npcs/npc.html', frontmatter: { type: 'npc' } },
  ];

  it('extracts events and sessions sorted by date', () => {
    const data = buildTimelineData(pages);
    assert.ok(data.events.length === 4);
    assert.strictEqual(data.events[0].title, 'Battle of Berlin');
    assert.strictEqual(data.events[1].title, 'V-E Day');
  });

  it('extracts chapters', () => {
    const data = buildTimelineData(pages);
    assert.strictEqual(data.chapters.length, 1);
    assert.strictEqual(data.chapters[0].title, 'Chapter 1');
  });

  it('excludes non-event non-session pages', () => {
    const data = buildTimelineData(pages);
    const titles = data.events.map(e => e.title);
    assert.ok(!titles.includes('Some NPC'));
  });

  it('handles pages with invalid dates', () => {
    const pagesWithBad = [
      { displayTitle: 'Bad', outputPath: 'e/bad.html', frontmatter: { type: 'event', date: 'not-a-date' } },
      { displayTitle: 'Good', outputPath: 'e/good.html', frontmatter: { type: 'event', date: '1945-01-01' } },
    ];
    const data = buildTimelineData(pagesWithBad);
    assert.strictEqual(data.events.length, 1);
    assert.strictEqual(data.events[0].title, 'Good');
  });
});

describe('renderTimelineSVG', () => {
  it('returns empty string for no events', () => {
    const svg = renderTimelineSVG({ events: [], chapters: [] });
    assert.strictEqual(svg, '');
  });

  it('returns SVG with event nodes', () => {
    const data = {
      events: [
        { title: 'Event A', date: new Date('1945-01-01'), type: 'event', outputPath: 'e/a.html' },
        { title: 'Event B', date: new Date('1945-06-01'), type: 'event', outputPath: 'e/b.html' },
      ],
      chapters: [],
    };
    const svg = renderTimelineSVG(data);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Event A'));
    assert.ok(svg.includes('Event B'));
    assert.ok(svg.includes('e/a.html'));
  });

  it('renders sessions as squares', () => {
    const data = {
      events: [{ title: 'S1', date: new Date('2024-01-01'), type: 'session', outputPath: 's/1.html' }],
      chapters: [],
    };
    const svg = renderTimelineSVG(data);
    assert.ok(svg.includes('<rect'));
  });
});

describe('renderTimelineStrip', () => {
  it('limits to maxEvents', () => {
    const events = [];
    for (let i = 0; i < 20; i++) {
      events.push({ title: `E${i}`, date: new Date(2024, 0, i + 1), type: 'event', outputPath: `e/${i}.html` });
    }
    const svg = renderTimelineStrip({ events, chapters: [] }, { maxEvents: 5 });
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('E19'));
    assert.ok(!svg.includes('E0'));
  });
});
