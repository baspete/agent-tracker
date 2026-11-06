import { WIDTH } from './framebuffer.js';

const CHART_TOP = 16;
const BASELINE_ROW = 63;
const MAX_BAR_HEIGHT = 47;

function headerText(state) {
  const err = state.lastError;
  if (err) {
    if (err.kind === 'auth') return 'AUTH ERROR';
    if (err.kind === 'network' || err.kind === 'timeout') return 'NET ERROR';
    return 'API ERROR';
  }
  return `AGENTS ${state.lastValue ?? '--'}`;
}

export function renderFrame(fb, state, config) {
  fb.clear();
  fb.drawText(0, 1, headerText(state), 2);

  const samples = config.samples;
  const history = state.history;
  const colW = Math.floor(WIDTH / samples);
  const scaleMax = Math.max(config.scaleMax, ...history);

  for (let slot = 0; slot < samples; slot++) {
    const x = slot * colW;
    const barW = colW - 1;
    if (barW <= 0) continue;
    fb.fillRect(x, BASELINE_ROW, barW, 1);
    const hi = history.length - samples + slot;
    if (hi < 0) continue;
    const value = history[hi];
    const h = Math.min(
      Math.max(Math.round((value / scaleMax) * MAX_BAR_HEIGHT), 0),
      MAX_BAR_HEIGHT
    );
    if (h > 0) {
      fb.fillRect(x, BASELINE_ROW - h, barW, h);
    }
  }
}
