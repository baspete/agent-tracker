#!/usr/bin/env bash
# Runs ON the Pi: ssh host bash -s -- <subcommand> [args] < scripts/remote/release.sh
set -euo pipefail

APP_ROOT=${APP_ROOT:-/opt/agent-tracker}
SERVICE=${SERVICE:-agent-tracker}
RELEASES="$APP_ROOT/releases"
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}
LOCK="$APP_ROOT/.deploy.lock"

die() {
  echo "release.sh: $*" >&2
  exit 1
}

LOCK_DIR_HELD=''
acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK"
    if ! flock -n 9; then
      die "another deploy holds $LOCK"
    fi
  else
    # mkdir-based fallback for systems without flock (e.g. macOS test hosts)
    if ! mkdir "$LOCK" 2>/dev/null; then
      die "another deploy holds $LOCK"
    fi
    LOCK_DIR_HELD=1
    trap '[[ -n $LOCK_DIR_HELD ]] && rmdir "$LOCK" 2>/dev/null || true' EXIT
  fi
}

# Atomically repoint a symlink. mv -T is GNU-only; on BSD fall back to
# unlink + rename (not atomic, but only used off-target).
switch_link() {
  local link=$1 target=$2 tmp
  tmp="$link.tmp.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp"
  if mv -T "$tmp" "$link" 2>/dev/null; then
    return
  fi
  rm -f "$link"
  mv "$tmp" "$link"
}

link_target() {
  [[ -L $1 ]] && readlink "$1" || true
}

health_check() {
  local since=$1 deadline
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    if systemctl is-active --quiet "$SERVICE" &&
      journalctl -u "$SERVICE" --since "$since" -o cat | grep -q '^agents busy:'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

print_journal_tail() {
  echo "--- last 30 journal lines for $SERVICE ---"
  journalctl -u "$SERVICE" -n 30 --no-pager -o cat || true
  echo "---"
}

prune_releases() {
  local keep_cur keep_prev i=0 d n
  keep_cur=$(link_target "$APP_ROOT/current")
  keep_prev=$(link_target "$APP_ROOT/previous")
  while IFS= read -r d; do
    d=${d%/}
    n=${d##*/}
    i=$((i + 1))
    if [[ "releases/$n" == "$keep_cur" || "releases/$n" == "$keep_prev" ]] || ((i <= 3)); then
      continue
    fi
    echo "pruning old release $n"
    rm -rf "$d"
  done < <(ls -1d "$RELEASES"/*/ 2>/dev/null | sort -r)
}

cmd_prepare() {
  local name=$1
  mkdir -p "$RELEASES"
  rm -rf "$RELEASES/$name.tmp"
  mkdir "$RELEASES/$name.tmp"
  echo "prepared $RELEASES/$name.tmp"
}

cmd_commit_upload() {
  local name=$1 cur
  [[ -d $RELEASES/$name.tmp ]] || die "no staged upload at $RELEASES/$name.tmp"
  cur=$(link_target "$APP_ROOT/current")
  if [[ -d $RELEASES/$name ]]; then
    [[ "releases/$name" == "$cur" ]] && die "$name is the current release, refusing to overwrite"
    rm -rf "$RELEASES/$name"
  fi
  mv "$RELEASES/$name.tmp" "$RELEASES/$name"
  echo "committed release $name"
}

cmd_activate() {
  local name=$1 cur since
  local dir="$RELEASES/$name"
  [[ -d $dir ]] || die "release $name does not exist"

  cur=$(link_target "$APP_ROOT/current")
  if [[ $cur == "releases/$name" ]]; then
    echo "$name is already current"
    exit 0
  fi

  # Reuse node_modules when dependencies are unchanged
  if [[ -n $cur && -f $APP_ROOT/current/yarn.lock ]] &&
    cmp -s "$APP_ROOT/current/yarn.lock" "$dir/yarn.lock"; then
    echo "yarn.lock unchanged; copying node_modules from previous release"
    cp -a "$APP_ROOT/current/node_modules" "$dir/" 2>/dev/null || true
  fi

  echo "installing dependencies"
  (cd "$dir" && yarn install --frozen-lockfile --production --non-interactive --no-progress)

  echo "verifying i2c-bus loads"
  if ! (cd "$dir" && node --input-type=module -e "await import('i2c-bus')"); then
    die "i2c-bus failed to load in $dir; aborting before switch"
  fi

  since=$(date '+%Y-%m-%d %H:%M:%S')
  if [[ -n $cur ]]; then
    ln -sfn "$cur" "$APP_ROOT/previous"
  fi
  switch_link "$APP_ROOT/current" "releases/$name"

  echo "restarting $SERVICE"
  sudo systemctl restart "$SERVICE"

  echo "waiting for a healthy first poll (up to ${HEALTH_TIMEOUT}s)"
  if health_check "$since"; then
    echo "deployed $name"
    prune_releases
    exit 0
  fi

  echo "health check failed for $name" >&2
  print_journal_tail

  local prev
  prev=$(link_target "$APP_ROOT/previous")
  if [[ -n $prev ]]; then
    switch_link "$APP_ROOT/current" "$prev"
    ln -sfn "releases/$name" "$APP_ROOT/previous"
    sudo systemctl restart "$SERVICE" || true
    echo "rolled back to $prev"
  else
    echo "no previous release to roll back to"
  fi
  exit 1
}

cmd_rollback() {
  local prev cur since
  prev=$(link_target "$APP_ROOT/previous")
  [[ -n $prev ]] || die "no previous release to roll back to"
  cur=$(link_target "$APP_ROOT/current")

  switch_link "$APP_ROOT/current" "$prev"
  if [[ -n $cur ]]; then
    ln -sfn "$cur" "$APP_ROOT/previous"
  fi

  since=$(date '+%Y-%m-%d %H:%M:%S')
  sudo systemctl restart "$SERVICE"

  echo "waiting for a healthy first poll (up to ${HEALTH_TIMEOUT}s)"
  if health_check "$since"; then
    echo "rolled back to $prev"
  else
    echo "rollback health check failed" >&2
    print_journal_tail
    exit 1
  fi
}

cmd_status() {
  echo "current:  $(link_target "$APP_ROOT/current")"
  echo "previous: $(link_target "$APP_ROOT/previous")"
  echo "releases:"
  ls -1 "$RELEASES" 2>/dev/null | sed 's/^/  /' || true
  echo "service:  $(systemctl is-active "$SERVICE" 2>/dev/null || echo unknown)"
  echo "--- last 10 journal lines ---"
  journalctl -u "$SERVICE" -n 10 --no-pager -o cat || true
}

sub=${1:-}
case $sub in
  prepare | commit-upload | activate | rollback)
    acquire_lock
    "cmd_${sub//-/_}" "${@:2}"
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "usage: release.sh {prepare|commit-upload|activate|rollback|status} [args]" >&2
    exit 2
    ;;
esac
