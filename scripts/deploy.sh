#!/usr/bin/env bash
# Runs on the Mac. Deploys a release to the Pi over SSH.
set -euo pipefail

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)
APP_ROOT=${APP_ROOT:-/opt/agent-tracker}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

usage() {
  echo "usage: $0 [--rollback|--status] [host]" >&2
  exit 2
}

MODE=deploy
case "${1:-}" in
  --rollback)
    MODE=rollback
    shift
    ;;
  --status)
    MODE=status
    shift
    ;;
  -h | --help) usage ;;
esac

HOST=${1:-${DEPLOY_HOST:-pi@agent-tracker.local}}

remote() {
  "${SSH[@]}" "$HOST" bash -s -- "$@" <"$SCRIPT_DIR/remote/release.sh"
}

case $MODE in
  status)
    remote status
    exit $?
    ;;
  rollback)
    remote rollback
    exit $?
    ;;
esac

cd "$REPO_ROOT"

echo '==> checking working tree'
if [ -n "$(git status --porcelain)" ]; then
  echo 'working tree is not clean; commit or stash first' >&2
  exit 1
fi

echo '==> running tests'
node --test

name="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
echo "==> deploying $name to $HOST"

echo '==> preparing release directory'
remote prepare "$name"

echo '==> uploading release'
git archive --format=tar HEAD | "${SSH[@]}" "$HOST" \
  "tar -x -C '$APP_ROOT/releases/$name.tmp'"

echo '==> committing upload'
remote commit-upload "$name"

echo '==> activating'
remote activate "$name"
