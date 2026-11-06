# agent-tracker

Shows how many Azure DevOps agents in one pool are busy, as text plus a bar
chart on a 128x64 SSD1306 I2C OLED. Runs on a Raspberry Pi (Node >= 20.12),
with a console display driver for local dev on other platforms.

## Commands

- Install: `yarn install --frozen-lockfile` (the only dep, `i2c-bus`, is
  optional and native; a build failure off-Pi is expected)
- Run: `yarn start` (or `node app.js`)
- Local dev without hardware: `DISPLAY_DRIVER=console node app.js`
- Test: `yarn test` (or `node --test`)
- Provision a Pi: `scripts/provision.sh [host]` (idempotent; host defaults to
  `pi@agent-tracker.local` or `$DEPLOY_HOST`)
- Deploy a release: `scripts/deploy.sh [host]` (requires a clean tree; runs
  `node --test` first)
- Remote status / rollback: `scripts/deploy.sh --status [host]` /
  `scripts/deploy.sh --rollback [host]`
- Local test of the Pi-side release script: `scripts/test-release.sh`

Mac-side scripts must stay bash 3.2 compatible (no associative arrays,
`mapfile`, `${x,,}`, or `|&`). `scripts/remote/release.sh` runs on the Pi
under bash 5 but is also exercised on macOS by the test harness, so keep
`sudo`/`systemctl`/`journalctl` PATH-overridable and avoid GNU-only flags.

## Rules

- Never log, print, or embed the PAT (`DEVOPS_PAT`) in any message, error,
  fixture, or commit. `DevOpsError` messages must stay secret-free.
- Configuration comes from env vars (see `.env.example`); `.env` is loaded via
  `process.loadEnvFile` in `src/main.js` and is git-ignored.
