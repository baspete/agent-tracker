import { glyphColumns, CELL_WIDTH } from './font5x7.js';

export const WIDTH = 256;
export const HEIGHT = 64;
export const MAX_LEVEL = 15;

// One byte per pixel holding a grey level 0 (off) .. 15 (full brightness).
export class Framebuffer {
  constructor() {
    this.buffer = new Uint8Array(WIDTH * HEIGHT);
  }

  clear() {
    this.buffer.fill(0);
  }

  // `level` may be a boolean (true = full brightness) or a number 0..15.
  setPixel(x, y, level = MAX_LEVEL) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    this.buffer[x + y * WIDTH] = toLevel(level);
  }

  // Returns the grey level (0 when off or out of bounds), so it is falsy
  // exactly when the pixel is dark.
  getPixel(x, y) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return 0;
    return this.buffer[x + y * WIDTH];
  }

  fillRect(x, y, w, h, level = MAX_LEVEL) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    w = Math.trunc(w);
    h = Math.trunc(h);
    if (w <= 0 || h <= 0) return;
    const v = toLevel(level);
    const x0 = Math.max(x, 0);
    const x1 = Math.min(x + w, WIDTH);
    const y1 = Math.min(y + h, HEIGHT);
    if (x1 <= x0) return;
    for (let yy = Math.max(y, 0); yy < y1; yy++) {
      this.buffer.fill(v, x0 + yy * WIDTH, x1 + yy * WIDTH);
    }
  }

  drawText(x, y, text, scale = 1, level = MAX_LEVEL) {
    let cx = x;
    for (const ch of String(text)) {
      const cols = glyphColumns(ch.charCodeAt(0));
      for (let c = 0; c < cols.length; c++) {
        const bits = cols[c];
        for (let r = 0; r < 7; r++) {
          if (bits & (1 << r)) {
            this.fillRect(cx + c * scale, y + r * scale, scale, scale, level);
          }
        }
      }
      cx += CELL_WIDTH * scale;
    }
  }
}

function toLevel(level) {
  if (level === true) return MAX_LEVEL;
  if (level === false) return 0;
  const n = Math.round(Number(level));
  if (!(n > 0)) return 0;
  return n > MAX_LEVEL ? MAX_LEVEL : n;
}
