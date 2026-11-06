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

## Install

Requires Node.js >= 20.12 and yarn v1. On the Pi:

```
git clone <this repo> /home/pi/agent-tracker
cd /home/pi/agent-tracker
yarn install --frozen-lockfile
```

The only dependency, `i2c-bus`, is a native optional dependency. A build
failure on non-Linux machines is expected and harmless — use
`DISPLAY_DRIVER=console` for local dev.

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

## Run under systemd

```
sudo cp deploy/agent-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agent-tracker
journalctl -u agent-tracker -f
```

The unit restarts the app on failure but not on config errors (exit 78), and
runs with hardened sandboxing while keeping access to `/dev/i2c-1`.

## Migrating from pm2

```
pm2 delete app
pm2 save
pm2 unstartup systemd
```

Then install the systemd unit as above.

## Pi reliability tips

Disable Wi-Fi power save so polling isn't interrupted:

`/etc/NetworkManager/conf.d/wifi-powersave-off.conf`:

```
[connection]
wifi.powersave = 2
```

Enable the hardware watchdog so a hung Pi reboots itself:

`/etc/systemd/system.conf.d/watchdog.conf`:

```
[Manager]
RuntimeWatchdogSec=15
```

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
