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
  assert.equal(c.samples, 10);
  assert.equal(c.scaleMax, 20);
  assert.equal(c.displayDriver, 'ssd1306');
  assert.equal(c.i2cBus, 1);
  assert.equal(c.i2cAddress, 0x3c);
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

test('hex and decimal i2c address parsing', () => {
  assert.equal(loadConfig({ ...good, I2C_ADDRESS: '0x3d' }).i2cAddress, 0x3d);
  assert.equal(loadConfig({ ...good, I2C_ADDRESS: '60' }).i2cAddress, 60);
  assert.throws(
    () => loadConfig({ ...good, I2C_ADDRESS: 'zz' }),
    ConfigError
  );
  assert.throws(
    () => loadConfig({ ...good, I2C_ADDRESS: '0x99' }),
    ConfigError
  );
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
