import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, ConfigError } from '../src/config.js';

const good = {
  DEVOPS_ORG: 'my-org',
  AGENT_POOL_ID: '27',
  DEVOPS_PAT: 'sekret-pat-value',
};

test('defaults are applied', () => {
  const c = loadConfig({ ...good });
  assert.equal(c.org, 'my-org');
  assert.equal(c.poolId, 27);
  assert.equal(c.pat, 'sekret-pat-value');
  assert.equal(c.pollIntervalSeconds, 30);
  assert.equal(c.requestTimeoutSeconds, 10);
  assert.equal(c.samples, 42);
  assert.equal(c.scaleMax, null);
  assert.equal(c.pixelShiftMinutes, 5);
  assert.equal(c.nightStartHour, 22);
  assert.equal(c.nightEndHour, 7);
  assert.equal(c.nightBrightness, 5);
  assert.equal(c.displayDriver, 'ssd1322');
  assert.equal(c.spiBus, 0);
  assert.equal(c.spiDevice, 0);
  assert.equal(c.spiSpeedHz, 4_000_000);
  assert.equal(c.gpioChip, 0);
  assert.equal(c.dcGpio, 24);
  assert.equal(c.resetGpio, 25);
  assert.equal(c.displayRotate, 0);
  assert.ok(Object.isFrozen(c));
});

test('all missing required vars reported together', () => {
  assert.throws(
    () => loadConfig({}),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.problems.length >= 3);
      for (const name of ['DEVOPS_ORG', 'AGENT_POOL_ID', 'DEVOPS_PAT']) {
        assert.ok(
          err.message.includes(name),
          `expected ${name} in: ${err.message}`
        );
      }
      return true;
    }
  );
});

test('bad org rejected', () => {
  assert.throws(() => loadConfig({ ...good, DEVOPS_ORG: '-bad' }), ConfigError);
  assert.throws(
    () => loadConfig({ ...good, DEVOPS_ORG: 'has space' }),
    ConfigError
  );
});

test('bad pool id rejected', () => {
  for (const v of ['0', '-1', 'abc', '1.5']) {
    assert.throws(() => loadConfig({ ...good, AGENT_POOL_ID: v }), ConfigError);
  }
});

test('interval bounds enforced', () => {
  assert.throws(
    () => loadConfig({ ...good, POLL_INTERVAL_SECONDS: '5' }),
    ConfigError
  );
  assert.throws(
    () => loadConfig({ ...good, POLL_INTERVAL_SECONDS: '3601' }),
    ConfigError
  );
  assert.equal(
    loadConfig({ ...good, POLL_INTERVAL_SECONDS: '10' }).pollIntervalSeconds,
    10
  );
});

test('burn-in settings are parsed and bounded', () => {
  const c = loadConfig({
    ...good,
    PIXEL_SHIFT_MINUTES: '0',
    NIGHT_START_HOUR: '0',
    NIGHT_END_HOUR: '0',
    NIGHT_BRIGHTNESS: '15',
    SCALE_MAX: '30',
  });
  assert.equal(c.pixelShiftMinutes, 0);
  assert.equal(c.nightStartHour, 0);
  assert.equal(c.nightEndHour, 0);
  assert.equal(c.nightBrightness, 15);
  assert.equal(c.scaleMax, 30);
  for (const [k, v] of [
    ['NIGHT_START_HOUR', '24'],
    ['NIGHT_END_HOUR', '-1'],
    ['NIGHT_BRIGHTNESS', '0'],
    ['NIGHT_BRIGHTNESS', '16'],
    ['PIXEL_SHIFT_MINUTES', '1441'],
    ['SAMPLES', '85'],
  ]) {
    assert.throws(() => loadConfig({ ...good, [k]: v }), ConfigError, `${k}=${v}`);
  }
});

test('SPI and GPIO overrides are parsed', () => {
  const c = loadConfig({
    ...good,
    SPI_BUS: '1',
    SPI_DEVICE: '1',
    SPI_SPEED_HZ: '8000000',
    GPIO_CHIP: '4',
    DC_GPIO: '5',
    RESET_GPIO: '6',
  });
  assert.equal(c.spiBus, 1);
  assert.equal(c.spiDevice, 1);
  assert.equal(c.spiSpeedHz, 8_000_000);
  assert.equal(c.gpioChip, 4);
  assert.equal(c.dcGpio, 5);
  assert.equal(c.resetGpio, 6);
});

test('SPI speed bounds enforced', () => {
  for (const v of ['99999', '10000001', '4MHz', '-1']) {
    assert.throws(() => loadConfig({ ...good, SPI_SPEED_HZ: v }), ConfigError);
  }
  assert.equal(
    loadConfig({ ...good, SPI_SPEED_HZ: '10000000' }).spiSpeedHz,
    10_000_000
  );
});

test('bad GPIO lines rejected', () => {
  assert.throws(() => loadConfig({ ...good, DC_GPIO: '64' }), ConfigError);
  assert.throws(() => loadConfig({ ...good, RESET_GPIO: 'x' }), ConfigError);
  assert.throws(
    () => loadConfig({ ...good, DC_GPIO: '25', RESET_GPIO: '25' }),
    /DC_GPIO and RESET_GPIO/
  );
});

test('DISPLAY_ROTATE accepts only 0 or 180', () => {
  assert.equal(loadConfig({ ...good, DISPLAY_ROTATE: '180' }).displayRotate, 180);
  assert.equal(loadConfig({ ...good, DISPLAY_ROTATE: '0' }).displayRotate, 0);
  for (const v of ['90', '270', 'flip']) {
    assert.throws(() => loadConfig({ ...good, DISPLAY_ROTATE: v }), ConfigError);
  }
});

test('PAT never appears in the error message', () => {
  const env = { DEVOPS_PAT: good.DEVOPS_PAT };
  try {
    loadConfig(env);
    assert.fail('should throw');
  } catch (err) {
    assert.ok(!String(err).includes(good.DEVOPS_PAT));
    assert.ok(!err.message.includes(good.DEVOPS_PAT));
  }
});

test('bad DISPLAY_DRIVER rejected', () => {
  assert.throws(
    () => loadConfig({ ...good, DISPLAY_DRIVER: 'epaper' }),
    ConfigError
  );
  assert.equal(
    loadConfig({ ...good, DISPLAY_DRIVER: 'console' }).displayDriver,
    'console'
  );
});
