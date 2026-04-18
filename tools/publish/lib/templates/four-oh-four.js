const { escapeHtml } = require('../processor');

function fourOhFourTemplate(config) {
  const message = escapeHtml(config.four_oh_four.message);
  const siteTitle = escapeHtml(config.siteTitle);
  const campaignImage = config.theme && config.theme.campaign_image;

  const imageHtml = campaignImage
    ? `<img src="${escapeHtml(campaignImage)}" alt="${siteTitle}" class="four-oh-four-image">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found — ${siteTitle}</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/theme.css">
  <style>
    .four-oh-four-hero {
      text-align: center;
      padding: 4rem 1rem;
      min-height: 60vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .four-oh-four-message {
      font-size: 1.5rem;
      font-style: italic;
      max-width: 36rem;
      margin: 2rem auto;
      line-height: 1.6;
      color: var(--theme-accent, var(--accent));
    }
    .four-oh-four-home {
      margin-top: 2rem;
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background: var(--theme-accent, var(--accent));
      color: var(--white, #fff);
      border-radius: 0.375rem;
      font-weight: 600;
      text-decoration: none;
    }
    .four-oh-four-home:hover {
      opacity: 0.85;
      text-decoration: none;
    }
    .four-oh-four-image {
      max-width: 24rem;
      width: 100%;
      height: auto;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>

<header class="site-header">
  <h1><a href="index.html">${siteTitle}</a></h1>
</header>

<main class="content">
  <div class="four-oh-four-hero">
    ${imageHtml}
    <p class="four-oh-four-message">${message}</p>
    <a href="index.html" class="four-oh-four-home">Return to Safety</a>
  </div>
</main>

</body>
</html>`;
}

module.exports = { fourOhFourTemplate };
