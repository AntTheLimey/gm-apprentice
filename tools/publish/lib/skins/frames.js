'use strict';

// Eight portrait frames, drawn in code for a 120 x 120 view box.
// Every element carries a layer class (s1, s3, s4, f, hi, jewel, plate) and no
// colour, so a skin colours the frame from its own palette.

const n1 = (v) => v.toFixed(1);
const pt = (r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [60 + r * Math.cos(a), 60 + r * Math.sin(a)];
};
const seq = (n, fn) => {
  const s = [];
  for (let i = 0; i < n; i++) s.push(fn(i));
  return s;
};
const poly = (n, r, rot) => seq(n, (i) => pt(r, (rot || 0) + i * 360 / n).map(n1).join(',')).join(' ');
const clipPoly = (n, rot) => 'polygon(' + seq(n, (i) => pt(50, rot + i * 360 / n).map((v) => n1(v - 10) + '%').join(' ')).join(',') + ')';
const around = (n, fn, start) => seq(n, (i) => fn((start || 0) + i * 360 / n, i)).join('');
const ring = (cls) => '<circle cx="60" cy="60" r="46" class="' + cls + '"/>';
const dot = (r, d, size) => {
  const p = pt(r, d);
  return '<circle cx="' + n1(p[0]) + '" cy="' + n1(p[1]) + '" r="' + size + '" class="f"/>';
};

const ART = {
  ring: {
    clip: 'circle(50%)',
    svg: () => ring('s3') + '<circle cx="60" cy="60" r="51.5" class="s1"/>',
  },
  laurel: {
    clip: 'circle(50%)',
    svg: () => {
      const leaf = (deg, tilt) => '<ellipse rx="3" ry="7.5" class="f" transform="rotate(' + n1(deg) + ' 60 60) translate(60 8.5) rotate(' + tilt + ')"/>';
      let s = '<circle cx="60" cy="60" r="45.5" class="s1"/>';
      for (let d = 22; d <= 160; d += 12.5) s += leaf(d, -38) + leaf(-d, 38);
      return s + '<circle cx="60" cy="112" r="2.6" class="f"/>';
    },
  },
  thorns: {
    clip: 'circle(50%)',
    svg: () => ring('s3') + around(18, (d, i) => '<polygon class="f" points="57,14.5 ' + (i % 2 ? '61,6' : '62,1.5') + ' 63.5,14.5" transform="rotate(' + n1(d) + ' 60 60)"/>'),
  },
  gilt: {
    clip: 'circle(50%)',
    svg: () => around(28, (d) => dot(51, d, 3.4)) + ring('s4') + ring('hi')
      + around(4, (d) => {
        const p = pt(51, d);
        return '<rect x="' + n1(p[0] - 4.5) + '" y="' + n1(p[1] - 4.5) + '" width="9" height="9" class="jewel" transform="rotate(45 ' + n1(p[0]) + ' ' + n1(p[1]) + ')"/>';
      }),
  },
  steel: {
    clip: clipPoly(8, 22.5),
    svg: () => '<path class="plate" fill-rule="evenodd" d="M' + poly(8, 57, 22.5).split(' ').join('L') + 'Z M' + poly(8, 46.5, 22.5).split(' ').join('L') + 'Z"/>'
      + around(8, (d) => dot(51.5, d, 2.2), 22.5),
  },
  corners: {
    clip: 'inset(0)',
    svg: () => '<rect x="13.5" y="13.5" width="93" height="93" class="s1"/>'
      + around(4, (d) => '<path class="f" d="M8 8h24L8 32z" transform="rotate(' + n1(d) + ' 60 60)"/>'),
  },
  hex: {
    clip: clipPoly(6, 0),
    svg: () => '<polygon points="' + poly(6, 57) + '" class="s3"/><polygon points="' + poly(6, 48.5) + '" class="s1"/>'
      + around(6, (d) => {
        const a = pt(43, d);
        const b = pt(48.5, d);
        return '<line x1="' + n1(a[0]) + '" y1="' + n1(a[1]) + '" x2="' + n1(b[0]) + '" y2="' + n1(b[1]) + '" class="s1"/>';
      }, 30),
  },
  cracked: {
    clip: 'circle(50%)',
    svg: () => '<circle cx="60" cy="60" r="46" class="s4" stroke-dasharray="62 5 40 3 75 6 30 4 64"/>'
      + '<polyline class="s1" points="97,24 90,31 94,36 85,43"/><polyline class="s1" points="20,88 28,84 27,78 36,74"/><polyline class="s1" points="100,84 108,90 106,96"/><polyline class="s1" points="14,40 8,36 10,30"/>',
  },
};

const frameArt = (id) => {
  if (!Object.prototype.hasOwnProperty.call(ART, id)) throw new Error('unknown frame: ' + id);
  return { svg: ART[id].svg(), clip: ART[id].clip };
};

module.exports = { frameArt };
