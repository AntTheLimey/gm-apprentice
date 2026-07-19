'use strict';
const { getInitials } = require('./landing-data');
const { relativeHref, escapeHtml, encodeImageUrl } = require('../processor');

// Circular avatar: portrait thumbnail when the PC has one, initials otherwise.
// Shared by every system's party board.
function avatarHtml(pc, rosterOutputPath) {
  if (pc.portrait) {
    const src = encodeImageUrl(relativeHref(rosterOutputPath, pc.portrait));
    return `<span class="gl-av gl-av-img"><img src="${escapeHtml(src)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="gl-av">${escapeHtml(getInitials(pc.name))}</span>`;
}

module.exports = { avatarHtml };
