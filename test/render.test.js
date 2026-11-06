import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Framebuffer, WIDTH } from '../src/framebuffer.js';
import { renderFrame } from '../src/render.js';

const config = { samples: 10, scaleMax: 20 };

function headerRegionEquals(fb, expectedText) {
  const expected = new Framebuffer();
  expected.drawText(0, 1, expectedText, 2);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (fb.getPixel(x, y) !== expected.getPixel(x, y)) return false;
    }
  }
  return true;
}

function colHeight(fb, x) {
  let h = 0;
  for (let y = 16; y <= 62; y++) {
    if (fb.getPixel(x, y)) h = 62 - y + 1 > h ? 62 - y + 1 : h;
  }
  return h;
}

test('header shows AGENTS value', () => {
  const fb = new Framebuffer();
  renderFrame(fb, { history: [3], lastValue: 3, lastError: null }, config);
  assert.ok(headerRegionEquals(fb, 'AGENTS 3'));
});

test('header shows AGENTS -- when no value yet', () => {
  const fb = new Framebuffer();
  renderFrame(fb, { history: [], lastValue: null, lastError: null }, config);
  assert.ok(headerRegionEquals(fb, 'AGENTS --'));
});

test('header shows error labels by kind', () => {
  for (const [kind, text] of [
    ['auth', 'AUTH ERROR'],
    ['network', 'NET ERROR'],
    ['timeout', 'NET ERROR'],
    ['http', 'API ERROR'],
    ['parse', 'API ERROR'],
  ]) {
    const fb = new Framebuffer();
    renderFrame(
      fb,
      { history: [], lastValue: null, lastError: { kind } },
      config
    );
    assert.ok(headerRegionEquals(fb, text), `kind=${kind}`);
  }
});

test('value == scaleMax gives 47px bar', () => {
  const fb = new Framebuffer();
  renderFrame(
    fb,
    { history: [20], lastValue: 20, lastError: null },
    config
  );
  const x = 9 * Math.floor(WIDTH / 10); // newest in rightmost slot
  assert.equal(colHeight(fb, x), 47);
  assert.ok(!fb.getPixel(x, 15));
  assert.ok(fb.getPixel(x, 16));
  assert.ok(fb.getPixel(x, 62));
});

test('value 0 lights only the baseline', () => {
  const fb = new Framebuffer();
  renderFrame(fb, { history: [0], lastValue: 0, lastError: null }, config);
  const x = 9 * Math.floor(WIDTH / 10);
  assert.equal(colHeight(fb, x), 0);
  assert.ok(fb.getPixel(x, 63)); // baseline always lit
  // empty slots still get baselines
  assert.ok(fb.getPixel(0, 63));
});

test('scaleMax grows to fit history beyond config.scaleMax', () => {
  const fb = new Framebuffer();
  renderFrame(
    fb,
    { history: [40], lastValue: 40, lastError: null },
    config
  );
  const x = 9 * Math.floor(WIDTH / 10);
  assert.equal(colHeight(fb, x), 47); // dynamic scaleMax = 40
});

test('fewer samples than slots are right-aligned', () => {
  const fb = new Framebuffer();
  renderFrame(
    fb,
    { history: [5, 10], lastValue: 10, lastError: null },
    config
  );
  const colW = Math.floor(WIDTH / 10);
  // newest (10) in slot 9, previous (5) in slot 8, slot 7 empty
  assert.equal(colHeight(fb, 9 * colW), Math.round((10 / 20) * 47));
  assert.equal(colHeight(fb, 8 * colW), Math.round((5 / 20) * 47));
  assert.equal(colHeight(fb, 7 * colW), 0);
  assert.ok(fb.getPixel(7 * colW, 63));
});
