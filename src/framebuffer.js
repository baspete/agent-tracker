import { glyphColumns, CELL_WIDTH } from './font5x7.js';

export const WIDTH = 128;
export const HEIGHT = 64;

export class Framebuffer {
  constructor() {
    this.buffer = new Uint8Array((WIDTH * HEIGHT) / 8);
  }

  clear() {
    this.buffer.fill(0);
  }

  setPixel(x, y, on = true) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const i = x + (y >> 3) * WIDTH;
    if (on) {
      this.buffer[i] |= 1 << (y & 7);
    } else {
      this.buffer[i] &= ~(1 << (y & 7));
    }
  }

  getPixel(x, y) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return false;
    return (this.buffer[x + (y >> 3) * WIDTH] & (1 << (y & 7))) !== 0;
  }

  fillRect(x, y, w, h, on = true) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    w = Math.trunc(w);
    h = Math.trunc(h);
    if (w <= 0 || h <= 0) return;
    const x1 = Math.min(x + w, WIDTH);
    const y1 = Math.min(y + h, HEIGHT);
    for (let yy = Math.max(y, 0); yy < y1; yy++) {
      for (let xx = Math.max(x, 0); xx < x1; xx++) {
        this.setPixel(xx, yy, on);
      }
    }
  }

  drawText(x, y, text, scale = 1) {
    let cx = x;
    for (const ch of String(text)) {
      const cols = glyphColumns(ch.charCodeAt(0));
      for (let c = 0; c < cols.length; c++) {
        const bits = cols[c];
        for (let r = 0; r < 7; r++) {
          if (bits & (1 << r)) {
            this.fillRect(cx + c * scale, y + r * scale, scale, scale);
          }
        }
      }
      cx += CELL_WIDTH * scale;
    }
  }
}
