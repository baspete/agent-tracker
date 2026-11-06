#!/usr/bin/env bash
# Local harness for scripts/remote/release.sh — stubs out sudo, systemctl,
# journalctl, yarn and node so the whole lifecycle can be exercised on a Mac.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
RELEASE_SH="$SCRIPT_DIR/remote/release.sh"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/release-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

STUB="$TMP/bin"
APP_ROOT="$TMP/app"
mkdir -p "$STUB" "$APP_ROOT/releases"

PASS=0
FAIL=0
ok() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}
bad() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1" >&2
}

# ---- stubs -----------------------------------------------------------------

cat >"$STUB/sudo" <<'EOF'
#!/bin/sh
exec "$@"
EOF

cat >"$STUB/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>"$STUB_CALLS"
cmd=''
for a in "$@"; do
  case $a in
    is-active | restart | try-restart | enable | daemon-reload) cmd=$a ;;
    *) ;;
  esac
done
case $cmd in
  is-active)
    [[ $* == *--quiet* ]] && exit 0
    echo active
    exit 0
    ;;
  *) exit 0 ;;
esac
EOF

cat >"$STUB/journalctl" <<'EOF'
#!/usr/bin/env bash
if [[ ${FAIL:-0} == 1 ]]; then
  exit 0
fi
echo 'agents busy: 3'
EOF

cat >"$STUB/yarn" <<'EOF'
#!/usr/bin/env bash
mkdir -p node_modules
exit 0
EOF

cat >"$STUB/node" <<'EOF'
#!/usr/bin/env bash
if [[ ${NODE_FAIL:-0} == 1 ]]; then
  echo 'i2c-bus stub failure' >&2
  exit 1
fi
exit 0
EOF

chmod +x "$STUB"/*

export STUB_CALLS="$TMP/systemctl.calls"
export PATH="$STUB:$PATH"
export APP_ROOT SERVICE=agent-tracker HEALTH_TIMEOUT=3

mkrelease() {
  local d="$APP_ROOT/releases/$1"
  mkdir -p "$d"
  printf '{}\n' >"$d/package.json"
  printf 'lockfile-%s\n' "${LOCK_CONTENT:-v1}" >"$d/yarn.lock"
  printf '// app\n' >"$d/app.js"
}

target() {
  readlink "$APP_ROOT/$1" 2>/dev/null || echo '(none)'
}

# ---- 1. first activate, no previous ----------------------------------------

mkrelease r1
if bash "$RELEASE_SH" activate r1 >/dev/null 2>&1 &&
  [[ $(target current) == 'releases/r1' ]]; then
  ok 'first activate sets current'
else
  bad 'first activate'
fi
[[ $(target previous) == '(none)' ]] && ok 'no previous after first activate' ||
  bad 'previous unexpectedly set'

touch "$APP_ROOT/releases/r1/node_modules/MARKER"

# ---- 2. second activate: previous set, node_modules copied ------------------

mkrelease r2
bash "$RELEASE_SH" activate r2 >/dev/null 2>&1
if [[ $(target current) == 'releases/r2' && $(target previous) == 'releases/r1' ]]; then
  ok 'second activate sets current and previous'
else
  bad "second activate links (cur=$(target current) prev=$(target previous))"
fi
[[ -f $APP_ROOT/releases/r2/node_modules/MARKER ]] &&
  ok 'node_modules copied when yarn.lock identical' ||
  bad 'node_modules copy'

# ---- 3. failed health check rolls back --------------------------------------

mkrelease r3
if FAIL=1 bash "$RELEASE_SH" activate r3 >/dev/null 2>&1; then
  bad 'failing deploy should exit non-zero'
else
  ok 'failing deploy exits non-zero'
fi
[[ $(target current) == 'releases/r2' ]] &&
  ok 'auto-rollback restored previous current' ||
  bad "auto-rollback current=$(target current)"
[[ $(target previous) == 'releases/r3' ]] &&
  ok 'failed release recorded as previous' ||
  bad "previous after rollback=$(target previous)"

# ---- 4. native module failure aborts before switching -----------------------

mkrelease r4
if NODE_FAIL=1 bash "$RELEASE_SH" activate r4 >/dev/null 2>&1; then
  bad 'NODE_FAIL deploy should exit non-zero'
else
  ok 'i2c-bus load failure exits non-zero'
fi
[[ $(target current) == 'releases/r2' ]] &&
  ok 'current untouched after i2c-bus failure' ||
  bad "current after NODE_FAIL=$(target current)"

# ---- 5. rollback subcommand swaps current and previous ----------------------

bash "$RELEASE_SH" rollback >/dev/null 2>&1
if [[ $(target current) == 'releases/r3' && $(target previous) == 'releases/r2' ]]; then
  ok 'rollback swaps current and previous'
else
  bad "rollback (cur=$(target current) prev=$(target previous))"
fi

# ---- 6. pruning keeps current + previous + 3 newest -------------------------

mkrelease r5
mkrelease r6
mkrelease r7
mkrelease r8
# current=r3 previous=r2; activate r8 -> current=r8, previous=r3.
# Keep current(r8) + previous(r3) + 3 newest(r8,r7,r6) = r8,r7,r6,r3.
bash "$RELEASE_SH" activate r8 >/dev/null 2>&1
left=$(ls -1 "$APP_ROOT/releases" | wc -l | tr -d ' ')
actual=$(ls -1 "$APP_ROOT/releases" | tr '\n' ' ')
if [[ $left -eq 4 && " $actual" == *'r8'* && " $actual" == *'r7'* &&
  " $actual" == *'r6'* && " $actual" == *'r3'* ]]; then
  ok "pruning kept current+previous+3 newest ($actual)"
else
  bad "pruning left: $actual"
fi

# ---- 7. lock ----------------------------------------------------------------

if command -v flock >/dev/null 2>&1; then
  (
    exec 9>"$APP_ROOT/.deploy.lock"
    flock 9
    if bash "$RELEASE_SH" status >/dev/null 2>&1; then :; fi
    if bash "$RELEASE_SH" prepare locked1 2>/dev/null; then
      exit 1
    fi
  ) && bad 'lock: second invocation should fail' ||
    ok 'lock: concurrent invocation fails fast (flock)'
else
  mkdir "$APP_ROOT/.deploy.lock"
  if bash "$RELEASE_SH" prepare locked1 2>/dev/null; then
    bad 'lock: second invocation should fail (mkdir)'
  else
    ok 'lock: concurrent invocation fails fast (mkdir fallback)'
  fi
  rmdir "$APP_ROOT/.deploy.lock"
fi

# ---- bonus: prepare + commit-upload -----------------------------------------

bash "$RELEASE_SH" prepare r9 >/dev/null 2>&1
echo x >"$APP_ROOT/releases/r9.tmp/pkg"
bash "$RELEASE_SH" commit-upload r9 >/dev/null 2>&1
[[ -f $APP_ROOT/releases/r9/pkg ]] && ok 'prepare + commit-upload' ||
  bad 'prepare + commit-upload'

echo
echo "$PASS passed, $FAIL failed"
(( FAIL == 0 ))
