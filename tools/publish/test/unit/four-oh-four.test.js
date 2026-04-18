const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fourOhFourTemplate } = require('../../lib/templates/four-oh-four');

describe('fourOhFourTemplate', () => {
  const baseConfig = {
    siteTitle: 'Test Campaign',
    four_oh_four: {
      message: 'The stars are not yet right...',
    },
    theme: {
      campaign_image: null,
    },
  };

  it('renders the 404 message', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('The stars are not yet right...'));
  });

  it('includes the site title', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('Test Campaign'));
  });

  it('includes a link back to home', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('href="index.html"'));
  });

  it('is a valid HTML document', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('references theme.css', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('theme.css'));
  });

  it('includes campaign image when provided', () => {
    const config = {
      ...baseConfig,
      theme: { campaign_image: 'images/publish/campaign-header.png' },
    };
    const html = fourOhFourTemplate(config);
    assert.ok(html.includes('campaign-header.png'));
  });

  it('includes generated SVG placeholder when no image', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('four-oh-four-hero'));
  });

  it('escapes HTML in message', () => {
    const config = {
      ...baseConfig,
      four_oh_four: { message: '<script>alert("xss")</script>' },
    };
    const html = fourOhFourTemplate(config);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});
