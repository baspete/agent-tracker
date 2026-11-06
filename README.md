# Build Agent Tracker

A Raspberry Pi app that shows how many Azure DevOps agents in a pool are busy,
as a text line plus a scrolling bar chart on a 128x64 SSD1306 I2C OLED display.

## Hardware and wiring

1. **A Raspberry Pi** - a 3B+ works fine, but anything with I2C will do.
1. **An SSD1306-based I2C OLED display** (128x64), usually at address `0x3c`.

| Physical Pin | Logical Pin | Connect To     |
| ------------ | ----------- | -------------- |
| 3            | SDA         | Display SDA    |
| 4            | 5V          | Display Vcc    |
| 5            | SCL         | Display SCL    |
| 6            | Ground      | Display Ground |

## Enable I2C

Enable I2C via `raspi-config` (Interface Options -> I2C), or see
https://github.com/fivdi/i2c-bus/blob/master/doc/raspberry-pi-i2c.md#configuring-i2c-with-raspi-config

Verify the display is visible:

```
sudo apt install i2c-tools
i2cdetect -y 1
```

## Provision the Pi

From the Mac (requires Node >= 20.12 and yarn v1 already on the Pi):

```
scripts/provision.sh [host]        # default: pi@agent-tracker.local
```

It is idempotent and, as root on the Pi:

- checks architecture (arm/aarch64) and Debian bookworm, Node >= 20.12, yarn
- installs missing apt packages (`build-essential`, `python3`, `i2c-tools`)
- enables I2C if needed (prints REBOOT REQUIRED)
- creates the `agent-tracker` system user (nologin, group `i2c`)
- creates `/opt/agent-tracker` (pi:pi) and `/etc/agent-tracker` (root:agent-tracker)
- installs `/etc/agent-tracker/env` from your old `.env` or the template
- installs and enables the systemd unit
- disables Wi-Fi power save (`wifi.powersave = 2`), restarting NetworkManager
  a few seconds after the script finishes so SSH doesn't drop mid-run
- enables the hardware watchdog (`RuntimeWatchdogSec=15`)
- caps journald at 200M

The only dependency, `i2c-bus`, is a native optional dependency. A build
failure on non-Linux machines is expected and harmless — use
`DISPLAY_DRIVER=console` for local dev.

## Deploy

```
scripts/deploy.sh [host]           # default: $DEPLOY_HOST or pi@agent-tracker.local
scripts/deploy.sh --status [host]
scripts/deploy.sh --rollback [host]
```

A deploy refuses to run on a dirty working tree, runs the test suite, then:

1. `git archive`s HEAD into a new release dir
   `/opt/agent-tracker/releases/<UTC timestamp>-<shortsha>/`
2. reuses `node_modules` if `yarn.lock` is unchanged, then
   `yarn install --frozen-lockfile --production`
3. verifies `i2c-bus` actually loads (it's an optionalDependency, so yarn can
   hide build failures)
4. flips the `current` symlink atomically (`previous` points at the old one)
   and restarts the service
5. health-checks for up to 60s: the service must be active and log a line
   starting `agents busy:`. On failure it prints the journal tail and rolls
   back to `previous` automatically.
6. prunes old releases, keeping `current`, `previous` and the 3 newest.

`--rollback` swaps `current`/`previous` manually; `--status` shows the links,
releases, service state and recent log lines.

## Secrets

The PAT lives in `/etc/agent-tracker/env` (root:agent-tracker 0640), loaded by
systemd `EnvironmentFile`. To rotate:

```
sudo -e /etc/agent-tracker/env
sudo systemctl restart agent-tracker
```

## Logs

```
journalctl -u agent-tracker -f
```

## Migrating from the old pm2/git-clone setup

```
pm2 delete app
pm2 save --force
sudo pm2 unstartup systemd -u pi --hp /home/pi
rm ~/.pm2/logs/app-*.log
```

Then run `scripts/provision.sh` and `scripts/deploy.sh`, and once the new
deploy is verified, remove the old `~/agent-tracker` clone.

## Personal access token

Create an Azure DevOps PAT with **least privilege**:

- Scope: **Agent Pools (Read)** only
- Short expiry, and rotate it regularly

Put it in `.env` next to `app.js` (see `.env.example`) and lock it down:

```
chmod 600 .env
```

`.env` is git-ignored. If the display shows `AUTH ERROR`, the PAT has expired
or lost its scope — issue a new one.

## Configuration

| Variable                  | Default   | Notes                                     |
| ------------------------- | --------- | ----------------------------------------- |
| `DEVOPS_ORG`              | (required)| Azure DevOps organization name            |
| `AGENT_POOL_ID`           | (required)| Numeric pool ID                           |
| `DEVOPS_PAT`              | (required)| PAT with Agent Pools (Read)               |
| `POLL_INTERVAL_SECONDS`   | 30        | 10..3600                                  |
| `REQUEST_TIMEOUT_SECONDS` | 10        | 1..60                                     |
| `SAMPLES`                 | 10        | 1..64 bars on the chart                   |
| `SCALE_MAX`               | 20        | Chart scale floor; auto-grows to fit data |
| `DISPLAY_DRIVER`          | `ssd1306` | `ssd1306` or `console`                    |
| `I2C_BUS`                 | 1         | I2C bus number                            |
| `I2C_ADDRESS`             | `0x3c`    | Hex or decimal                            |

## Local dev

```
DISPLAY_DRIVER=console node app.js
```

The console driver renders the framebuffer to stdout (2x downsampled) so you
can develop without hardware.

## Tests

```
yarn test
```
