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

## Rules

- Never log, print, or embed the PAT (`DEVOPS_PAT`) in any message, error,
  fixture, or commit. `DevOpsError` messages must stay secret-free.
- Configuration comes from env vars (see `.env.example`); `.env` is loaded via
  `process.loadEnvFile` in `src/main.js` and is git-ignored.
