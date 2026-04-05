#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# GURPS 4e Character-Generation Benchmark Runner
#
# Usage: ./run.sh --model opus|sonnet|haiku [--skip-review]
# ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── CLI parsing ──────────────────────────────────────────

MODEL=""
SKIP_REVIEW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"; shift 2 ;;
    --skip-review)
      SKIP_REVIEW=true; shift ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 --model opus|sonnet|haiku [--skip-review]" >&2
      exit 1 ;;
  esac
done

if [[ -z "$MODEL" ]]; then
  echo "Error: --model is required (opus|sonnet|haiku)" >&2
  exit 1
fi

case "$MODEL" in
  opus|sonnet|haiku) ;;
  *)
    echo "Error: model must be opus, sonnet, or haiku (got: $MODEL)" >&2
    exit 1 ;;
esac

# ── Dependency checks ────────────────────────────────────

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed." >&2
  echo "  brew install jq   # macOS" >&2
  echo "  apt install jq    # Debian/Ubuntu" >&2
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI is required but not found in PATH." >&2
  exit 1
fi

# ── Directories ──────────────────────────────────────────

PROMPTS_DIR="$SCRIPT_DIR/prompts"
OUTPUT_DIR="$SCRIPT_DIR/output"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$OUTPUT_DIR" "$RESULTS_DIR"

# ── Character types ──────────────────────────────────────

TYPES=(combat magic super)

# ── Metrics arrays ───────────────────────────────────────

declare -a M_TOKENS M_ROUNDS M_DURATION M_COST
declare -a FAILED

# ── Generate characters ──────────────────────────────────

echo "═══════════════════════════════════════════════" >&2
echo " GURPS 4e Chargen Benchmark — model: $MODEL"    >&2
echo "═══════════════════════════════════════════════" >&2

for i in "${!TYPES[@]}"; do
  TYPE="${TYPES[$i]}"
  PROMPT_FILE="$PROMPTS_DIR/${TYPE}.txt"

  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "  ✗ $TYPE — prompt file not found: $PROMPT_FILE" >&2
    FAILED+=("$TYPE")
    M_TOKENS[$i]=0; M_ROUNDS[$i]=0; M_DURATION[$i]=0; M_COST[$i]=0
    continue
  fi

  JSON_OUT="$OUTPUT_DIR/${TYPE}-${MODEL}.json"
  MD_OUT="$OUTPUT_DIR/${TYPE}-${MODEL}.md"

  echo "" >&2
  echo "  ▶ Generating $TYPE character …" >&2

  # Run claude — redirect prompt file to stdin
  set +e
  claude -p \
    --output-format json \
    --model "$MODEL" \
    --allowedTools "Read,Glob" \
    < "$PROMPT_FILE" \
    > "$JSON_OUT" 2>/dev/null
  RC=$?
  set -e

  if [[ $RC -ne 0 ]] || [[ ! -s "$JSON_OUT" ]]; then
    echo "  ✗ $TYPE — claude invocation failed (exit $RC)" >&2
    FAILED+=("$TYPE")
    M_TOKENS[$i]=0; M_ROUNDS[$i]=0; M_DURATION[$i]=0; M_COST[$i]=0
    continue
  fi

  # Extract character sheet text
  jq -r '.result // empty' "$JSON_OUT" > "$MD_OUT"

  # Extract metrics
  USAGE=$(jq '[.modelUsage[]][0]' "$JSON_OUT")
  INPUT_T=$(echo "$USAGE" | jq '.inputTokens // 0')
  OUTPUT_T=$(echo "$USAGE" | jq '.outputTokens // 0')
  CACHE_READ=$(echo "$USAGE" | jq '.cacheReadInputTokens // 0')
  CACHE_CREATE=$(echo "$USAGE" | jq '.cacheCreationInputTokens // 0')
  TOKENS=$(( INPUT_T + OUTPUT_T + CACHE_READ + CACHE_CREATE ))

  NUM_TURNS=$(jq '.num_turns // 1' "$JSON_OUT")
  TOOL_ROUNDS=$(( NUM_TURNS - 1 ))

  DURATION_MS=$(jq '.duration_ms // 0' "$JSON_OUT")
  DURATION=$(awk "BEGIN {printf \"%.1f\", $DURATION_MS / 1000}")

  COST_RAW=$(jq '.total_cost_usd // 0' "$JSON_OUT")
  COST=$(awk "BEGIN {printf \"%.4f\", $COST_RAW}")

  M_TOKENS[$i]=$TOKENS
  M_ROUNDS[$i]=$TOOL_ROUNDS
  M_DURATION[$i]="$DURATION"
  M_COST[$i]="$COST"

  echo "  ✓ $TYPE — ${TOKENS} tok, ${TOOL_ROUNDS} rounds, ${DURATION}s, \$${COST}" >&2
done

# ── Quality Review ───────────────────────────────────────

declare -a Q_MATH Q_PREREQS Q_EFFICIENCY Q_COHERENCE Q_COMPLETENESS Q_TOTAL Q_ATTR_MISS
declare -a Q_NOTES
REVIEW_RAW=""

if [[ "$SKIP_REVIEW" == true ]]; then
  echo "" >&2
  echo "  ⏭ Skipping quality review (--skip-review)" >&2
  for i in "${!TYPES[@]}"; do
    Q_MATH[$i]="–"; Q_PREREQS[$i]="–"; Q_EFFICIENCY[$i]="–"
    Q_COHERENCE[$i]="–"; Q_COMPLETENESS[$i]="–"; Q_TOTAL[$i]="–"
    Q_ATTR_MISS[$i]="–"; Q_NOTES[$i]=""
  done
else
  echo "" >&2
  echo "  ▶ Running quality review (Opus) …" >&2

  # Build review input file: review-prompt + rubric + all 3 sheets
  REVIEW_TMP="$OUTPUT_DIR/.review-input-${MODEL}.txt"
  cat "$SCRIPT_DIR/review-prompt.txt" > "$REVIEW_TMP"
  echo "" >> "$REVIEW_TMP"
  cat "$SCRIPT_DIR/rubric.md" >> "$REVIEW_TMP"
  echo -e "\n\n--- CHARACTER SHEETS ---" >> "$REVIEW_TMP"

  for TYPE in "${TYPES[@]}"; do
    SHEET="$OUTPUT_DIR/${TYPE}-${MODEL}.md"
    TYPE_UPPER="$(echo "$TYPE" | tr '[:lower:]' '[:upper:]')"
    echo -e "\n\n=== ${TYPE_UPPER} ===" >> "$REVIEW_TMP"
    if [[ -f "$SHEET" ]] && [[ -s "$SHEET" ]]; then
      cat "$SHEET" >> "$REVIEW_TMP"
    else
      echo "[Character generation failed — no sheet available]" >> "$REVIEW_TMP"
    fi
  done

  REVIEW_JSON="$OUTPUT_DIR/review-${MODEL}.json"

  set +e
  claude -p \
    --output-format json \
    --model opus \
    --allowedTools "" \
    < "$REVIEW_TMP" \
    > "$REVIEW_JSON" 2>/dev/null
  REVIEW_RC=$?
  set -e

  rm -f "$REVIEW_TMP"

  if [[ $REVIEW_RC -ne 0 ]] || [[ ! -s "$REVIEW_JSON" ]]; then
    echo "  ✗ Review failed (exit $REVIEW_RC)" >&2
    for i in "${!TYPES[@]}"; do
      Q_MATH[$i]="–"; Q_PREREQS[$i]="–"; Q_EFFICIENCY[$i]="–"
      Q_COHERENCE[$i]="–"; Q_COMPLETENESS[$i]="–"; Q_TOTAL[$i]="–"
      Q_ATTR_MISS[$i]="–"; Q_NOTES[$i]=""
    done
  else
    REVIEW_RAW="$(jq -r '.result // empty' "$REVIEW_JSON")"

    # Parse 3 JSON blocks separated by --- lines
    # Split on lines that are exactly "---"
    BLOCK_INDEX=0
    CURRENT_BLOCK=""

    while IFS= read -r line; do
      # Strip leading/trailing whitespace for the separator check
      TRIMMED="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [[ "$TRIMMED" == "---" ]]; then
        if [[ -n "$CURRENT_BLOCK" ]]; then
          # Process this block
          SCORES="$(echo "$CURRENT_BLOCK" | jq -r '.' 2>/dev/null)" || SCORES=""
          if [[ -n "$SCORES" ]]; then
            Q_MATH[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.math // "–"')"
            Q_PREREQS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.prereqs // "–"')"
            Q_EFFICIENCY[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.efficiency // "–"')"
            Q_COHERENCE[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.coherence // "–"')"
            Q_COMPLETENESS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.completeness // "–"')"
            Q_TOTAL[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.total // "–"')"
            Q_ATTR_MISS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.attr_eff_miss // "–"')"
            Q_NOTES[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.notes // ""')"
          fi
          BLOCK_INDEX=$(( BLOCK_INDEX + 1 ))
          CURRENT_BLOCK=""
        fi
        continue
      fi
      # Accumulate non-separator lines — only keep lines that look like JSON
      if [[ "$TRIMMED" == "{"* ]] || [[ -n "$CURRENT_BLOCK" ]]; then
        CURRENT_BLOCK+="$line"
      fi
    done <<< "$REVIEW_RAW"

    # Process the last block (no trailing ---)
    if [[ -n "$CURRENT_BLOCK" ]] && [[ $BLOCK_INDEX -lt 3 ]]; then
      SCORES="$(echo "$CURRENT_BLOCK" | jq -r '.' 2>/dev/null)" || SCORES=""
      if [[ -n "$SCORES" ]]; then
        Q_MATH[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.math // "–"')"
        Q_PREREQS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.prereqs // "–"')"
        Q_EFFICIENCY[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.efficiency // "–"')"
        Q_COHERENCE[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.coherence // "–"')"
        Q_COMPLETENESS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.completeness // "–"')"
        Q_TOTAL[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.scores.total // "–"')"
        Q_ATTR_MISS[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.attr_eff_miss // "–"')"
        Q_NOTES[$BLOCK_INDEX]="$(echo "$CURRENT_BLOCK" | jq -r '.notes // ""')"
      fi
    fi

    # Fill any missing blocks with placeholders
    for i in "${!TYPES[@]}"; do
      Q_MATH[$i]="${Q_MATH[$i]:-–}"
      Q_PREREQS[$i]="${Q_PREREQS[$i]:-–}"
      Q_EFFICIENCY[$i]="${Q_EFFICIENCY[$i]:-–}"
      Q_COHERENCE[$i]="${Q_COHERENCE[$i]:-–}"
      Q_COMPLETENESS[$i]="${Q_COMPLETENESS[$i]:-–}"
      Q_TOTAL[$i]="${Q_TOTAL[$i]:-–}"
      Q_ATTR_MISS[$i]="${Q_ATTR_MISS[$i]:-–}"
      Q_NOTES[$i]="${Q_NOTES[$i]:-}"
    done

    echo "  ✓ Review complete" >&2
  fi
fi

# ── Compute averages ─────────────────────────────────────

AVG_TOKENS=$(awk "BEGIN {printf \"%.0f\", (${M_TOKENS[0]} + ${M_TOKENS[1]} + ${M_TOKENS[2]}) / 3}")
AVG_ROUNDS=$(awk "BEGIN {printf \"%.1f\", (${M_ROUNDS[0]} + ${M_ROUNDS[1]} + ${M_ROUNDS[2]}) / 3}")
AVG_DURATION=$(awk "BEGIN {printf \"%.1f\", (${M_DURATION[0]} + ${M_DURATION[1]} + ${M_DURATION[2]}) / 3}")
AVG_COST=$(awk "BEGIN {printf \"%.4f\", (${M_COST[0]} + ${M_COST[1]} + ${M_COST[2]}) / 3}")

# Average quality (only if numeric)
AVG_QUALITY="–"
if [[ "${Q_TOTAL[0]}" != "–" ]] && [[ "${Q_TOTAL[1]}" != "–" ]] && [[ "${Q_TOTAL[2]}" != "–" ]]; then
  AVG_QUALITY=$(awk "BEGIN {printf \"%.1f\", (${Q_TOTAL[0]} + ${Q_TOTAL[1]} + ${Q_TOTAL[2]}) / 3}")
fi

# ── Git info ─────────────────────────────────────────────

GIT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
GIT_HASH="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

# ── Write report ─────────────────────────────────────────

TIMESTAMP="$(date '+%Y-%m-%d-%H%M')"
REPORT_FILE="$RESULTS_DIR/${TIMESTAMP}-${MODEL}.md"

cat > "$REPORT_FILE" << REPORT_EOF
# Benchmark: GURPS 4e Chargen

**Model:** $MODEL
**Branch:** $GIT_BRANCH ($GIT_HASH)
**Date:** $(date '+%Y-%m-%d %H:%M')

## Efficiency

| Metric | Combat | Magic | Super | Average |
|--------|--------|-------|-------|---------|
| **Tokens** | ${M_TOKENS[0]} | ${M_TOKENS[1]} | ${M_TOKENS[2]} | $AVG_TOKENS |
| **Tool Rounds** | ${M_ROUNDS[0]} | ${M_ROUNDS[1]} | ${M_ROUNDS[2]} | $AVG_ROUNDS |
| **Duration (s)** | ${M_DURATION[0]} | ${M_DURATION[1]} | ${M_DURATION[2]} | $AVG_DURATION |
| **Cost (USD)** | ${M_COST[0]} | ${M_COST[1]} | ${M_COST[2]} | $AVG_COST |

## Quality

| Dimension | Combat | Magic | Super |
|-----------|--------|-------|-------|
| **Math Accuracy** | ${Q_MATH[0]} | ${Q_MATH[1]} | ${Q_MATH[2]} |
| **Prerequisites** | ${Q_PREREQS[0]} | ${Q_PREREQS[1]} | ${Q_PREREQS[2]} |
| **Build Efficiency** | ${Q_EFFICIENCY[0]} | ${Q_EFFICIENCY[1]} | ${Q_EFFICIENCY[2]} |
| **Coherence** | ${Q_COHERENCE[0]} | ${Q_COHERENCE[1]} | ${Q_COHERENCE[2]} |
| **Completeness** | ${Q_COMPLETENESS[0]} | ${Q_COMPLETENESS[1]} | ${Q_COMPLETENESS[2]} |
| **Total (/25)** | ${Q_TOTAL[0]} | ${Q_TOTAL[1]} | ${Q_TOTAL[2]} |
| **Attr Eff Miss** | ${Q_ATTR_MISS[0]} | ${Q_ATTR_MISS[1]} | ${Q_ATTR_MISS[2]} |

### Quality Notes

REPORT_EOF

for i in "${!TYPES[@]}"; do
  TYPE="${TYPES[$i]}"
  NOTE="${Q_NOTES[$i]:-No notes.}"
  TYPE_CAP="$(echo "$TYPE" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')"
  echo "**${TYPE_CAP}:** $NOTE" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
done

cat >> "$REPORT_FILE" << SUMMARY_EOF
## Summary

- **Avg Tokens:** $AVG_TOKENS
- **Avg Tool Rounds:** $AVG_ROUNDS
- **Avg Duration:** ${AVG_DURATION}s
- **Avg Cost:** \$${AVG_COST}
- **Avg Quality (/25):** $AVG_QUALITY
SUMMARY_EOF

if [[ -n "$REVIEW_RAW" ]]; then
  cat >> "$REPORT_FILE" << REVIEW_BLOCK_EOF

## Raw Review Output

\`\`\`
$REVIEW_RAW
\`\`\`
REVIEW_BLOCK_EOF
fi

# ── Done ─────────────────────────────────────────────────

echo "" >&2
echo "═══════════════════════════════════════════════" >&2
echo " Report written: $REPORT_FILE" >&2
echo "═══════════════════════════════════════════════" >&2

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo " ⚠ Failed characters: ${FAILED[*]}" >&2
fi

echo "$REPORT_FILE"
