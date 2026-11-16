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
  const samples = parseIntOpt('SAMPLES', env.SAMPLES, 42, 1, 84, problems);
  // Unset: the chart scales to the pool size. Set: a fixed minimum scale.
  const scaleMax = parseIntOpt('SCALE_MAX', env.SCALE_MAX, null, 1, 1e9, problems);

  const pixelShiftMinutes = parseIntOpt(
    'PIXEL_SHIFT_MINUTES',
    env.PIXEL_SHIFT_MINUTES,
    5,
    0,
    1440,
    problems
  );
  const nightStartHour = parseIntOpt('NIGHT_START_HOUR', env.NIGHT_START_HOUR, 22, 0, 23, problems);
  const nightEndHour = parseIntOpt('NIGHT_END_HOUR', env.NIGHT_END_HOUR, 7, 0, 23, problems);
  const nightBrightness = parseIntOpt(
    'NIGHT_BRIGHTNESS',
    env.NIGHT_BRIGHTNESS,
    5,
    1,
    15,
    problems
  );

  const driverRaw = env.DISPLAY_DRIVER || 'ssd1322';
  let displayDriver = driverRaw;
  if (driverRaw !== 'ssd1322' && driverRaw !== 'console') {
    problems.push("DISPLAY_DRIVER must be 'ssd1322' or 'console'");
    displayDriver = null;
  }

  const spiBus = parseIntOpt('SPI_BUS', env.SPI_BUS, 0, 0, 15, problems);
  const spiDevice = parseIntOpt('SPI_DEVICE', env.SPI_DEVICE, 0, 0, 15, problems);
  // The SSD1322 datasheet allows up to 10 MHz on the serial interface.
  const spiSpeedHz = parseIntOpt(
    'SPI_SPEED_HZ',
    env.SPI_SPEED_HZ,
    4_000_000,
    100_000,
    10_000_000,
    problems
  );
  const gpioChip = parseIntOpt('GPIO_CHIP', env.GPIO_CHIP, 0, 0, 15, problems);
  const dcGpio = parseIntOpt('DC_GPIO', env.DC_GPIO, 24, 0, 63, problems);
  const resetGpio = parseIntOpt('RESET_GPIO', env.RESET_GPIO, 25, 0, 63, problems);
  if (dcGpio !== null && dcGpio === resetGpio) {
    problems.push('DC_GPIO and RESET_GPIO must be different lines');
  }

  let displayRotate = 0;
  const rotateRaw = env.DISPLAY_ROTATE;
  if (rotateRaw !== undefined && rotateRaw !== '') {
    if (rotateRaw === '0' || rotateRaw === '180') {
      displayRotate = Number(rotateRaw);
    } else {
      problems.push('DISPLAY_ROTATE must be 0 or 180');
      displayRotate = null;
    }
  }

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
    pixelShiftMinutes,
    nightStartHour,
    nightEndHour,
    nightBrightness,
    displayDriver,
    spiBus,
    spiDevice,
    spiSpeedHz,
    gpioChip,
    dcGpio,
    resetGpio,
    displayRotate,
  });
}
