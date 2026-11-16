# TODO

## Additional SSD1322 displays

Goal: drive one or more extra 256x64 SSD1322 panels from the same Pi. The
second screen will probably *not* repeat the current layout. A likely use is a
summary of several self-hosted agent pools: one row per pool with its current
busy count and possibly a small sparkline.

### Hardware (confirmed feasible on the Pi 3B+)

- **SPI0** (in use) has two chip selects: CE0 (pin 24, display 1) and CE1
  (pin 26, GPIO7). Display 2 needs no boot-config change.
- **SPI1** adds three more chip selects with `dtoverlay=spi1-3cs` in
  `/boot/firmware/config.txt`: CE0 GPIO18 (pin 12), CE1 GPIO17 (pin 11),
  CE2 GPIO16 (pin 36); SCLK GPIO21 (pin 40), MOSI GPIO20 (pin 38). That
  allows up to five displays in all. Pick DC/RES GPIOs that don't clash with
  these.
- Wiring for a second display on SPI0:
  - SCK (pin 23), SDA (pin 19), GND, 3.3V: in parallel with display 1 (pin 17
    is a second 3.3V pin).
  - CS: pin 26 (CE1). This line must be separate per display.
  - DC: can be shared (pin 18). The SSD1322 ignores DC while its CS is
    inactive.
  - RES: use a separate GPIO, e.g. GPIO23 (pin 16). A shared RES would
    reset every panel whenever one driver recovers from an error.
- Power: each panel boosts 3.3V to its OLED supply. Two panels with mostly
  dark content are very likely fine on the Pi's 3.3V pins. For three or more,
  check the module's current rating and consider a separate 3.3V supply with a
  common ground.
- Bandwidth isn't a concern: a full frame is 8192 bytes, about 16 ms at
  4 MHz.

### Software notes

- **Shared DC line:** libgpiod won't let a line be requested twice, so
  drivers that share DC need one shared, reference-counted line handle.
  Closing or resetting one driver must not release a line another driver is
  still using.
- **Serialize display I/O:** with DC shared, two drivers writing at the same
  time could send one panel's data while DC is set for another panel's
  command. All SPI/DC traffic needs to go through one lock. Keep `reset()` and
  `close()` outside the lock, so a hung write can't block recovery.
- **systemd unit:** switch `DeviceAllow=/dev/spidev0.0 rw` to
  `DeviceAllow=char-spi rw`, so every spidev device is allowed (the unit
  already uses `char-gpiochip` for the same reason).
- **Provisioning:** if SPI1 is used, add an idempotent `spi1-3cs` overlay
  step to `scripts/provision.sh` (it needs a reboot, like SPI0).
- **Deploy health check:** it greps for `^agents busy:`. Keep that prefix in
  log lines and add a pool tag (e.g. `agents busy: 4 [pool 31]`) so pools
  can be told apart.
- The agents API response already gives busy/online/offline per pool
  (`summarizeAgents` in `src/devops.js`), so a multi-pool screen needs one
  request per pool per poll and no new endpoints. Pool *names* would need
  `GET _apis/distributedtask/pools/{id}`, or a configured label.

### Open questions

- Which pools does the second screen show, and is it one screen of several
  pools or one pool per screen?
- Layout for a multi-pool summary: rows per pool (name, busy count,
  sparkline); how many rows fit legibly in 64px (likely 4-5 with the 5x7
  font).
- Config format. Numbered settings (`AGENT_POOL_ID_2`, `SPI_DEVICE_2`, …)
  suit "one pool per display"; a list of pools per display probably needs a
  different shape.
- How each screen identifies what it shows (pool name from the API, a
  configured label, or physical labels).
- Whether pixel shift, night dimming and brightness stay global or become
  per display.
