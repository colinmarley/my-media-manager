#!/usr/bin/env bash
set -euo pipefail

JELLYFIN_BASE="${JELLYFIN_BASE:-/ark/media/jellyfin}"
INGEST_DIR="${INGEST_DIR:-$JELLYFIN_BASE/ingest}"
CONFIRM="${1:-}"

SOURCE_DIRS=(
  "$JELLYFIN_BASE/Movies"
  "$JELLYFIN_BASE/TV Shows"
  "$JELLYFIN_BASE/Series"
  "$JELLYFIN_BASE/Documentaries"
  "$JELLYFIN_BASE/Live Performances"
  "$JELLYFIN_BASE/Home Videos"
  "$JELLYFIN_BASE/_NeedsReview"
)

if [[ "$CONFIRM" != "--yes" ]]; then
  cat <<EOF
This will:
1) Move media entries from Jellyfin subfolders directly into:
  - $INGEST_DIR
  (including flattening any existing retest-batch-* folders)
2) Wipe catalog tables in Postgres for a fresh My Library state.

Run again with --yes to proceed.
EOF
  exit 1
fi

if [[ ! -d "$INGEST_DIR" ]]; then
  echo "Required directory missing: $INGEST_DIR"
  exit 1
fi

unique_destination() {
  local destination_dir="$1"
  local base_name="$2"
  local candidate="$destination_dir/$base_name"
  if [[ ! -e "$candidate" ]]; then
    echo "$candidate"
    return
  fi
  local suffix
  suffix="$(date +%Y%m%d-%H%M%S)-$RANDOM"
  echo "$destination_dir/${base_name}__retest_${suffix}"
}

move_entries_to_ingest() {
  local source_dir="$1"
  local destination_dir="$2"
  local moved=0

  if [[ ! -d "$source_dir" ]]; then
    echo 0
    return
  fi

  shopt -s nullglob dotglob
  for entry in "$source_dir"/*; do
    local name
    name="$(basename "$entry")"

    # Keep system placeholders and hidden markers in place.
    if [[ "$name" == "." || "$name" == ".." || "$name" == ".gitkeep" ]]; then
      continue
    fi

    local target
    target="$(unique_destination "$destination_dir" "$name")"
    mv "$entry" "$target"
    moved=$((moved + 1))
  done
  shopt -u nullglob dotglob

  echo "$moved"
}

flatten_ingest_wrappers() {
  local destination_dir="$1"
  local flattened=0

  shopt -s nullglob
  for wrapper in "$destination_dir"/*; do
    [[ -d "$wrapper" ]] || continue
    local name
    name="$(basename "$wrapper")"

    # Known category wrapper names created by earlier reset batches.
    if [[ ! "$name" =~ ^(Movies|TV[[:space:]]Shows|Series|Documentaries|Live[[:space:]]Performances|Home[[:space:]]Videos|_NeedsReview)(__retest_.*)?$ ]]; then
      continue
    fi

    moved_count="$(move_entries_to_ingest "$wrapper" "$destination_dir")"
    flattened=$((flattened + moved_count))
    rmdir "$wrapper" 2>/dev/null || true
  done
  shopt -u nullglob

  echo "$flattened"
}

echo "Flattening existing retest batches into ingest root..."
batch_moved=0
shopt -s nullglob
for batch_dir in "$INGEST_DIR"/retest-batch-*; do
  if [[ -d "$batch_dir" ]]; then
    # Move one level deeper first (e.g., Movies/*, TV Shows/*) into ingest root.
    for nested_dir in "$batch_dir"/*; do
      if [[ -d "$nested_dir" ]]; then
        moved_nested="$(move_entries_to_ingest "$nested_dir" "$INGEST_DIR")"
        batch_moved=$((batch_moved + moved_nested))
      elif [[ -e "$nested_dir" ]]; then
        name="$(basename "$nested_dir")"
        target="$(unique_destination "$INGEST_DIR" "$name")"
        mv "$nested_dir" "$target"
        batch_moved=$((batch_moved + 1))
      fi
    done

    rm -rf "$batch_dir"
  fi
done
shopt -u nullglob

echo "Moving Jellyfin subfolder entries into ingest root..."
total_moved=0
for source_dir in "${SOURCE_DIRS[@]}"; do
  moved_count="$(move_entries_to_ingest "$source_dir" "$INGEST_DIR")"
  total_moved=$((total_moved + moved_count))
done

wrapper_flattened="$(flatten_ingest_wrappers "$INGEST_DIR")"

echo "Moved $total_moved entries from Jellyfin subfolders, $batch_moved from prior batches, and flattened $wrapper_flattened wrapper entries in ingest."

echo "Resetting library catalog tables..."
docker compose exec -T postgres psql -U media_user -d media_manager -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE episodes, seasons, release_series, release_movies, discs, releases, series, movies RESTART IDENTITY CASCADE;"

echo "Clearing backend poster cache..."
docker compose exec -T backend sh -lc 'rm -rf /data/media_manager/posters/* || true'

echo "Done."
echo "Ingress re-test location: $INGEST_DIR"
