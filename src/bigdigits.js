// Anti-aliased rounded stroke digits for the large count. Glyphs are
// polylines in a unit box (y down); arcs are sampled into points.
// Angles are in degrees, 0 = right, 90 = down.

const arc = (cx, cy, rx, ry, a0, a1, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
const flip = (lines) => lines.map((l) => l.map(([x, y]) => [1 - x, 1 - y]));

const SIX = [[[0.78, 0], ...arc(0.5, 0.69, 0.5, 0.31, 205, 565)]];
const GLYPHS = {
  0: [
    [
      ...arc(0.5, 0.27, 0.5, 0.27, 180, 360),
      ...arc(0.5, 0.73, 0.5, 0.27, 0, 180),
      [0, 0.27],
    ],
  ],
  1: [[[0.15, 0.2], [0.6, 0], [0.6, 1]]],
  2: [[...arc(0.5, 0.27, 0.5, 0.27, 200, 400), [0, 1], [1, 1]]],
  3: [
    [
      ...arc(0.5, 0.25, 0.46, 0.25, 205, 450),
      ...arc(0.5, 0.75, 0.5, 0.25, 270, 515),
    ],
  ],
  4: [[[0.75, 1], [0.75, 0], [0, 0.68], [1, 0.68]]],
  5: [[[0.95, 0], [0.12, 0], [0.05, 0.47], ...arc(0.5, 0.7, 0.5, 0.3, 222, 520)]],
  6: SIX,
  7: [[[0, 0], [1, 0], [0.32, 1]]],
  8: [arc(0.5, 0.25, 0.43, 0.25, 0, 360), arc(0.5, 0.75, 0.5, 0.25, 0, 360)],
  9: flip(SIX),
  '-': [[[0.15, 0.5], [0.85, 0.5]]],
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}

const SUPERSAMPLE = 4;
const cache = new Map();

// Returns a (w+2)x(h+2) coverage bitmap (0..1 per pixel) with a 1px border,
// cached per glyph and size since rendering it is relatively expensive.
function glyphBitmap(ch, w, h, t) {
  const key = `${ch}:${w}:${h}:${t}`;
  let bm = cache.get(key);
  if (bm) return bm;
  const r = t / 2;
  const segs = [];
  for (const line of GLYPHS[ch] ?? []) {
    const pts = line.map(([x, y]) => [1 + r + x * (w - t), 1 + r + y * (h - t)]);
    for (let i = 1; i < pts.length; i++) segs.push([...pts[i - 1], ...pts[i]]);
  }
  const bw = w + 2;
  const bh = h + 2;
  const S = SUPERSAMPLE;
  bm = { w: bw, h: bh, data: new Float32Array(bw * bh) };
  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;
          for (const s of segs) {
            if (segDist(x, y, s[0], s[1], s[2], s[3]) <= r) {
              hits++;
              break;
            }
          }
        }
      }
      bm.data[py * bw + px] = hits / (S * S);
    }
  }
  cache.set(key, bm);
  return bm;
}

export function drawBigDigit(fb, x, y, ch, { w, h, t, level = 15 }) {
  const bm = glyphBitmap(ch, w, h, t);
  for (let py = 0; py < bm.h; py++) {
    for (let px = 0; px < bm.w; px++) {
      const cov = bm.data[py * bm.w + px];
      if (cov <= 0) continue;
      const v = Math.round(cov * level);
      const fx = x + px - 1;
      const fy = y + py - 1;
      if (v > fb.getPixel(fx, fy)) fb.setPixel(fx, fy, v);
    }
  }
}

// Draws `text` centred on cx, shrinking the digit width so it fits maxWidth.
// Returns the drawn digit width.
export function drawBigNumber(
  fb,
  cx,
  y,
  text,
  { w = 26, h = 44, t = 6, gap = 5, maxWidth = Infinity, level = 15 } = {}
) {
  const n = text.length;
  if (n === 0) return 0;
  const fit = Math.floor((maxWidth - gap * (n - 1)) / n);
  const dw = Math.max(t + 2, Math.min(w, fit));
  const total = n * dw + (n - 1) * gap;
  let x = Math.round(cx - total / 2);
  for (const ch of text) {
    drawBigDigit(fb, x, y, ch, { w: dw, h, t, level });
    x += dw + gap;
  }
  return dw;
}
