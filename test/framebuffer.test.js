import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Framebuffer, WIDTH, HEIGHT } from '../src/framebuffer.js';

test('256x64, one grey level per pixel, row-major', () => {
  assert.equal(WIDTH, 256);
  assert.equal(HEIGHT, 64);
  const fb = new Framebuffer();
  assert.equal(fb.buffer.length, 256 * 64);
  fb.setPixel(5, 9);
  assert.equal(fb.buffer[5 + 9 * WIDTH], 15);
  fb.setPixel(6, 9, 4);
  assert.equal(fb.getPixel(6, 9), 4);
  assert.ok(fb.getPixel(5, 9));
  assert.ok(!fb.getPixel(5, 10));
  fb.setPixel(5, 9, false);
  assert.equal(fb.getPixel(5, 9), 0);
});

test('levels are clamped to 0..15', () => {
  const fb = new Framebuffer();
  fb.setPixel(0, 0, 99);
  fb.setPixel(1, 0, -3);
  fb.setPixel(2, 0, true);
  assert.equal(fb.getPixel(0, 0), 15);
  assert.equal(fb.getPixel(1, 0), 0);
  assert.equal(fb.getPixel(2, 0), 15);
});

test('out-of-bounds pixels clip silently', () => {
  const fb = new Framebuffer();
  fb.setPixel(-1, 0);
  fb.setPixel(0, -1);
  fb.setPixel(WIDTH, 0);
  fb.setPixel(0, HEIGHT);
  assert.ok(fb.buffer.every((b) => b === 0));
  fb.fillRect(WIDTH - 8, 60, 20, 20); // partially in bounds
  assert.ok(fb.getPixel(WIDTH - 1, 63));
  assert.ok(!fb.getPixel(WIDTH - 9, 63));
  fb.fillRect(-50, -50, 60, 60);
  assert.ok(fb.getPixel(0, 0));
  assert.ok(fb.getPixel(9, 9));
  assert.ok(!fb.getPixel(10, 9));
});

test('fillRect and drawText take a grey level', () => {
  const fb = new Framebuffer();
  fb.fillRect(0, 0, 2, 2, 3);
  assert.equal(fb.getPixel(1, 1), 3);
  fb.clear();
  fb.drawText(0, 0, 'I', 1, 7);
  assert.ok(fb.buffer.some((b) => b === 7));
  assert.ok(fb.buffer.every((b) => b === 0 || b === 7));
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
  assert.ok(fb.buffer.some((b, i) => i % WIDTH >= 12 && b !== 0));
});
