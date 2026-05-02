#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
OUT_DIR="${1:-$REPO_ROOT/dist}"

# Stamp shared/migrations.md with the canonical version from plugin.json
VERSION=$(jq -r '.version' "$REPO_ROOT/.claude-plugin/plugin.json")
TMP="$SKILLS_DIR/shared/migrations.md.tmp"
sed "s/current_version: \".*\"/current_version: \"$VERSION\"/" \
  "$SKILLS_DIR/shared/migrations.md" > "$TMP"
mv "$TMP" "$SKILLS_DIR/shared/migrations.md"

mkdir -p "$OUT_DIR"

for skill_dir in "$SKILLS_DIR"/*/; do
  skill=$(basename "$skill_dir")
  [ "$skill" = "shared" ] && continue

  zip_path="$OUT_DIR/$skill.zip"
  rm -f "$zip_path"

  # Add skill files (exclude .DS_Store and personal/ dirs)
  (cd "$skill_dir" && find . -type f -not -name '.DS_Store' -not -path '*/personal/*' | zip "$zip_path" -@)

  # Add shared/ as sibling directory
  (cd "$SKILLS_DIR" && find shared -type f -not -name '.DS_Store' | zip "$zip_path" -@)

  echo "  $skill.zip ($(du -h "$zip_path" | cut -f1 | xargs))"
done

echo ""
echo "Built $(ls "$OUT_DIR"/*.zip 2>/dev/null | wc -l | xargs) skill zips in $OUT_DIR"
