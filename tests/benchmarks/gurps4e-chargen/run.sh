#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# GURPS 4e Character-Generation Benchmark Runner
#
# Usage:
#   ./run.sh --model opus|sonnet|haiku           # all 3 types + review
#   ./run.sh --model sonnet --type super         # just one type
#   ./run.sh --model sonnet --type combat,magic  # subset
#   ./run.sh --model sonnet --skip-review        # skip quality review
#   ./run.sh --model sonnet --review-only        # review existing output
#   ./run.sh --model sonnet --report-only        # report from existing json
# ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── CLI parsing ──────────────────────────────────────────

MODEL=""
SKIP_REVIEW=false
REVIEW_ONLY=false
REPORT_ONLY=false
TYPE_FILTER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"; shift 2 ;;
    --type)
      TYPE_FILTER="$2"; shift 2 ;;
    --skip-review)
      SKIP_REVIEW=true; shift ;;
    --review-only)
      REVIEW_ONLY=true; shift ;;
    --report-only)
      REPORT_ONLY=true; SKIP_REVIEW=true; shift ;;
    -h|--help)
      echo "Usage: $0 --model opus|sonnet|haiku [options]"
      echo ""
      echo "Options:"
      echo "  --model MODEL        Model to benchmark (required)"
      echo "  --type TYPE[,TYPE]   Character types to generate (combat,magic,super)"
      echo "  --skip-review        Skip the Opus quality review step"
      echo "  --review-only        Only run quality review on existing output"
      echo "  --report-only        Only generate report from existing json files"
      echo ""
      echo "Examples:"
      echo "  $0 --model sonnet                    # full run"
      echo "  $0 --model sonnet --type super       # just super"
      echo "  $0 --model sonnet --review-only      # review existing sheets"
      echo "  $0 --model sonnet --report-only      # report from cached json"
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run $0 --help for usage" >&2
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

# ── Determine which types to run ─────────────────────────

ALL_TYPES=(combat magic super)

if [[ -n "$TYPE_FILTER" ]]; then
  IFS=',' read -ra RUN_TYPES <<< "$TYPE_FILTER"
  # Validate each type
  for t in "${RUN_TYPES[@]}"; do
    case "$t" in
      combat|magic|super) ;;
      *) echo "Error: unknown type '$t' (must be combat, magic, or super)" >&2; exit 1 ;;
    esac
  done
else
  RUN_TYPES=("${ALL_TYPES[@]}")
fi

# ── Helper: check if a type is in the run list ───────────

type_in_run_list() {
  local target="$1"
  for t in "${RUN_TYPES[@]}"; do
    [[ "$t" == "$target" ]] && return 0
  done
  return 1
}

# ── Helper: extract metrics from a JSON file ─────────────

extract_metrics() {
  local json_file="$1"
  if [[ ! -f "$json_file" ]] || [[ ! -s "$json_file" ]]; then
    echo "0 0 0.0 0.0000"
    return
  fi
  local USAGE INPUT_T OUTPUT_T CACHE_READ CACHE_CREATE TOKENS
  local NUM_TURNS TOOL_ROUNDS DURATION_MS DURATION COST_RAW COST

  USAGE=$(jq '[.modelUsage[]][0]' "$json_file" 2>/dev/null) || USAGE="{}"
  INPUT_T=$(echo "$USAGE" | jq '.inputTokens // 0')
  OUTPUT_T=$(echo "$USAGE" | jq '.outputTokens // 0')
  CACHE_READ=$(echo "$USAGE" | jq '.cacheReadInputTokens // 0')
  CACHE_CREATE=$(echo "$USAGE" | jq '.cacheCreationInputTokens // 0')
  TOKENS=$(( INPUT_T + OUTPUT_T + CACHE_READ + CACHE_CREATE ))

  NUM_TURNS=$(jq '.num_turns // 1' "$json_file")
  TOOL_ROUNDS=$(( NUM_TURNS > 1 ? NUM_TURNS - 1 : 0 ))

  DURATION_MS=$(jq '.duration_ms // 0' "$json_file")
  DURATION=$(awk "BEGIN {printf \"%.1f\", $DURATION_MS / 1000}")

  COST_RAW=$(jq '.total_cost_usd // 0' "$json_file")
  COST=$(awk "BEGIN {printf \"%.4f\", $COST_RAW}")

  echo "$TOKENS $TOOL_ROUNDS $DURATION $COST"
}

# ── Metrics arrays (indexed by ALL_TYPES position) ───────

declare -a M_TOKENS M_ROUNDS M_DURATION M_COST
declare -a FAILED

# Initialize from existing json files (for --report-only or partial runs)
for i in "${!ALL_TYPES[@]}"; do
  TYPE="${ALL_TYPES[$i]}"
  JSON_FILE="$OUTPUT_DIR/${TYPE}-${MODEL}.json"
  if [[ -f "$JSON_FILE" ]] && [[ -s "$JSON_FILE" ]]; then
    read -r TOK RND DUR CST <<< "$(extract_metrics "$JSON_FILE")"
    M_TOKENS[$i]=$TOK; M_ROUNDS[$i]=$RND; M_DURATION[$i]="$DUR"; M_COST[$i]="$CST"
  else
    M_TOKENS[$i]=0; M_ROUNDS[$i]=0; M_DURATION[$i]="0.0"; M_COST[$i]="0.0000"
  fi
done

# ── Generate characters ──────────────────────────────────

echo "═══════════════════════════════════════════════" >&2
echo " GURPS 4e Chargen Benchmark — model: $MODEL"    >&2
echo " Types: ${RUN_TYPES[*]}"                         >&2
if [[ "$REVIEW_ONLY" == true ]]; then
  echo " Mode: review-only"                             >&2
elif [[ "$REPORT_ONLY" == true ]]; then
  echo " Mode: report-only"                             >&2
fi
echo "═══════════════════════════════════════════════" >&2

if [[ "$REVIEW_ONLY" == false ]] && [[ "$REPORT_ONLY" == false ]]; then
  for i in "${!ALL_TYPES[@]}"; do
    TYPE="${ALL_TYPES[$i]}"

    # Skip types not in the run list
    if ! type_in_run_list "$TYPE"; then
      continue
    fi

    PROMPT_FILE="$PROMPTS_DIR/${TYPE}.txt"
    if [[ ! -f "$PROMPT_FILE" ]]; then
      echo "  ✗ $TYPE — prompt file not found: $PROMPT_FILE" >&2
      FAILED+=("$TYPE")
      M_TOKENS[$i]=0; M_ROUNDS[$i]=0; M_DURATION[$i]="0.0"; M_COST[$i]="0.0000"
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
      M_TOKENS[$i]=0; M_ROUNDS[$i]=0; M_DURATION[$i]="0.0"; M_COST[$i]="0.0000"
      continue
    fi

    # Extract character sheet text
    jq -r '.result // empty' "$JSON_OUT" > "$MD_OUT"

    # Extract metrics
    read -r TOK RND DUR CST <<< "$(extract_metrics "$JSON_OUT")"
    M_TOKENS[$i]=$TOK; M_ROUNDS[$i]=$RND; M_DURATION[$i]="$DUR"; M_COST[$i]="$CST"

    echo "  ✓ $TYPE — ${TOK} tok, ${RND} rounds, ${DUR}s, \$${CST}" >&2
  done
fi

# ── Quality Review ───────────────────────────────────────

declare -a Q_MATH Q_PREREQS Q_EFFICIENCY Q_COHERENCE Q_COMPLETENESS Q_TOTAL Q_ATTR_MISS
declare -a Q_NOTES
REVIEW_RAW=""

if [[ "$SKIP_REVIEW" == true ]] && [[ "$REVIEW_ONLY" == false ]]; then
  echo "" >&2
  echo "  ⏭ Skipping quality review (--skip-review)" >&2
  for i in "${!ALL_TYPES[@]}"; do
    Q_MATH[$i]="–"; Q_PREREQS[$i]="–"; Q_EFFICIENCY[$i]="–"
    Q_COHERENCE[$i]="–"; Q_COMPLETENESS[$i]="–"; Q_TOTAL[$i]="–"
    Q_ATTR_MISS[$i]="–"; Q_NOTES[$i]=""
  done
else
  echo "" >&2
  echo "  ▶ Running quality review (Opus) …" >&2

  # Check we have required character sheets
  MISSING_SHEETS=false
  for TYPE in "${RUN_TYPES[@]}"; do
    SHEET="$OUTPUT_DIR/${TYPE}-${MODEL}.md"
    if [[ ! -f "$SHEET" ]] || [[ ! -s "$SHEET" ]]; then
      echo "  ⚠ Missing sheet: $SHEET" >&2
      MISSING_SHEETS=true
    fi
  done

  if [[ "$MISSING_SHEETS" == true ]]; then
    echo "  ⚠ Review will proceed but missing sheets will score 0" >&2
  fi

  # Build review input file: review-prompt + rubric + all 3 sheets
  REVIEW_TMP="$OUTPUT_DIR/.review-input-${MODEL}.txt"
  cat "$SCRIPT_DIR/review-prompt.txt" > "$REVIEW_TMP"
  echo "" >> "$REVIEW_TMP"
  cat "$SCRIPT_DIR/rubric.md" >> "$REVIEW_TMP"
  echo "" >> "$REVIEW_TMP"
  echo "--- CHARACTER SHEETS ---" >> "$REVIEW_TMP"

  for TYPE in "${RUN_TYPES[@]}"; do
    SHEET="$OUTPUT_DIR/${TYPE}-${MODEL}.md"
    TYPE_UPPER="$(echo "$TYPE" | tr '[:lower:]' '[:upper:]')"
    echo "" >> "$REVIEW_TMP"
    echo "=== ${TYPE_UPPER} ===" >> "$REVIEW_TMP"
    echo "" >> "$REVIEW_TMP"
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
    for i in "${!ALL_TYPES[@]}"; do
      Q_MATH[$i]="–"; Q_PREREQS[$i]="–"; Q_EFFICIENCY[$i]="–"
      Q_COHERENCE[$i]="–"; Q_COMPLETENESS[$i]="–"; Q_TOTAL[$i]="–"
      Q_ATTR_MISS[$i]="–"; Q_NOTES[$i]=""
    done
  else
    REVIEW_RAW="$(jq -r '.result // empty' "$REVIEW_JSON")"

    # Build mapping: review block index → ALL_TYPES index
    declare -a REVIEW_MAP
    for _ri in "${!RUN_TYPES[@]}"; do
      for _ai in "${!ALL_TYPES[@]}"; do
        if [[ "${RUN_TYPES[$_ri]}" == "${ALL_TYPES[$_ai]}" ]]; then
          REVIEW_MAP[$_ri]=$_ai
          break
        fi
      done
    done

    # Parse JSON blocks separated by --- lines
    BLOCK_INDEX=0
    CURRENT_BLOCK=""

    parse_block() {
      local block="$1"
      local idx="$2"
      if echo "$block" | jq empty 2>/dev/null; then
        Q_MATH[$idx]="$(echo "$block" | jq -r '.scores.math // "–"')"
        Q_PREREQS[$idx]="$(echo "$block" | jq -r '.scores.prereqs // "–"')"
        Q_EFFICIENCY[$idx]="$(echo "$block" | jq -r '.scores.efficiency // "–"')"
        Q_COHERENCE[$idx]="$(echo "$block" | jq -r '.scores.coherence // "–"')"
        Q_COMPLETENESS[$idx]="$(echo "$block" | jq -r '.scores.completeness // "–"')"
        Q_TOTAL[$idx]="$(echo "$block" | jq -r '.scores.total // "–"')"
        Q_ATTR_MISS[$idx]="$(echo "$block" | jq -r '.attr_eff_miss // "–"')"
        Q_NOTES[$idx]="$(echo "$block" | jq -r '.notes // ""')"
      fi
    }

    while IFS= read -r line; do
      TRIMMED="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [[ "$TRIMMED" == "---" ]]; then
        if [[ -n "$CURRENT_BLOCK" ]]; then
          parse_block "$CURRENT_BLOCK" "${REVIEW_MAP[$BLOCK_INDEX]}"
          BLOCK_INDEX=$(( BLOCK_INDEX + 1 ))
          CURRENT_BLOCK=""
        fi
        continue
      fi
      if [[ "$TRIMMED" == "{"* ]] || [[ -n "$CURRENT_BLOCK" ]]; then
        CURRENT_BLOCK+="$line"
      fi
    done <<< "$REVIEW_RAW"

    # Process last block (no trailing ---)
    if [[ -n "$CURRENT_BLOCK" ]] && [[ $BLOCK_INDEX -lt ${#RUN_TYPES[@]} ]]; then
      parse_block "$CURRENT_BLOCK" "${REVIEW_MAP[$BLOCK_INDEX]}"
    fi

    # Fill missing blocks
    for i in "${!ALL_TYPES[@]}"; do
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

# Count non-zero entries for averaging
NON_ZERO=0
TOK_SUM=0; RND_SUM=0; DUR_SUM=0; CST_SUM=0
for i in "${!ALL_TYPES[@]}"; do
  if [[ "${M_TOKENS[$i]}" -gt 0 ]]; then
    NON_ZERO=$((NON_ZERO + 1))
    TOK_SUM=$((TOK_SUM + M_TOKENS[$i]))
    RND_SUM=$((RND_SUM + M_ROUNDS[$i]))
    DUR_SUM=$(awk "BEGIN {printf \"%.1f\", $DUR_SUM + ${M_DURATION[$i]}}")
    CST_SUM=$(awk "BEGIN {printf \"%.4f\", $CST_SUM + ${M_COST[$i]}}")
  fi
done

if [[ $NON_ZERO -gt 0 ]]; then
  AVG_TOKENS=$(awk "BEGIN {printf \"%.0f\", $TOK_SUM / $NON_ZERO}")
  AVG_ROUNDS=$(awk "BEGIN {printf \"%.1f\", $RND_SUM / $NON_ZERO}")
  AVG_DURATION=$(awk "BEGIN {printf \"%.1f\", $DUR_SUM / $NON_ZERO}")
  AVG_COST=$(awk "BEGIN {printf \"%.4f\", $CST_SUM / $NON_ZERO}")
else
  AVG_TOKENS=0; AVG_ROUNDS="0.0"; AVG_DURATION="0.0"; AVG_COST="0.0000"
fi

# Average quality (only if all 3 are numeric)
AVG_QUALITY="–"
_q_sum=0; _q_count=0
for _qi in "${!ALL_TYPES[@]}"; do
  if [[ "${Q_TOTAL[$_qi]:-–}" != "–" ]]; then
    _q_sum=$(awk "BEGIN {printf \"%.1f\", $_q_sum + ${Q_TOTAL[$_qi]}}")
    _q_count=$((_q_count + 1))
  fi
done
if [[ $_q_count -gt 0 ]]; then
  AVG_QUALITY=$(awk "BEGIN {printf \"%.1f\", $_q_sum / $_q_count}")
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
**Types run:** ${RUN_TYPES[*]}

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
| **Math Accuracy** | ${Q_MATH[0]:-–} | ${Q_MATH[1]:-–} | ${Q_MATH[2]:-–} |
| **Prerequisites** | ${Q_PREREQS[0]:-–} | ${Q_PREREQS[1]:-–} | ${Q_PREREQS[2]:-–} |
| **Build Efficiency** | ${Q_EFFICIENCY[0]:-–} | ${Q_EFFICIENCY[1]:-–} | ${Q_EFFICIENCY[2]:-–} |
| **Coherence** | ${Q_COHERENCE[0]:-–} | ${Q_COHERENCE[1]:-–} | ${Q_COHERENCE[2]:-–} |
| **Completeness** | ${Q_COMPLETENESS[0]:-–} | ${Q_COMPLETENESS[1]:-–} | ${Q_COMPLETENESS[2]:-–} |
| **Total (/25)** | ${Q_TOTAL[0]:-–} | ${Q_TOTAL[1]:-–} | ${Q_TOTAL[2]:-–} |
| **Attr Eff Miss** | ${Q_ATTR_MISS[0]:-–} | ${Q_ATTR_MISS[1]:-–} | ${Q_ATTR_MISS[2]:-–} |

### Quality Notes

REPORT_EOF

for i in "${!ALL_TYPES[@]}"; do
  TYPE="${ALL_TYPES[$i]}"
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
