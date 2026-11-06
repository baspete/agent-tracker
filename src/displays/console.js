import { WIDTH, HEIGHT } from '../framebuffer.js';

export function createConsoleDisplay({ out = process.stdout } = {}) {
  let last = null;

  function render(fb) {
    // 2x downsample: 64 columns x 32 rows of '#' / '.'
    const lines = [];
    for (let y = 0; y < HEIGHT; y += 2) {
      let line = '';
      for (let x = 0; x < WIDTH; x += 2) {
        const on =
          fb.getPixel(x, y) ||
          fb.getPixel(x + 1, y) ||
          fb.getPixel(x, y + 1) ||
          fb.getPixel(x + 1, y + 1);
        line += on ? '#' : '.';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  return {
    async init() {},
    async show(fb) {
      const frame = render(fb);
      if (frame === last) return;
      last = frame;
      out.write(frame + '\n');
    },
    async reset() {
      last = null;
    },
    async off() {},
    async close() {},
  };
}
