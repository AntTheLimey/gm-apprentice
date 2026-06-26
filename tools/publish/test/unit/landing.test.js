const { describe, it } = require('node:test');
const assert = require('node:assert');
const { landingTemplate } = require('../../lib/templates/landing');

const navFor = () => '<nav></nav>';
const config = { siteTitle: 'Canticle of the End', attachmentsDir: '_attachments', footer: '', siteUrl: '' };
const publishConfig = { theme: {}, setting_year: 1814 };

function sessionPage() {
  return {
    frontmatter: { type: 'session', status: 'reviewed', session_number: 3, play_date: 'June 25, 2026' },
    title: 'Session 03 - Give Rest',
    displayTitle: 'Give Rest',
    outputDir: 'chapters/c4',
    outputPath: 'chapters/c4/session-03-give-rest.html',
    markdown: '# Session 03\n\n## Narrative Recap\n\nThe becalming broke and the wind returned.',
  };
}

function overviewPage() {
  return {
    // Deliberately drifted filename — the lookup is by frontmatter type, not by filename.
    frontmatter: {
      type: 'campaign_overview',
      campaign: 'Canticle of the End',
      current_game_date: 'September 9, 1814',
      sessions_played: 17,
      last_session: '[[Session 03 - Give Rest]]',
      last_play_date: 'June 25, 2026',
    },
    title: 'Campaign_Overview_Updated',
    markdown: '# Overview',
  };
}

describe('landingTemplate — campaign overview metadata', () => {
  it('reads in-game date, session count and latest session from the overview, even when it is excluded from the published pages', () => {
    const session = sessionPage();
    const pages = [session];                  // published set — overview deliberately absent
    const corpus = [overviewPage(), session]; // full corpus — overview present
    const html = landingTemplate(pages, navFor, config, publishConfig, {}, corpus);
    assert.ok(html.includes('September 9, 1814'), 'in-game date comes from current_game_date');
    assert.ok(/Sessions<\/span>\s*17/.test(html), 'session count comes from sessions_played');
    assert.ok(html.includes('June 25, 2026'), 'latest-session date comes from last_play_date');
    assert.ok(html.includes('session-03-give-rest.html'), 'latest session resolved from last_session');
  });

  it('falls back to setting_year and the scanned count when no overview metadata exists', () => {
    const session = sessionPage();
    const html = landingTemplate([session], navFor, config, publishConfig, {}, [session]);
    assert.ok(html.includes('1814'), 'in-game falls back to setting_year');
    assert.ok(/Sessions<\/span>\s*1/.test(html), 'session count falls back to counting played/reviewed pages');
  });
});
