# Build Agent Tracker

A Raspberry Pi app that shows how many Azure DevOps agents in a pool are busy,
as a text line plus a scrolling bar chart on a 3.12" 256x64 SSD1322 greyscale
OLED driven over SPI.

## Hardware and wiring

1. **A Raspberry Pi** - a 3B+ works fine.
1. **A 3.12" SSD1322 OLED** (256x64, 16 grey levels) set up for 4-wire SPI.
   Power it from **3.3V, not 5V**.

| Display pin | Pi physical pin | Pi function     |
| ----------- | --------------- | --------------- |
| GND         | 6               | Ground          |
| VCC         | 1               | 3.3V            |
| SCK         | 23              | SPI0 SCLK       |
| SDA         | 19              | SPI0 MOSI       |
| RES         | 22              | GPIO25          |
| DC          | 18              | GPIO24          |
| CS          | 24              | SPI0 CE0        |

## Enable SPI

`scripts/provision.sh` enables SPI for you (`raspi-config nonint do_spi 0`)
and installs `libgpiod-dev`, which `node-libgpiod` needs to build. By hand:
`raspi-config` -> Interface Options -> SPI, then reboot and check that
`/dev/spidev0.0` and `/dev/gpiochip0` exist.

## Provision the Pi

From the Mac (requires Node >= 20.12 and yarn v1 already on the Pi):

```
scripts/provision.sh [host]        # default: pi@agent-tracker.local
```

It is idempotent and, as root on the Pi:

- checks architecture (arm/aarch64) and Debian bookworm, Node >= 20.12, yarn
- installs missing apt packages (`build-essential`, `python3`, `libgpiod-dev`)
- enables SPI if needed (prints REBOOT REQUIRED)
- creates the `agent-tracker` system user (nologin, groups `spi` and `gpio`)
- creates `/opt/agent-tracker` (pi:pi) and `/etc/agent-tracker` (root:agent-tracker)
- installs `/etc/agent-tracker/env` from your old `.env` or the template
- installs and enables the systemd unit
- disables Wi-Fi power save (`wifi.powersave = 2`), restarting NetworkManager
  a few seconds after the script finishes so SSH doesn't drop mid-run
- enables the hardware watchdog (`RuntimeWatchdogSec=15`)
- caps journald at 200M

The only dependencies, `spi-device` and `node-libgpiod` (libgpiod 1.x, which
bookworm ships), are native optional dependencies. A build failure on non-Linux
machines is expected and harmless — use `DISPLAY_DRIVER=console` for local dev.

The systemd unit only allows `/dev/spidev0.0` and the GPIO chip devices
(`char-gpiochip`; node-libgpiod opens every chip when it loads). If you change
`SPI_BUS` or `SPI_DEVICE`, update `DeviceAllow=` in
`deploy/agent-tracker.service` to match.

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
3. verifies `spi-device` and `node-libgpiod` actually load (they're
   optionalDependencies, so yarn can hide build failures)
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
| `SAMPLES`                 | 42        | 1..84 bars on the chart                   |
| `SCALE_MAX`               | (unset)   | Chart scale floor; unset = pool size      |
| `BRIGHTNESS`              | 8         | Daytime master contrast, 1..15            |
| `PIXEL_SHIFT_MINUTES`     | 5         | Burn-in: move the frame 1px this often; 0 = off |
| `NIGHT_START_HOUR`        | 22        | Local hour night dimming starts (0..23)   |
| `NIGHT_END_HOUR`          | 7         | Local hour it ends; equal to start = off  |
| `NIGHT_BRIGHTNESS`        | 5         | Master contrast at night, 1..15           |
| `DISPLAY_DRIVER`          | `ssd1322` | `ssd1322` or `console`                    |
| `DISPLAY_ROTATE`          | 0         | `0` or `180` (done in software)           |
| `SPI_BUS`                 | 0         | `/dev/spidev<bus>.<device>`               |
| `SPI_DEVICE`              | 0         | Chip select (0 = CE0)                     |
| `SPI_SPEED_HZ`            | 4000000   | 100000..10000000                          |
| `GPIO_CHIP`               | 0         | `/dev/gpiochip<n>`                        |
| `DC_GPIO`                 | 24        | BCM line for DC                           |
| `RESET_GPIO`              | 25        | BCM line for RES                          |

## Display

The left side shows the busy count in large digits. On the right:

- a header with the online count on the left (`12 ONLINE`) and the offline
  count on the right (`2 OFF`, shown even when zero); during an error it shows
  the error (`AUTH ERROR`, `NET ERROR`, `API ERROR`) and how long ago the last
  good poll was instead
- a bar chart of the last `SAMPLES` busy counts (newest brightest), scaled to
  the pool size, with a dim dashed line at the online count
- one square per agent: bright = busy, dim = idle, outline = offline

In an elastic (scale-set) pool, Azure DevOps reports idle agents as
`offline` / `Deallocated` until a job needs them. Those agents count as idle
(available); only disabled agents count as offline. Self-hosted agents use
their online/offline status.

Burn-in protection: the whole frame moves by one pixel every
`PIXEL_SHIFT_MINUTES`. The panel's master contrast is `BRIGHTNESS` by day and
drops to `NIGHT_BRIGHTNESS` (never higher than `BRIGHTNESS`) between `NIGHT_START_HOUR` and `NIGHT_END_HOUR` (Pi local
time). When no poll has succeeded for three poll intervals, the whole screen
dims to about 35%.

## Local dev

```
DISPLAY_DRIVER=console node app.js
```

The console driver renders the framebuffer to stdout (2x downsampled, grey
levels as `.:-=+*#%@`) so you can develop without hardware.

## Tests

```
yarn test
```
