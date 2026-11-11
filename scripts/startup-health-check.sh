#!/usr/bin/env bash
# Pre-flight check for the host running docker-compose.yml.
# Layout reference: docs/architecture/STORAGE_AND_HOSTS.md

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MEDIA_ROOT="${MEDIA_ROOT:-/ark/media}"
JELLYFIN_ROOT="$MEDIA_ROOT/jellyfin"
INGEST_ROOT="$MEDIA_ROOT/ingest"
EXPECTED_DIRS=(
  "Movies"
  "TV Shows"
  "Documentaries"
  "Live Performances"
)

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

pass() {
  echo "PASS: $1"
}

info() {
  echo "INFO: $1"
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH"
command -v rg >/dev/null 2>&1 || fail "rg is required for this script"

current_context="$(docker context show 2>/dev/null || true)"
[[ "$current_context" == "default" ]] || fail "docker context must be 'default' (native engine), found '${current_context:-unknown}'"
pass "docker context is native default"

docker_state="$(systemctl is-active docker 2>/dev/null || true)"
[[ "$docker_state" == "active" ]] || fail "docker service is not active"
pass "docker service is active"

mountpoint -q "$MEDIA_ROOT" || fail "$MEDIA_ROOT is not a mounted filesystem"
mount | rg -q "/media on ${MEDIA_ROOT} type cifs" || fail "$MEDIA_ROOT is not a CIFS mount of the NAS media share"
pass "TrueNAS media share is mounted on $MEDIA_ROOT"

[[ -d "$JELLYFIN_ROOT" ]] || fail "$JELLYFIN_ROOT does not exist"
pass "jellyfin root exists"

for dir_name in "${EXPECTED_DIRS[@]}"; do
  dir_path="$JELLYFIN_ROOT/$dir_name"
  [[ -d "$dir_path" ]] || fail "required directory missing: $dir_path"
  [[ -w "$dir_path" ]] || fail "required directory not writable: $dir_path"
done
pass "required jellyfin directories exist and are writable"

owner_group="$(stat -c '%U:%G %a' "$JELLYFIN_ROOT")"
info "effective ownership/mode for jellyfin root: $owner_group"

[[ -d "$INGEST_ROOT" && -w "$INGEST_ROOT" ]] || fail "ingest root missing or not writable: $INGEST_ROOT"
probe_file="$INGEST_ROOT/.startup-health-check.tmp"
rm -f "$probe_file"
touch "$probe_file" || fail "could not write test file under $INGEST_ROOT"
rm -f "$probe_file"
pass "write test succeeded in ingest folder"

if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps --services >/dev/null 2>&1; then
    if docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps backend 2>/dev/null | rg -q "backend"; then
      docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T backend sh -lc '
        set -e
        test -d "/ark/media/jellyfin"
        test -d "/ark/media/ingest"
        ls -1 "/ark/media/jellyfin" >/dev/null
      ' || fail "backend container cannot see required NAS folders"
      pass "backend container can access jellyfin folders"
    else
      info "backend container is not running; skipped container visibility check"
    fi
  fi
fi

fstab_matches="$(rg -n "^//[^[:space:]]+/media[[:space:]]+${MEDIA_ROOT}[[:space:]]" /etc/fstab | wc -l | tr -d ' ')"
[[ "$fstab_matches" -ge 1 ]] || fail "no /etc/fstab entry mounts the NAS media share on $MEDIA_ROOT"
pass "persistent fstab entry for $MEDIA_ROOT detected"

echo
echo "Startup health check completed successfully."