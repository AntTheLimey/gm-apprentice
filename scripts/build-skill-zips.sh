#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
OUT_DIR="${1:-$REPO_ROOT/dist}"

# A zip has no plugin.json, so shared/VERSION carries the plugin version into it.
# It is written into a staging copy of shared/, never into the source tree.
VERSION=$(jq -r '.version' "$REPO_ROOT/.claude-plugin/plugin.json")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$SKILLS_DIR/shared" "$STAGE/shared"
printf '%s\n' "$VERSION" > "$STAGE/shared/VERSION"

mkdir -p "$OUT_DIR"

for skill_dir in "$SKILLS_DIR"/*/; do
  skill=$(basename "$skill_dir")
  [ "$skill" = "shared" ] && continue

  zip_path="$OUT_DIR/$skill.zip"
  rm -f "$zip_path"

  # Add skill files (exclude .DS_Store and personal/ dirs)
  (cd "$skill_dir" && find . -type f -not -name '.DS_Store' -not -path '*/personal/*' | zip "$zip_path" -@)

  # Add shared/ as sibling directory
  (cd "$STAGE" && find shared -type f -not -name '.DS_Store' -not -path '*/__pycache__/*' | zip "$zip_path" -@)

  echo "  $skill.zip ($(du -h "$zip_path" | cut -f1 | xargs))"
done

echo ""
echo "Built $(ls "$OUT_DIR"/*.zip 2>/dev/null | wc -l | xargs) skill zips in $OUT_DIR"
