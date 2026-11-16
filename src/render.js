import { WIDTH } from './framebuffer.js';
import { CELL_WIDTH } from './font5x7.js';
import { drawBigNumber } from './bigdigits.js';

// Layout (relative to the content origin, which moves for pixel shift):
//   left panel   x 0..78   large busy count, "BUSY" label
//   divider      x 79
//   right panel  x 86..253 header, bar chart, one square per agent
export const MARGIN = 1; // room for the +/-1px burn-in shift
const CONTENT_W = WIDTH - 2 * MARGIN; // 254
const LEFT_CX = 39;
const DIVIDER_X = 79;
export const CHART_X = 86;
export const CHART_W = CONTENT_W - CHART_X; // 168
export const CHART_TOP = 10;
export const CHART_BASE = 45; // bottom row a full bar reaches
const CHART_H = CHART_BASE - CHART_TOP + 1;
export const SQUARES_Y = 52;
const SQUARES_H = 10;

// Grey levels (0..15) before the panel's master contrast is applied. Nothing
// uses full 15: the numbers were too glaring at that level.
export const LEVEL = Object.freeze({
  count: 10,
  text: 10,
  label: 6,
  muted: 5,
  divider: 2,
  baseline: 2,
  onlineLine: 3,
  bar: 8,
  newestBar: 11,
  busy: 11,
  idle: 4,
  offline: 5,
});

// Small, slow cycle of offsets; each step moves at most one pixel.
export const SHIFT_SEQUENCE = [
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

export function pixelShift(nowMs, minutes) {
  if (!minutes) return [0, 0];
  const step = Math.floor(nowMs / (minutes * 60_000));
  return SHIFT_SEQUENCE[step % SHIFT_SEQUENCE.length];
}

const textWidth = (s) => s.length * CELL_WIDTH - 1;
const HEADER_GAP = 5; // px between a header number and its word

const countWidth = (num, word) => textWidth(num) + HEADER_GAP + textWidth(word);

// "<num> <word>" with the number at text level and the word at label level.
function drawCount(fb, x, y, num, word) {
  fb.drawText(x, y, num, 1, LEVEL.text);
  fb.drawText(x + textWidth(num) + HEADER_GAP, y, word, 1, LEVEL.label);
}

function errorLabel(err) {
  if (err.kind === 'auth') return 'AUTH ERROR';
  if (err.kind === 'network' || err.kind === 'timeout') return 'NET ERROR';
  return 'API ERROR';
}

export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function chartScale(state, config) {
  return Math.max(
    1,
    config.scaleMax ?? 0,
    state.status?.total ?? 0,
    ...state.history
  );
}

// Picks the largest square size whose grid fits n agents in the strip.
export function squareGrid(n) {
  for (const [size, gap] of [[7, 2], [5, 2], [4, 2], [3, 1], [2, 1]]) {
    const perRow = Math.floor((CHART_W + gap) / (size + gap));
    const rows = Math.floor((SQUARES_H + gap) / (size + gap));
    if (perRow * rows >= n) return { size, gap, perRow, rows };
  }
  const perRow = Math.floor((CHART_W + 1) / 3);
  return { size: 2, gap: 1, perRow, rows: Math.floor((SQUARES_H + 1) / 3) };
}

function outline(fb, x, y, s, level) {
  fb.fillRect(x, y, s, 1, level);
  fb.fillRect(x, y + s - 1, s, 1, level);
  fb.fillRect(x, y, 1, s, level);
  fb.fillRect(x + s - 1, y, 1, s, level);
}

export function renderFrame(fb, state, config, { now = Date.now() } = {}) {
  fb.clear();
  const [dx, dy] = pixelShift(now, config.pixelShiftMinutes);
  const ox = MARGIN + dx;
  const oy = MARGIN + dy;
  const status = state.status ?? null;

  // Left: large busy count.
  drawBigNumber(fb, ox + LEFT_CX, oy + 1, status ? String(status.busy) : '--', {
    maxWidth: DIVIDER_X - 4,
    level: LEVEL.count,
  });
  fb.drawText(ox + LEFT_CX - Math.floor(textWidth('BUSY') / 2), oy + 53, 'BUSY', 1, LEVEL.label);
  fb.fillRect(ox + DIVIDER_X, oy + 2, 1, 56, LEVEL.divider);

  // Right header.
  const X = ox + CHART_X;
  const right = ox + CONTENT_W;
  if (state.lastError) {
    fb.drawText(X, oy, errorLabel(state.lastError), 1, LEVEL.text);
    if (state.lastSuccessAt != null) {
      const age = formatAge(now - state.lastSuccessAt);
      fb.drawText(right - textWidth(age), oy, age, 1, LEVEL.muted);
    }
  } else {
    // Busy is the large count on the left, so the header shows online (left),
    // idle (centred in the gap) and offline (right): number bright, word dim.
    const online = status ? String(status.online) : '--';
    const idle = status ? String(status.online - status.busy) : '--';
    const offline = status ? String(status.offline) : '--';
    const offX = right - countWidth(offline, 'OFF');
    const gapLeft = X + countWidth(online, 'ONLINE');
    const idleX = Math.round((gapLeft + offX - countWidth(idle, 'IDLE')) / 2);
    drawCount(fb, X, oy, online, 'ONLINE');
    drawCount(fb, idleX, oy, idle, 'IDLE');
    drawCount(fb, offX, oy, offline, 'OFF');
  }

  // Bar chart, newest on the right.
  const scale = chartScale(state, config);
  const samples = config.samples;
  const colW = Math.max(1, Math.floor(CHART_W / samples));
  const barW = Math.max(1, colW - 1);
  const chartLeft = X + CHART_W - colW * samples;
  const base = oy + CHART_BASE;
  const history = state.history;
  for (let slot = 0; slot < samples; slot++) {
    const hi = history.length - samples + slot;
    if (hi < 0) continue;
    const h = Math.min(
      CHART_H,
      Math.max(0, Math.round((history[hi] / scale) * CHART_H))
    );
    if (h > 0) {
      const level = hi === history.length - 1 ? LEVEL.newestBar : LEVEL.bar;
      fb.fillRect(chartLeft + slot * colW, base - h + 1, barW, h, level);
    }
  }
  fb.fillRect(chartLeft, base + 1, colW * samples, 1, LEVEL.baseline);
  if (status) {
    const lineH = Math.round((status.online / scale) * CHART_H);
    const y = base - lineH + 1;
    for (let x = chartLeft; x < chartLeft + colW * samples; x += 4) {
      fb.fillRect(x, y, 2, 1, LEVEL.onlineLine);
    }
  }

  // One square per agent: bright = busy, dim = idle, outline = offline.
  if (status) {
    const { size, gap, perRow, rows } = squareGrid(status.agents.length);
    const shown = status.agents.slice(0, perRow * rows);
    shown.forEach((s, i) => {
      const x = X + (i % perRow) * (size + gap);
      const y = oy + SQUARES_Y + Math.floor(i / perRow) * (size + gap);
      if (s === 'busy') fb.fillRect(x, y, size, size, LEVEL.busy);
      else if (s === 'idle') fb.fillRect(x, y, size, size, LEVEL.idle);
      else if (size >= 3) outline(fb, x, y, size, LEVEL.offline);
      else fb.fillRect(x, y, size, size, 1);
    });
  }
}

// Master brightness (SSD1322 master contrast, 0..15) for this moment.
export function brightnessFor(state, config, now) {
  let level = config.brightness ?? 15;
  if (isNight(now, config.nightStartHour, config.nightEndHour)) {
    level = Math.min(level, config.nightBrightness);
  }
  if (isStale(state, config, now)) {
    level = Math.max(1, Math.round(level * 0.35));
  }
  return level;
}

export function isNight(now, start, end) {
  if (start == null || end == null || start === end) return false;
  const hour = new Date(now).getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// Stale once the last good poll is older than three poll intervals.
export function isStale(state, config, now) {
  if (state.lastSuccessAt == null) return state.lastError != null;
  return now - state.lastSuccessAt > 3 * config.pollIntervalSeconds * 1000;
}
