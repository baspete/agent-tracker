export class ConfigError extends Error {
  constructor(problems) {
    super(
      'Invalid configuration:\n' + problems.map((p) => `  - ${p}`).join('\n')
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function intInRange(name, raw, min, max, problems) {
  if (!/^\d+$/.test(raw)) {
    problems.push(`${name} must be an integer`);
    return null;
  }
  const n = Number(raw);
  if (n < min || n > max) {
    problems.push(`${name} must be between ${min} and ${max}`);
    return null;
  }
  return n;
}

function parseIntOpt(name, raw, def, min, max, problems) {
  if (raw === undefined || raw === '') return def;
  return intInRange(name, raw, min, max, problems);
}

function parseAddress(raw, problems) {
  if (raw === undefined || raw === '') return 0x3c;
  let n;
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    n = parseInt(raw, 16);
  } else if (/^\d+$/.test(raw)) {
    n = Number(raw);
  } else {
    problems.push('I2C_ADDRESS must be a hex (0x3c) or decimal integer');
    return null;
  }
  if (n < 0x03 || n > 0x77) {
    problems.push('I2C_ADDRESS must be between 0x03 and 0x77');
    return null;
  }
  return n;
}

export function loadConfig(env = process.env) {
  const problems = [];

  const org = env.DEVOPS_ORG;
  if (org === undefined || org === '') {
    problems.push('DEVOPS_ORG is required');
  } else if (!ORG_RE.test(org)) {
    problems.push(
      'DEVOPS_ORG must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/'
    );
  }

  const poolIdRaw = env.AGENT_POOL_ID;
  let poolId = null;
  if (poolIdRaw === undefined || poolIdRaw === '') {
    problems.push('AGENT_POOL_ID is required');
  } else {
    poolId = intInRange('AGENT_POOL_ID', poolIdRaw, 1, Number.MAX_SAFE_INTEGER, problems);
  }

  const pat = env.DEVOPS_PAT;
  if (pat === undefined || pat === '') {
    problems.push('DEVOPS_PAT is required');
  }

  const pollIntervalSeconds = parseIntOpt(
    'POLL_INTERVAL_SECONDS',
    env.POLL_INTERVAL_SECONDS,
    30,
    10,
    3600,
    problems
  );
  const requestTimeoutSeconds = parseIntOpt(
    'REQUEST_TIMEOUT_SECONDS',
    env.REQUEST_TIMEOUT_SECONDS,
    10,
    1,
    60,
    problems
  );
  const samples = parseIntOpt('SAMPLES', env.SAMPLES, 10, 1, 64, problems);
  const scaleMax = parseIntOpt('SCALE_MAX', env.SCALE_MAX, 20, 1, 1e9, problems);

  const driverRaw = env.DISPLAY_DRIVER || 'ssd1306';
  let displayDriver = driverRaw;
  if (driverRaw !== 'ssd1306' && driverRaw !== 'console') {
    problems.push("DISPLAY_DRIVER must be 'ssd1306' or 'console'");
    displayDriver = null;
  }

  const i2cBus = parseIntOpt('I2C_BUS', env.I2C_BUS, 1, 0, 10, problems);
  const i2cAddress = parseAddress(env.I2C_ADDRESS, problems);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze({
    org,
    poolId,
    pat,
    pollIntervalSeconds,
    requestTimeoutSeconds,
    samples,
    scaleMax,
    displayDriver,
    i2cBus,
    i2cAddress,
  });
}
