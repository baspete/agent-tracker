import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Framebuffer, WIDTH, HEIGHT } from '../src/framebuffer.js';
import {
  renderFrame,
  pixelShift,
  SHIFT_SEQUENCE,
  formatAge,
  chartScale,
  squareGrid,
  brightnessFor,
  isNight,
  isStale,
  LEVEL,
  MARGIN,
  CHART_X,
  CHART_W,
  CHART_TOP,
  CHART_BASE,
  SQUARES_Y,
} from '../src/render.js';

const config = {
  samples: 42,
  scaleMax: null,
  pollIntervalSeconds: 30,
  pixelShiftMinutes: 0,
  nightStartHour: 22,
  nightEndHour: 7,
  nightBrightness: 5,
};
const NOON = new Date(2026, 0, 5, 12, 0).getTime();

const status = (busy, idle, offline) => ({
  busy,
  online: busy + idle,
  offline,
  total: busy + idle + offline,
  agents: [
    ...Array(busy).fill('busy'),
    ...Array(idle).fill('idle'),
    ...Array(offline).fill('offline'),
  ],
});

const live = (s, history = [s.busy]) => ({
  status: s,
  history,
  lastValue: s.busy,
  lastError: null,
  lastSuccessAt: NOON,
});

function render(state, cfg = config, now = NOON) {
  const fb = new Framebuffer();
  renderFrame(fb, state, cfg, { now });
  return fb;
}

// Pixels in rows [y0, y1) and columns [x0, x1).
function region(fb, x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) out.push(fb.getPixel(x, y));
  return out;
}

function textMatches(fb, x, y, text, level) {
  const exp = new Framebuffer();
  exp.drawText(x, y, text, 1, level);
  const w = text.length * 6;
  for (let yy = y; yy < y + 7; yy++)
    for (let xx = x; xx < x + w; xx++)
      if (fb.getPixel(xx, yy) !== exp.getPixel(xx, yy)) return false;
  return true;
}

const X = MARGIN + CHART_X;
const BASE = MARGIN + CHART_BASE;
const newestX = X + CHART_W - 2; // middle of the rightmost 3px bar

function barHeight(fb, x) {
  let h = 0;
  for (let y = BASE; y >= MARGIN + CHART_TOP; y--) {
    if (fb.getPixel(x, y) >= LEVEL.bar) h++;
    else break;
  }
  return h;
}

// Expected header: "<online> ONLINE" left, "<offline> OFF" right-aligned, and
// "<idle> IDLE" centred in the gap between them.
function headerMatches(fb, online, idle, offline) {
  const w = (t) => t.length * 6 - 1;
  const cw = (num, word) => w(num) + 5 + w(word);
  const offX = WIDTH - MARGIN - cw(offline, 'OFF');
  const idleX = Math.round((X + cw(online, 'ONLINE') + offX - cw(idle, 'IDLE')) / 2);
  return (
    textMatches(fb, X, MARGIN, online, LEVEL.text) &&
    textMatches(fb, X + w(online) + 5, MARGIN, 'ONLINE', LEVEL.label) &&
    textMatches(fb, idleX, MARGIN, idle, LEVEL.text) &&
    textMatches(fb, idleX + w(idle) + 5, MARGIN, 'IDLE', LEVEL.label) &&
    textMatches(fb, offX, MARGIN, offline, LEVEL.text) &&
    textMatches(fb, offX + w(offline) + 5, MARGIN, 'OFF', LEVEL.label)
  );
}

test('header shows online, idle and offline counts, not busy', () => {
  const fb = render(live(status(7, 5, 2)));
  assert.ok(headerMatches(fb, '12', '5', '2'));
});

test('idle is online minus busy, and zero counts are shown', () => {
  assert.ok(headerMatches(render(live(status(0, 20, 0))), '20', '20', '0'));
  assert.ok(headerMatches(render(live(status(20, 0, 0))), '20', '0', '0'));
});

test('three-digit counts in the header do not overlap', () => {
  const fb = render(live(status(0, 188, 188)));
  assert.ok(headerMatches(fb, '188', '188', '188'));
});

test('placeholders before the first poll', () => {
  const fb = render({ status: null, history: [], lastError: null, lastSuccessAt: null });
  assert.ok(headerMatches(fb, '--', '--', '--'));
  // big "--" lights the left panel; no squares drawn
  assert.ok(region(fb, 0, 0, 79, 50).some((v) => v === LEVEL.count));
  assert.ok(region(fb, X, MARGIN + SQUARES_Y, WIDTH, HEIGHT).every((v) => v === 0));
});

test('large count is drawn at LEVEL.count with AA edges', () => {
  const fb = render(live(status(7, 5, 2)));
  const left = region(fb, 0, 0, 79, 50);
  assert.ok(left.some((v) => v === LEVEL.count));
  assert.ok(left.every((v) => v <= LEVEL.count));
  assert.ok(left.some((v) => v > 0 && v < LEVEL.count), 'anti-aliased edge pixels');
});

test('two- and three-digit counts stay inside the left panel', () => {
  for (const busy of [12, 88, 188]) {
    const fb = render(live(status(busy, 0, 0)));
    const spill = region(fb, MARGIN + 79, 0, X, HEIGHT).filter((v) => v > LEVEL.divider);
    assert.equal(spill.length, 0, `busy=${busy}`);
  }
});

test('error header shows the label and age of the last good poll', () => {
  for (const [kind, label] of [
    ['auth', 'AUTH ERROR'],
    ['network', 'NET ERROR'],
    ['timeout', 'NET ERROR'],
    ['http', 'API ERROR'],
    ['parse', 'API ERROR'],
  ]) {
    const state = { ...live(status(7, 5, 2)), lastError: { kind } };
    const fb = render(state, config, NOON + 12 * 60_000);
    assert.ok(textMatches(fb, X, MARGIN, label, LEVEL.text), kind);
    const age = '12m ago';
    assert.ok(
      textMatches(fb, WIDTH - MARGIN - (age.length * 6 - 1), MARGIN, age, LEVEL.muted),
      kind
    );
  }
});

test('formatAge', () => {
  assert.equal(formatAge(5_000), '5s ago');
  assert.equal(formatAge(125_000), '2m ago');
  assert.equal(formatAge(3 * 3600_000 + 5), '3h ago');
  assert.equal(formatAge(-10), '0s ago');
});

test('chart scales to the pool size; SCALE_MAX is a floor', () => {
  const s = status(7, 5, 2);
  assert.equal(chartScale(live(s), config), 14);
  assert.equal(chartScale(live(s), { ...config, scaleMax: 20 }), 20);
  assert.equal(chartScale(live(s, [30]), config), 30);
  assert.equal(chartScale({ status: null, history: [] }, config), 1);
});

test('newest bar is brightest and a full bar fills the chart height', () => {
  const s = status(14, 0, 0);
  const fb = render(live(s, [7, 14]));
  assert.equal(fb.getPixel(newestX, BASE), LEVEL.newestBar);
  assert.equal(barHeight(fb, newestX), CHART_BASE - CHART_TOP + 1);
  assert.equal(fb.getPixel(newestX - 4, BASE), LEVEL.bar);
  assert.equal(barHeight(fb, newestX - 4), Math.round(0.5 * (CHART_BASE - CHART_TOP + 1)));
});

test('fewer samples than slots are right-aligned; baseline always drawn', () => {
  const fb = render(live(status(7, 5, 2), [7]));
  assert.ok(barHeight(fb, newestX) > 0);
  assert.equal(fb.getPixel(newestX - 4, BASE), 0);
  assert.equal(fb.getPixel(X, BASE + 1), LEVEL.baseline);
  assert.equal(fb.getPixel(WIDTH - MARGIN - 1, BASE + 1), LEVEL.baseline);
});

test('dim dashed line marks the online count', () => {
  const s = status(0, 7, 7); // online = half the pool
  const fb = render(live(s, [0]));
  const y = BASE - Math.round(0.5 * (CHART_BASE - CHART_TOP + 1)) + 1;
  const row = region(fb, X, y, WIDTH - MARGIN, y + 1);
  assert.ok(row.some((v) => v === LEVEL.onlineLine));
  assert.ok(row.some((v) => v === 0), 'dashed');
});

test('agent squares: bright busy, dim idle, outlined offline', () => {
  const fb = render(live(status(1, 1, 1)));
  const y = MARGIN + SQUARES_Y;
  assert.equal(fb.getPixel(X + 3, y + 3), LEVEL.busy);
  assert.equal(fb.getPixel(X + 9 + 3, y + 3), LEVEL.idle);
  assert.equal(fb.getPixel(X + 18, y), LEVEL.offline);
  assert.equal(fb.getPixel(X + 18 + 3, y + 3), 0, 'offline square is hollow');
});

test('square grid shrinks to fit large pools', () => {
  assert.deepEqual(squareGrid(14), { size: 7, gap: 2, perRow: 18, rows: 1 });
  assert.ok(squareGrid(30).size < 7);
  const g = squareGrid(150);
  assert.ok(g.perRow * g.rows >= 150);
  assert.ok((g.size + g.gap) * g.rows - g.gap <= 10);
});

test('pixel shift cycles one pixel at a time and moves the frame', () => {
  for (let i = 0; i < SHIFT_SEQUENCE.length; i++) {
    const [ax, ay] = SHIFT_SEQUENCE[i];
    const [bx, by] = SHIFT_SEQUENCE[(i + 1) % SHIFT_SEQUENCE.length];
    assert.ok(Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1);
  }
  assert.deepEqual(pixelShift(123456789, 0), [0, 0]);
  assert.deepEqual(pixelShift(0, 5), [0, 0]);
  assert.deepEqual(pixelShift(5 * 60_000, 5), [1, 0]);

  const state = live(status(7, 5, 2));
  const cfg = { ...config, pixelShiftMinutes: 5 };
  const a = render(state, cfg, 0);
  const b = render(state, cfg, 5 * 60_000); // shifted right by one
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 1; x < WIDTH; x++)
      assert.equal(b.getPixel(x, y), a.getPixel(x - 1, y), `${x},${y}`);
});

test('nothing is drawn outside the 1px margin when unshifted', () => {
  const fb = render(live(status(7, 5, 2), Array(42).fill(14)));
  const edges = [
    ...region(fb, 0, 0, WIDTH, 1),
    ...region(fb, 0, HEIGHT - 1, WIDTH, HEIGHT),
    ...region(fb, WIDTH - 1, 0, WIDTH, HEIGHT),
  ];
  assert.ok(edges.every((v) => v === 0));
});

test('night window handles wrap-around and is off when start == end', () => {
  const at = (h) => new Date(2026, 0, 5, h, 30).getTime();
  assert.ok(isNight(at(23), 22, 7));
  assert.ok(isNight(at(3), 22, 7));
  assert.ok(!isNight(at(7), 22, 7));
  assert.ok(!isNight(at(12), 22, 7));
  assert.ok(isNight(at(13), 12, 14));
  assert.ok(!isNight(at(14), 12, 14));
  assert.ok(!isNight(at(3), 5, 5));
});

test('stale after three poll intervals without a good poll', () => {
  const s = live(status(1, 1, 0));
  assert.ok(!isStale(s, config, NOON + 90_000));
  assert.ok(isStale(s, config, NOON + 90_001));
  assert.ok(isStale({ lastSuccessAt: null, lastError: { kind: 'auth' } }, config, NOON));
  assert.ok(!isStale({ lastSuccessAt: null, lastError: null }, config, NOON));
});

test('brightness: full by day, NIGHT_BRIGHTNESS at night, ~35% when stale', () => {
  const s = live(status(1, 1, 0));
  const night = new Date(2026, 0, 5, 23, 0).getTime();
  assert.equal(brightnessFor(s, config, NOON), 15); // no BRIGHTNESS set
  assert.equal(brightnessFor({ ...s, lastSuccessAt: night }, config, night), 5);
  assert.equal(brightnessFor(s, config, NOON + 10 * 60_000), 5);
  assert.equal(
    brightnessFor({ ...s, lastSuccessAt: night - 600_000 }, config, night),
    2
  );
});

test('BRIGHTNESS sets the day level; night never exceeds it', () => {
  const s = live(status(1, 1, 0));
  const night = new Date(2026, 0, 5, 23, 0).getTime();
  const cfg = { ...config, brightness: 8 };
  assert.equal(brightnessFor(s, cfg, NOON), 8);
  assert.equal(brightnessFor({ ...s, lastSuccessAt: night }, cfg, night), 5);
  assert.equal(
    brightnessFor({ ...s, lastSuccessAt: night }, { ...cfg, brightness: 3 }, night),
    3
  );
  assert.equal(brightnessFor(s, cfg, NOON + 10 * 60_000), 3); // stale: ~35%
});

test('nothing in the frame is drawn at full level 15', () => {
  const fb = render(live(status(7, 5, 2), Array(42).fill(7)));
  assert.ok(fb.buffer.every((v) => v < 15));
});
