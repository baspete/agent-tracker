#!/usr/bin/env bash
# Runs on the Mac. Provisions a fresh Pi for agent-tracker over SSH.
set -euo pipefail

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)
SCP=(scp -o BatchMode=yes -o ConnectTimeout=10 -q)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

HOST=${1:-${DEPLOY_HOST:-pi@agent-tracker.local}}

echo "==> provisioning $HOST"

PROV_TMP=$("${SSH[@]}" "$HOST" 'mktemp -d /tmp/agent-tracker-prov.XXXXXX')
"${SCP[@]}" \
  "$REPO_ROOT/deploy/agent-tracker.service" \
  "$REPO_ROOT/.env.example" \
  "$HOST:$PROV_TMP/"

# Everything below runs on the Pi as root. $1 is the temp dir holding
# agent-tracker.service and .env.example.
"${SSH[@]}" "$HOST" "sudo bash -s -- '$PROV_TMP'" <<'REMOTE_SCRIPT'
set -euo pipefail
{
PROV_TMP=$1
trap 'rm -rf "$PROV_TMP"' EXIT

ENV_FILE=/etc/agent-tracker/env
UNIT_SRC="$PROV_TMP/agent-tracker.service"
UNIT_DST=/etc/systemd/system/agent-tracker.service
APP_USER=agent-tracker
LOGIN_USER=${SUDO_USER:-pi}
NM_RESTART_NEEDED=''

say() {
  # say <ok|changed|skipped> <message>
  printf '%-8s %s\n' "$1:" "$2"
}

write_if_differs() {
  # write_if_differs <content> <dest> -> 0 if written, 1 if identical
  local dest=$2
  if [[ -f $dest ]] && printf '%s\n' "$1" | cmp -s - "$dest"; then
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  printf '%s\n' "$1" >"$dest"
  chmod 0644 "$dest"
  chown root:root "$dest"
  return 0
}

echo '== preflight'
arch=$(uname -m)
if [[ $arch != aarch64 && $arch != armv7l && $arch != armv6l ]]; then
  echo "unsupported architecture: $arch" >&2
  exit 1
fi
. /etc/os-release
if [[ ${VERSION_CODENAME:-} != bookworm ]]; then
  echo "unsupported OS release: ${VERSION_CODENAME:-unknown} (want bookworm)" >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)' ||
  { echo 'node >= 20.12 is required; install Node first' >&2; exit 1; }
command -v yarn >/dev/null || { echo 'yarn v1 is required; install yarn first' >&2; exit 1; }
say ok "preflight ($arch, bookworm, node $(node --version), yarn $(yarn --version))"

echo '== apt packages'
missing=''
for pkg in build-essential python3 i2c-tools; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"
done
if [[ -n $missing ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing
  say changed "installed:$missing"
else
  say ok 'apt packages already installed'
fi

echo '== i2c'
if grep -qE '^dtparam=i2c_arm=on' /boot/firmware/config.txt; then
  say ok 'i2c_arm already enabled'
else
  raspi-config nonint do_i2c 0
  say changed 'i2c enabled - REBOOT REQUIRED'
fi

echo '== service user'
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  say changed "created user $APP_USER"
else
  say ok "user $APP_USER exists"
fi
if id -nG "$APP_USER" | tr ' ' '\n' | grep -qx i2c; then
  say ok "$APP_USER is in group i2c"
else
  usermod -aG i2c "$APP_USER"
  say changed "added $APP_USER to group i2c"
fi

echo '== directories'
if [[ -d /opt/agent-tracker ]]; then
  say ok '/opt/agent-tracker exists'
else
  say changed 'created /opt/agent-tracker'
fi
install -d -o "$LOGIN_USER" -g "$LOGIN_USER" -m 0755 /opt/agent-tracker /opt/agent-tracker/releases
if [[ -d /etc/agent-tracker ]]; then
  say ok '/etc/agent-tracker exists'
else
  say changed 'created /etc/agent-tracker'
fi
install -d -o root -g "$APP_USER" -m 0750 /etc/agent-tracker

echo '== env file'
if [[ -f $ENV_FILE ]]; then
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  say ok "$ENV_FILE already exists (left untouched)"
elif [[ -f /home/$LOGIN_USER/agent-tracker/.env ]]; then
  install -m 0640 -o root -g "$APP_USER" "/home/$LOGIN_USER/agent-tracker/.env" "$ENV_FILE"
  say changed "$ENV_FILE migrated from old clone"
else
  install -m 0640 -o root -g "$APP_USER" "$PROV_TMP/.env.example" "$ENV_FILE"
  say changed "$ENV_FILE installed from template - EDIT $ENV_FILE"
fi
if grep -qE '^export ' "$ENV_FILE"; then
  sed -i 's/^export \([A-Za-z_][A-Za-z0-9_]*=\)/\1/' "$ENV_FILE"
  say changed 'stripped export prefixes (systemd EnvironmentFile does not support them)'
fi
for key in DEVOPS_ORG AGENT_POOL_ID DEVOPS_PAT; do
  if ! grep -qE "^(export )?${key}=" "$ENV_FILE"; then
    echo "WARNING: $key is not set in $ENV_FILE"
  fi
done

echo '== systemd unit'
unit_changed=''
if [[ -f $UNIT_DST ]] && cmp -s "$UNIT_SRC" "$UNIT_DST"; then
  say ok 'unit file unchanged'
else
  install -m 0644 -o root -g root "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
  unit_changed=1
  say changed 'unit file installed'
fi
if systemctl is-enabled --quiet agent-tracker 2>/dev/null; then
  :
else
  systemctl enable agent-tracker >/dev/null 2>&1
  say changed 'unit enabled'
fi
if [[ -n $unit_changed && -e /opt/agent-tracker/current ]]; then
  systemctl try-restart agent-tracker || true
  say changed 'service restarted (unit changed, release present)'
fi

echo '== wi-fi power save'
if write_if_differs '[connection]
wifi.powersave = 2' /etc/NetworkManager/conf.d/wifi-powersave-off.conf; then
  say changed 'wifi powersave disabled'
  NM_RESTART_NEEDED=1
else
  say ok 'wifi powersave already disabled'
fi

echo '== watchdog'
if write_if_differs '[Manager]
RuntimeWatchdogSec=15' /etc/systemd/system.conf.d/watchdog.conf; then
  systemctl daemon-reexec
  say changed 'hardware watchdog enabled (RuntimeWatchdogSec=15)'
else
  say ok 'watchdog already configured'
fi

echo '== journald cap'
if write_if_differs '[Journal]
SystemMaxUse=200M' /etc/systemd/journald.conf.d/size.conf; then
  systemctl restart systemd-journald
  say changed 'journald capped at 200M (older logs will be trimmed to fit)'
else
  say ok 'journald cap already set'
fi

# Schedule the NetworkManager restart last, after every other step, so a
# dropped Wi-Fi connection can't interrupt provisioning.
if [[ -n $NM_RESTART_NEEDED ]]; then
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --on-active=3 --quiet systemctl restart NetworkManager
  else
    nohup sh -c 'sleep 3; systemctl restart NetworkManager' >/dev/null 2>&1 &
  fi
  echo 'Wi-Fi will reconnect in ~3s; SSH may drop briefly'
fi

echo '== done'
echo 'Provisioning complete. Next step: run scripts/deploy.sh from the Mac.'
}
REMOTE_SCRIPT
