import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Framebuffer, WIDTH } from '../src/framebuffer.js';

test('pixel addressing matches the SSD1306 page layout', () => {
  const fb = new Framebuffer();
  assert.equal(fb.buffer.length, 1024);
  fb.setPixel(5, 9); // page 1, bit 1
  assert.equal(fb.buffer[5 + 1 * WIDTH], 0b10);
  fb.setPixel(5, 8); // page 1, bit 0
  assert.equal(fb.buffer[5 + 1 * WIDTH], 0b11);
  assert.ok(fb.getPixel(5, 9));
  assert.ok(!fb.getPixel(5, 10));
  fb.setPixel(5, 9, false);
  assert.equal(fb.buffer[5 + 1 * WIDTH], 0b01);
});

test('out-of-bounds pixels clip silently', () => {
  const fb = new Framebuffer();
  fb.setPixel(-1, 0);
  fb.setPixel(0, -1);
  fb.setPixel(128, 0);
  fb.setPixel(0, 64);
  assert.ok(fb.buffer.every((b) => b === 0));
  fb.fillRect(120, 60, 20, 20); // partially in bounds
  assert.ok(fb.getPixel(127, 63));
  fb.fillRect(-50, -50, 60, 60);
  assert.ok(fb.getPixel(0, 0));
});

test('drawText lights pixels for A and none for space', () => {
  const fb = new Framebuffer();
  fb.drawText(0, 0, 'A');
  assert.ok(fb.buffer.some((b) => b !== 0));
  fb.clear();
  fb.drawText(0, 0, ' ');
  assert.ok(fb.buffer.every((b) => b === 0));
});

test('drawText at scale 2 covers a 12px cell advance', () => {
  const fb = new Framebuffer();
  fb.drawText(0, 0, 'II', 2); // second glyph starts at x=12
  assert.ok(fb.buffer.some((b, i) => (i % WIDTH) >= 12 && b !== 0));
});
