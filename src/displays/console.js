import { WIDTH, HEIGHT } from '../framebuffer.js';

export function createConsoleDisplay({ out = process.stdout } = {}) {
  let last = null;

  // Darkest to brightest; index = grey level * (RAMP.length - 1) / 15.
  const RAMP = '.:-=+*#%@';

  function render(fb) {
    // 2x downsample (128 columns x 32 rows), keeping the brightest pixel.
    const lines = [];
    for (let y = 0; y < HEIGHT; y += 2) {
      let line = '';
      for (let x = 0; x < WIDTH; x += 2) {
        const level = Math.max(
          fb.getPixel(x, y),
          fb.getPixel(x + 1, y),
          fb.getPixel(x, y + 1),
          fb.getPixel(x + 1, y + 1)
        );
        line += RAMP[Math.ceil((level * (RAMP.length - 1)) / 15)];
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
    async setBrightness() {},
    async reset() {
      last = null;
    },
    async off() {},
    async close() {},
  };
}
