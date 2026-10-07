'use strict';
const { frameArt } = require('./frames');
const { escapeHtml } = require('../processor');

// The square portrait block a frame sits round: the picture (or the initials), clipped
// to the frame's inner shape, under the frame's drawing.
function framedPortrait({ frame, imgUrl, alt, initials }) {
  const art = frameArt(frame);
  const pic = imgUrl
    ? `<img src="${imgUrl}" alt="${escapeHtml(alt || '')}">`
    : `<span class="sk-initials">${escapeHtml(initials || '')}</span>`;
  return `<div class="pc-portrait sk-portrait" data-frame="${frame}">`
    + `<div class="sk-pic" style="clip-path:${art.clip}">${pic}</div>`
    + `<svg class="sk-frame" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${art.svg}</svg>`
    + `</div>`;
}

module.exports = { framedPortrait };
