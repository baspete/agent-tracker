import { WIDTH, HEIGHT, MAX_LEVEL } from '../framebuffer.js';

// SSD1322 256x64, 4-bit greyscale, 4-wire SPI. Each entry is
// [command, ...parameters]; the command byte goes with DC low and its
// parameters with DC high.
export const INIT_SEQUENCE = [
  [0xfd, 0x12], // unlock command interface
  [0xae], // display off
  [0xb3, 0x91], // clock divider / oscillator frequency
  [0xca, 0x3f], // multiplex ratio: 64 rows
  [0xa2, 0x00], // display offset
  [0xa1, 0x00], // start line
  [0xa0, 0x14, 0x11], // remap: nibble remap, COM scan reversed, dual COM
  [0xb5, 0x00], // GPIO pins off
  [0xab, 0x01], // internal VDD regulator
  [0xb4, 0xa0, 0xfd], // display enhancement A: external VSL
  [0xc1, 0x9f], // contrast current
  [0xc7, 0x0f], // master contrast
  [0xb9], // default linear greyscale table
  [0xb1, 0xe2], // phase length
  [0xd1, 0x82, 0x20], // display enhancement B
  [0xbb, 0x1f], // precharge voltage
  [0xb6, 0x08], // second precharge period
  [0xbe, 0x07], // VCOMH
  [0xa6], // normal display
  [0xa9], // exit partial display
  [0xaf], // display on
];

export const FRAME_BYTES = (WIDTH * HEIGHT) / 2;
export const MAX_SPI_CHUNK = 4096; // spidev's default bufsiz

const COLUMN_START = 0x1c; // this panel's 256 pixels are columns 0x1c..0x5b
const COLUMN_END = 0x5b;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Packs a greyscale framebuffer into SSD1322 RAM order: two pixels per byte,
// the even-x pixel in the high nibble. rotate=180 flips both axes.
export function packFrame(fb, rotate = 0, out = new Uint8Array(FRAME_BYTES)) {
  const src = fb.buffer;
  const last = WIDTH * HEIGHT - 1;
  for (let i = 0, o = 0; i < WIDTH * HEIGHT; i += 2, o++) {
    let a, b;
    if (rotate === 180) {
      a = src[last - i];
      b = src[last - i - 1];
    } else {
      a = src[i];
      b = src[i + 1];
    }
    if (a > MAX_LEVEL) a = MAX_LEVEL;
    if (b > MAX_LEVEL) b = MAX_LEVEL;
    out[o] = (a << 4) | b;
  }
  return out;
}

async function defaultOpenSpi({ bus, device, speedHz }) {
  const mod = await import('spi-device');
  const spi = mod.default ?? mod;
  const dev = await new Promise((resolve, reject) => {
    const d = spi.open(bus, device, { mode: spi.MODE0, maxSpeedHz: speedHz }, (err) =>
      err ? reject(err) : resolve(d)
    );
  });
  return {
    write(buf) {
      return new Promise((resolve, reject) => {
        dev.transfer(
          [{ sendBuffer: Buffer.from(buf), byteLength: buf.length, speedHz }],
          (err) => (err ? reject(err) : resolve())
        );
      });
    },
    close() {
      return new Promise((resolve) => dev.close(() => resolve()));
    },
  };
}

async function defaultOpenGpio({ chip, dc, reset }) {
  const mod = await import('node-libgpiod');
  const { Chip, Line } = mod.default ?? mod;
  const c = new Chip(chip);
  const lines = [];
  const output = (offset, initial) => {
    const line = new Line(c, offset);
    line.requestOutputMode();
    lines.push(line);
    line.setValue(initial);
    return { set: (v) => line.setValue(v ? 1 : 0) };
  };
  try {
    return {
      dc: output(dc, 0),
      reset: output(reset, 1),
      close() {
        for (const line of lines.splice(0)) {
          try {
            line.release();
          } catch {
            // best effort
          }
        }
      },
      // keep the chip referenced so it is not garbage-collected
      chip: c,
    };
  } catch (err) {
    for (const line of lines) {
      try {
        line.release();
      } catch {}
    }
    throw err;
  }
}

export function createSsd1322({
  spiBus = 0,
  spiDevice = 0,
  speedHz = 4_000_000,
  gpioChip = 0,
  dcGpio = 24,
  resetGpio = 25,
  rotate = 0,
  openSpi = defaultOpenSpi,
  openGpio = defaultOpenGpio,
  sleep = sleepMs,
} = {}) {
  let spi = null;
  let gpio = null;
  let initialized = false;
  let brightness = 15;
  const frame = new Uint8Array(FRAME_BYTES);

  async function writeData(buf) {
    gpio.dc.set(1);
    for (let off = 0; off < buf.length; off += MAX_SPI_CHUNK) {
      await spi.write(buf.subarray(off, Math.min(off + MAX_SPI_CHUNK, buf.length)));
    }
  }

  async function command(cmd, ...params) {
    gpio.dc.set(0);
    await spi.write(Uint8Array.of(cmd));
    if (params.length > 0) await writeData(Uint8Array.from(params));
  }

  async function init() {
    if (!gpio) gpio = await openGpio({ chip: gpioChip, dc: dcGpio, reset: resetGpio });
    if (!spi) spi = await openSpi({ bus: spiBus, device: spiDevice, speedHz });
    gpio.reset.set(1);
    await sleep(1);
    gpio.reset.set(0);
    await sleep(10);
    gpio.reset.set(1);
    await sleep(10);
    for (const [cmd, ...params] of INIT_SEQUENCE) {
      await command(cmd, ...params);
    }
    if (brightness !== 15) await command(0xc7, brightness);
    initialized = true;
  }

  async function show(fb) {
    if (!initialized) await init();
    packFrame(fb, rotate, frame);
    await command(0x15, COLUMN_START, COLUMN_END);
    await command(0x75, 0x00, HEIGHT - 1);
    await command(0x5c);
    await writeData(frame);
  }

  async function reset() {
    initialized = false;
    const s = spi;
    const g = gpio;
    spi = null;
    gpio = null;
    try {
      await s?.close();
    } catch {
      // best effort
    }
    try {
      await g?.close();
    } catch {
      // best effort
    }
  }

  // Master contrast 0..15 (C7). Applied now if initialized, else at init.
  async function setBrightness(level) {
    brightness = Math.max(0, Math.min(15, Math.round(level)));
    if (initialized) await command(0xc7, brightness);
  }

  async function off() {
    if (initialized) await command(0xae);
  }

  async function close() {
    await reset();
  }

  return { init, show, setBrightness, reset, off, close };
}
