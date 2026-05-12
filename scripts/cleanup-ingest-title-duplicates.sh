#!/usr/bin/env bash
set -euo pipefail

INGEST="${INGEST_DIR:-/ark/media/jellyfin/ingest}"

if [[ ! -d "$INGEST" ]]; then
  echo "Ingest directory not found: $INGEST"
  exit 1
fi

norm_key() {
  local n="$1"
  n="${n,,}"
  # Strip trailing IMDb tag suffix for dedupe key comparison.
  n="${n%% [imdbid-tt*}"
  n="$(echo "$n" | sed -E 's/[[:space:]]+/ /g; s/^ +| +$//g')"
  echo "$n"
}

choose_canonical() {
  local current="$1"
  local challenger="$2"
  # Prefer IMDb-tagged folder names, else keep current.
  if [[ "$current" != *"[imdbid-tt"* && "$challenger" == *"[imdbid-tt"* ]]; then
    echo "$challenger"
  else
    echo "$current"
  fi
}

move_children() {
  local from="$1"
  local to="$2"

  shopt -s nullglob dotglob
  for p in "$from"/*; do
    local b
    b="$(basename "$p")"
    [[ "$b" == "." || "$b" == ".." ]] && continue

    local target="$to/$b"
    if [[ -e "$target" ]]; then
      target="$to/${b}__merged_$(date +%Y%m%d-%H%M%S)-$RANDOM"
    fi
    mv "$p" "$target"
  done
  shopt -u nullglob dotglob
}

declare -A canonical_by_key
while IFS= read -r d; do
  name="$(basename "$d")"
  key="$(norm_key "$name")"

  if [[ -z "${canonical_by_key[$key]:-}" ]]; then
    canonical_by_key[$key]="$d"
  else
    canonical_by_key[$key]="$(choose_canonical "${canonical_by_key[$key]}" "$d")"
  fi
done < <(find "$INGEST" -mindepth 1 -maxdepth 1 -type d | sort)

merged=0
while IFS= read -r d; do
  name="$(basename "$d")"
  key="$(norm_key "$name")"
  canonical="${canonical_by_key[$key]}"

  [[ "$d" == "$canonical" ]] && continue

  echo "merge: $(basename "$d") -> $(basename "$canonical")"
  move_children "$d" "$canonical"
  rmdir "$d" 2>/dev/null || rm -rf "$d"
  merged=$((merged + 1))
done < <(find "$INGEST" -mindepth 1 -maxdepth 1 -type d | sort)

missing=0
printf "\nValidation (recursive media files):\n"
while IFS= read -r d; do
  count=$(find "$d" -type f \( \
    -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.mov' -o \
    -iname '*.wmv' -o -iname '*.m4v' -o -iname '*.flv' -o -iname '*.webm' -o \
    -iname '*.m2ts' -o -iname '*.mts' -o -iname '*.ts' -o -iname '*.mpg' -o \
    -iname '*.mpeg' -o -iname '*.iso' -o -iname '*.strm' \
  \) | wc -l | tr -d ' ')
  if [[ "$count" -eq 0 ]]; then
    echo "MISSING_MEDIA: $(basename "$d")"
    missing=$((missing + 1))
  else
    echo "OK($count): $(basename "$d")"
  fi
done < <(find "$INGEST" -mindepth 1 -maxdepth 1 -type d | sort)

printf "\nsummary merged=%s missing_media_folders=%s\n" "$merged" "$missing"
