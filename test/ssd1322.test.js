import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Framebuffer, WIDTH, HEIGHT } from '../src/framebuffer.js';
import {
  createSsd1322,
  packFrame,
  INIT_SEQUENCE,
  FRAME_BYTES,
  MAX_SPI_CHUNK,
} from '../src/displays/ssd1322.js';

// Records every SPI write and GPIO change, in order, as one event log.
function fakeHardware({ failWrite } = {}) {
  const events = [];
  const opened = { spi: [], gpio: [] };
  const closed = { spi: 0, gpio: 0 };
  let dc = null;
  const openSpi = async (opts) => {
    opened.spi.push(opts);
    return {
      async write(buf) {
        if (failWrite?.(buf)) throw new Error('spi write failed');
        assert.ok(buf.length <= MAX_SPI_CHUNK, `chunk of ${buf.length}`);
        events.push({ type: dc ? 'data' : 'cmd', bytes: [...buf] });
      },
      async close() {
        closed.spi++;
      },
    };
  };
  const openGpio = async (opts) => {
    opened.gpio.push(opts);
    return {
      dc: { set: (v) => (dc = v) },
      reset: { set: (v) => events.push({ type: 'reset', value: v }) },
      close() {
        closed.gpio++;
      },
    };
  };
  return { events, opened, closed, openSpi, openGpio };
}

// Collapses the event log into [cmd, ...params] groups plus a data total.
function commands(events) {
  const out = [];
  for (const e of events) {
    if (e.type === 'cmd') {
      assert.equal(e.bytes.length, 1, 'one command byte per DC-low write');
      out.push([e.bytes[0]]);
    } else if (e.type === 'data') {
      out.at(-1).push(...e.bytes);
    }
  }
  return out;
}

const noSleep = async () => {};

function makeDriver(hw, opts = {}) {
  return createSsd1322({
    openSpi: hw.openSpi,
    openGpio: hw.openGpio,
    sleep: noSleep,
    ...opts,
  });
}

test('init pulses RES low then sends the init sequence with DC split', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.init();
  const resets = hw.events.filter((e) => e.type === 'reset').map((e) => e.value);
  assert.deepEqual(resets, [1, 0, 1]);
  const firstCmd = hw.events.findIndex((e) => e.type === 'cmd');
  assert.ok(
    hw.events.slice(0, firstCmd).every((e) => e.type === 'reset'),
    'reset completes before any SPI traffic'
  );
  assert.deepEqual(commands(hw.events), INIT_SEQUENCE);
  assert.deepEqual(INIT_SEQUENCE.flat(), [
    0xfd, 0x12, 0xae, 0xb3, 0x91, 0xca, 0x3f, 0xa2, 0x00, 0xa1, 0x00, 0xa0,
    0x14, 0x11, 0xb5, 0x00, 0xab, 0x01, 0xb4, 0xa0, 0xfd, 0xc1, 0x9f, 0xc7,
    0x0f, 0xb9, 0xb1, 0xe2, 0xd1, 0x82, 0x20, 0xbb, 0x1f, 0xb6, 0x08, 0xbe,
    0x07, 0xa6, 0xa9, 0xaf,
  ]);
});

test('passes bus, device, speed and GPIO lines to the openers', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw, {
    spiBus: 1,
    spiDevice: 2,
    speedHz: 8_000_000,
    gpioChip: 3,
    dcGpio: 5,
    resetGpio: 6,
  });
  await d.init();
  assert.deepEqual(hw.opened.spi, [{ bus: 1, device: 2, speedHz: 8_000_000 }]);
  assert.deepEqual(hw.opened.gpio, [{ chip: 3, dc: 5, reset: 6 }]);
});

test('show initializes lazily, sets the window and writes 8192 bytes in chunks', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  const fb = new Framebuffer();
  fb.setPixel(0, 0, 15);
  fb.setPixel(1, 0, 3);
  fb.setPixel(WIDTH - 1, HEIGHT - 1, 9);
  await d.show(fb);
  const cmds = commands(hw.events).slice(INIT_SEQUENCE.length);
  assert.deepEqual(cmds[0], [0x15, 0x1c, 0x5b]);
  assert.deepEqual(cmds[1], [0x75, 0x00, 0x3f]);
  assert.equal(cmds[2][0], 0x5c);
  const data = cmds[2].slice(1);
  assert.equal(data.length, FRAME_BYTES);
  assert.equal(FRAME_BYTES, 8192);
  assert.equal(data[0], 0xf3);
  assert.equal(data.at(-1), 0x09);
  const dataWrites = hw.events.slice(-2);
  assert.ok(dataWrites.every((e) => e.type === 'data' && e.bytes.length === 4096));

  // a second frame does not re-init
  hw.events.length = 0;
  await d.show(fb);
  assert.deepEqual(
    commands(hw.events).map((c) => c[0]),
    [0x15, 0x75, 0x5c]
  );
});

test('packFrame puts the even-x pixel in the high nibble', () => {
  const fb = new Framebuffer();
  fb.setPixel(2, 0, 0xa);
  fb.setPixel(3, 0, 0x5);
  fb.setPixel(0, 1, 0x7);
  const out = packFrame(fb);
  assert.equal(out[1], 0xa5);
  assert.equal(out[WIDTH / 2], 0x70);
});

test('packFrame rotate=180 maps (x,y) to (255-x, 63-y)', () => {
  const fb = new Framebuffer();
  fb.setPixel(0, 0, 0xc);
  fb.setPixel(1, 0, 0x2);
  fb.setPixel(10, 5, 0x6);
  const out = packFrame(fb, 180);
  assert.equal(out.at(-1), 0x2c);
  const x = WIDTH - 1 - 10;
  const y = HEIGHT - 1 - 5;
  const byte = out[(y * WIDTH + x) >> 1];
  assert.equal(x % 2 === 0 ? byte >> 4 : byte & 0xf, 0x6);
});

test('rotate option is applied by show', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw, { rotate: 180 });
  const fb = new Framebuffer();
  fb.setPixel(0, 0, 15);
  await d.show(fb);
  const data = commands(hw.events).at(-1).slice(1);
  assert.equal(data[0], 0);
  assert.equal(data.at(-1), 0x0f);
});

test('setBrightness before init is applied after the init sequence', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.setBrightness(5);
  assert.equal(hw.events.length, 0);
  await d.init();
  const cmds = commands(hw.events);
  assert.deepEqual(cmds.slice(0, INIT_SEQUENCE.length), INIT_SEQUENCE);
  assert.deepEqual(cmds.at(-1), [0xc7, 0x05]);
});

test('setBrightness after init sends C7 and clamps to 0..15', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.init();
  hw.events.length = 0;
  await d.setBrightness(40);
  await d.setBrightness(-2);
  assert.deepEqual(commands(hw.events), [[0xc7, 0x0f], [0xc7, 0x00]]);
});

test('full brightness adds nothing to the init sequence', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.init();
  assert.deepEqual(commands(hw.events), INIT_SEQUENCE);
});

test('off sends display-off only after init', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.off();
  assert.equal(hw.events.length, 0);
  await d.init();
  hw.events.length = 0;
  await d.off();
  assert.deepEqual(commands(hw.events), [[0xae]]);
});

test('reset closes SPI and GPIO, and the next show re-inits', async () => {
  const hw = fakeHardware();
  const d = makeDriver(hw);
  await d.show(new Framebuffer());
  await d.reset();
  assert.deepEqual(hw.closed, { spi: 1, gpio: 1 });
  hw.events.length = 0;
  await d.show(new Framebuffer());
  assert.equal(hw.opened.spi.length, 2);
  assert.equal(hw.opened.gpio.length, 2);
  assert.deepEqual(commands(hw.events).slice(0, INIT_SEQUENCE.length), INIT_SEQUENCE);
});

test('a failed write propagates, and reset recovers', async () => {
  let fail = true;
  const hw = fakeHardware({ failWrite: () => fail });
  const d = makeDriver(hw);
  await assert.rejects(d.show(new Framebuffer()), /spi write failed/);
  await d.reset();
  fail = false;
  await d.show(new Framebuffer());
  assert.equal(hw.opened.spi.length, 2);
});
