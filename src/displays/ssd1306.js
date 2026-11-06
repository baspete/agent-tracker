const WIDTH = 128;
const PAGES = 8;

// SSD1306 init sequence; A1/C8 keep the same orientation as the old library.
const INIT_COMMANDS = [
  0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40, 0x8d, 0x14, 0x20, 0x00, 0xa1,
  0xc8, 0xda, 0x12, 0x81, 0xcf, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0x2e,
  0xaf,
];

export function createSsd1306({ busNumber, address }) {
  let bus = null;
  let initialized = false;

  async function writeCommands(...cmds) {
    const buf = Buffer.from([0x00, ...cmds]);
    await bus.i2cWrite(address, buf.length, buf);
  }

  async function init() {
    if (!bus) {
      const { default: i2c } = await import('i2c-bus');
      bus = await i2c.openPromisified(busNumber);
    }
    await writeCommands(...INIT_COMMANDS);
    initialized = true;
  }

  async function show(fb) {
    if (!initialized) await init();
    await writeCommands(0x21, 0x00, 0x7f);
    await writeCommands(0x22, 0x00, 0x07);
    for (let page = 0; page < PAGES; page++) {
      const chunk = Buffer.alloc(1 + WIDTH);
      chunk[0] = 0x40;
      chunk.set(fb.buffer.subarray(page * WIDTH, (page + 1) * WIDTH), 1);
      await bus.i2cWrite(address, chunk.length, chunk);
    }
  }

  async function reset() {
    try {
      await bus?.close();
    } catch {
      // best effort
    }
    bus = null;
    initialized = false;
  }

  async function off() {
    if (initialized) await writeCommands(0xae);
  }

  async function close() {
    await reset();
  }

  return { init, show, reset, off, close };
}
