#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
OUT_DIR="${1:-$REPO_ROOT/dist}"

# shared/VERSION is committed and carries the version into every zip; it
# must equal plugin.json's, or the zips would ship the wrong one.
VERSION=$(jq -r '.version' "$REPO_ROOT/.claude-plugin/plugin.json")
STAMP=$(cat "$SKILLS_DIR/shared/VERSION")
# Trim the ends only, as the scripts read it: "1.11 .7" is not 1.11.7.
STAMP="${STAMP#"${STAMP%%[![:space:]]*}"}"
STAMP="${STAMP%"${STAMP##*[![:space:]]}"}"
if [ "$STAMP" != "$VERSION" ]; then
  echo "::error::skills/shared/VERSION ($STAMP) differs from plugin.json ($VERSION): bump both"
  exit 1
fi
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$SKILLS_DIR/shared" "$STAGE/shared"

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
