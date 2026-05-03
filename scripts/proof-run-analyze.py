#!/usr/bin/env python3
"""
Analyze proof-of-improvement runs and generate statistical reports.

Reads response files from proof-run directories, computes median/IQR
across multiple runs, and generates comparison reports with
Cheaper/Faster/Better scorecards.

Usage:
    python3 scripts/proof-run-analyze.py <phase-dir> [--baseline <baseline-dir>]

Examples:
    python3 scripts/proof-run-analyze.py tests/proof-runs/phase-1
    python3 scripts/proof-run-analyze.py tests/proof-runs/phase-1 \\
        --baseline tests/proof-runs/phase-0-baseline

Directory structures supported:
    Multi-run (5-run protocol):
        phase-1/run-1/query-01-response.md ... run-5/query-12-response.md
        phase-1/run-1/metrics.json ... run-5/metrics.json

    Single-run (backward compat):
        phase-0-baseline/query-01-response.md ... query-12-response.md
"""

import argparse
import json
import re
import sys
from pathlib import Path
from statistics import median, quantiles


SYSTEMS = {
    "coc-7e": "CoC 7e",
    "coc-regency": "CoC Regency",
    "gurps-4e": "GURPS 4e",
    "dnd-5e-2024": "D&D 5e 2024",
    "fitd": "FitD",
    "generic": "Generic",
    "cross-system": "Cross-system",
    "workflow": "Workflow",
}

_metrics_cache: dict[str, dict] = {}


def parse_frontmatter(filepath: Path) -> dict:
    """Extract YAML-ish frontmatter values from a response file."""
    text = filepath.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not match:
        return {}

    fm = {}
    for line in match.group(1).splitlines():
        for key in ("query", "system", "type", "total_tokens", "wall_clock_ms"):
            m = re.match(rf'^{key}:\s*"?([^"]*)"?\s*$', line)
            if m:
                val = m.group(1).strip()
                if key in ("total_tokens", "wall_clock_ms"):
                    val = val.replace(",", "")
                    try:
                        val = int(val)
                    except ValueError:
                        print(
                            f"  WARN: {filepath.name}: "
                            f"{key}={m.group(1)!r} is not numeric",
                            file=sys.stderr,
                        )
                        val = 0
                fm[key] = val
    return fm


def load_metrics_json(run_dir: Path) -> dict:
    """Load metrics.json from a run directory (cached)."""
    key = str(run_dir)
    if key not in _metrics_cache:
        p = run_dir / "metrics.json"
        if p.exists():
            _metrics_cache[key] = json.loads(p.read_text(encoding="utf-8"))
        else:
            _metrics_cache[key] = {}
    return _metrics_cache[key]


def get_query_metrics(run_dir: Path, query_id: int) -> dict:
    """Get metrics for a query from metrics.json or frontmatter."""
    metrics_data = load_metrics_json(run_dir)
    key = f"query-{query_id:02d}"

    if key in metrics_data:
        return metrics_data[key]

    response_file = run_dir / f"{key}-response.md"
    if response_file.exists():
        fm = parse_frontmatter(response_file)
        return {
            "total_tokens": fm.get("total_tokens", 0),
            "wall_clock_ms": fm.get("wall_clock_ms", 0),
        }

    return {"total_tokens": 0, "wall_clock_ms": 0}


def discover_runs(phase_dir: str | Path) -> list[Path]:
    """Find run directories or detect single-run layout."""
    phase = Path(phase_dir)
    run_dirs = sorted(d for d in phase.glob("run-*") if d.is_dir())
    if run_dirs:
        return run_dirs

    if (phase / "query-01-response.md").exists():
        return [phase]

    return []


def load_queries() -> list[dict]:
    """Load query definitions from proof-run-queries.json."""
    p = Path(__file__).parent / "proof-run-queries.json"
    queries = json.loads(p.read_text(encoding="utf-8"))
    return queries


def build_system_queries(queries: list[dict]) -> dict[str, list[int]]:
    """Derive system-to-query-id mapping from query definitions."""
    mapping: dict[str, list[int]] = {}
    for q in queries:
        mapping.setdefault(q["system"], []).append(q["id"])
    return mapping


def compute_iqr(values: list[int | float]) -> tuple[float, float, float]:
    """Compute Q1, median, Q3 for a list of values."""
    if not values:
        return 0, 0, 0
    med = median(values)
    if len(values) < 2:
        return values[0], med, values[0]
    if len(values) < 4:
        return min(values), med, max(values)
    q1, _, q3 = quantiles(values, n=4)
    return q1, med, q3


def delta_pct(baseline: float, test: float) -> float:
    """Compute percentage change."""
    if baseline == 0:
        return 0.0
    return ((test - baseline) / baseline) * 100


def format_delta(pct: float) -> str:
    """Format a delta percentage with sign."""
    if pct > 0:
        return f"+{pct:.1f}%"
    return f"{pct:.1f}%"


def generate_summary(
    phase_dir: str, runs: list[Path], queries: list[dict]
) -> None:
    """Generate summary.md with per-query stats across runs."""
    phase = Path(phase_dir)
    n_runs = len(runs)
    query_count = len(queries)
    system_queries = build_system_queries(queries)

    lines = [
        f"# Proof Run Summary — {phase.name}\n",
        f"**Runs:** {n_runs}",
        f"**Queries per run:** {query_count}\n",
    ]

    lines.append("## Per-Query Statistics\n")
    if n_runs > 1:
        lines.append(
            "| # | System | Type | Median Tokens | IQR Tokens | "
            "Median Time (s) | IQR Time (s) |"
        )
        lines.append(
            "|---|--------|------|--------------|------------|"
            "----------------|-------------|"
        )
    else:
        lines.append(
            "| # | System | Type | Total Tokens | Wall-clock (s) |"
        )
        lines.append("|---|--------|------|-------------|----------------|")

    for q in queries:
        qid = q["id"]
        token_vals = []
        time_vals = []
        for run_dir in runs:
            m = get_query_metrics(run_dir, qid)
            if m["total_tokens"] > 0:
                token_vals.append(m["total_tokens"])
            if m["wall_clock_ms"] > 0:
                time_vals.append(m["wall_clock_ms"])

        sys_name = SYSTEMS.get(q["system"], q["system"])

        if n_runs > 1 and token_vals:
            tq1, tmed, tq3 = compute_iqr(token_vals)
            wq1, wmed, wq3 = (
                compute_iqr(time_vals) if time_vals else (0, 0, 0)
            )
            lines.append(
                f"| {qid} | {sys_name} | {q['type']} | "
                f"{tmed:,.0f} | {tq1:,.0f}–{tq3:,.0f} | "
                f"{wmed / 1000:.1f} | {wq1 / 1000:.1f}–{wq3 / 1000:.1f} |"
            )
        elif token_vals:
            t = token_vals[0]
            w = time_vals[0] if time_vals else 0
            lines.append(
                f"| {qid} | {sys_name} | {q['type']} | "
                f"{t:,} | {w / 1000:.1f} |"
            )

    lines.append("\n## Per-System Averages\n")
    if n_runs > 1:
        lines.append(
            "| System | Median Tokens (avg) | Token IQR (Q1–Q3) |"
        )
        lines.append("|--------|--------------------|--------------------|")
    else:
        lines.append("| System | Avg Tokens |")
        lines.append("|--------|------------|")

    for sys_key, sys_name in SYSTEMS.items():
        qids = system_queries.get(sys_key, [])
        query_medians = []
        query_q1s = []
        query_q3s = []
        for qid in qids:
            vals = []
            for run_dir in runs:
                m = get_query_metrics(run_dir, qid)
                if m["total_tokens"] > 0:
                    vals.append(m["total_tokens"])
            if vals:
                q1, med, q3 = compute_iqr(vals)
                query_medians.append(med)
                query_q1s.append(q1)
                query_q3s.append(q3)

        if not query_medians:
            continue

        avg_med = sum(query_medians) / len(query_medians)
        n_q = len(qids)
        label = f"{sys_name} ({n_q} {'query' if n_q == 1 else 'queries'})"
        if n_runs > 1:
            avg_q1 = sum(query_q1s) / len(query_q1s)
            avg_q3 = sum(query_q3s) / len(query_q3s)
            lines.append(
                f"| {label} | {avg_med:,.0f} | "
                f"{avg_q1:,.0f}–{avg_q3:,.0f} |"
            )
        else:
            lines.append(f"| {label} | {avg_med:,.0f} |")

    all_medians = []
    for q in queries:
        vals = []
        for run_dir in runs:
            m = get_query_metrics(run_dir, q["id"])
            if m["total_tokens"] > 0:
                vals.append(m["total_tokens"])
        if vals:
            all_medians.append(median(vals))

    lines.append(f"\n## Totals\n")
    lines.append(
        f"- **Total tokens (sum of medians):** {sum(all_medians):,.0f}"
    )
    lines.append(f"- **Runs:** {n_runs}")
    lines.append("")

    out = phase / "summary.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Wrote {out}")


def pick_median_run(
    runs: list[Path], queries: list[dict]
) -> Path:
    """Select the run closest to median total tokens."""
    run_totals = []
    for rd in runs:
        total = sum(
            get_query_metrics(rd, q["id"])["total_tokens"] for q in queries
        )
        run_totals.append((total, rd))
    run_totals.sort(key=lambda x: x[0])
    return run_totals[len(run_totals) // 2][1]


def generate_comparison(
    phase_dir: str,
    baseline_dir: str,
    runs: list[Path],
    queries: list[dict],
) -> None:
    """Generate comparison.md with Cheaper/Faster/Better scorecard."""
    phase = Path(phase_dir)
    baseline = Path(baseline_dir)
    baseline_runs = discover_runs(baseline)
    if not baseline_runs:
        print(f"  ERROR: No runs found in {baseline_dir}", file=sys.stderr)
        return

    n_runs = len(runs)
    lines = [
        f"# {phase.name} vs {baseline.name} — Comparison\n",
        f"**Test runs:** {n_runs}",
        f"**Baseline runs:** {len(baseline_runs)}\n",
        "## Per-Query Scorecard\n",
        "| # | Query | Cheaper? | Faster? | "
        "Tokens (baseline → test) | Time (baseline → test) |",
        "|---|-------|----------|---------|"
        "--------------------------|------------------------|",
    ]

    system_data: dict[str, dict] = {}

    for q in queries:
        qid = q["id"]

        b_tokens = []
        b_times = []
        for rd in baseline_runs:
            m = get_query_metrics(rd, qid)
            if m["total_tokens"] > 0:
                b_tokens.append(m["total_tokens"])
            if m["wall_clock_ms"] > 0:
                b_times.append(m["wall_clock_ms"])
        b_tok = median(b_tokens) if b_tokens else 0
        b_time = median(b_times) if b_times else 0

        t_tokens = []
        t_times = []
        for rd in runs:
            m = get_query_metrics(rd, qid)
            if m["total_tokens"] > 0:
                t_tokens.append(m["total_tokens"])
            if m["wall_clock_ms"] > 0:
                t_times.append(m["wall_clock_ms"])
        t_tok = median(t_tokens) if t_tokens else 0
        t_time = median(t_times) if t_times else 0

        tok_delta = delta_pct(b_tok, t_tok)
        time_delta = delta_pct(b_time, t_time)

        # Significance: does the baseline fall outside the test IQR?
        tok_sig = True
        time_sig = True
        if len(t_tokens) >= 3:
            tq1, _, tq3 = compute_iqr(t_tokens)
            tok_sig = b_tok < tq1 or b_tok > tq3
        if len(t_times) >= 3:
            wq1, _, wq3 = compute_iqr(t_times)
            time_sig = b_time < wq1 or b_time > wq3

        cheaper = (
            "YES" if tok_delta < -2 else ("~" if abs(tok_delta) <= 2 else "no")
        )
        faster = (
            "YES"
            if time_delta < -2
            else ("~" if abs(time_delta) <= 2 else "no")
        )

        if not tok_sig and abs(tok_delta) < 10:
            cheaper = "~ (noise)"
        if not time_sig and abs(time_delta) < 10:
            faster = "~ (noise)"

        tok_str = (
            f"{b_tok:,.0f} → {t_tok:,.0f} ({format_delta(tok_delta)})"
        )
        time_str = (
            f"{b_time / 1000:.1f}s → {t_time / 1000:.1f}s "
            f"({format_delta(time_delta)})"
        )

        short_q = (
            q["query"][:45] + "…" if len(q["query"]) > 45 else q["query"]
        )
        lines.append(
            f"| {qid} | {short_q} | {cheaper} | {faster} | "
            f"{tok_str} | {time_str} |"
        )

        sk = q["system"]
        if sk not in system_data:
            system_data[sk] = {
                "b_tokens": [],
                "t_tokens": [],
                "t_token_iqrs": [],
                "b_times": [],
                "t_times": [],
                "t_time_iqrs": [],
            }
        system_data[sk]["b_tokens"].append(b_tok)
        system_data[sk]["t_tokens"].append(t_tok)
        system_data[sk]["b_times"].append(b_time)
        system_data[sk]["t_times"].append(t_time)
        if len(t_tokens) >= 3:
            tq1, _, tq3 = compute_iqr(t_tokens)
            system_data[sk]["t_token_iqrs"].append((tq1, tq3))
        if len(t_times) >= 3:
            wq1, _, wq3 = compute_iqr(t_times)
            system_data[sk]["t_time_iqrs"].append((wq1, wq3))

    lines.append("\n## System Summary\n")
    lines.append(
        "| System | Cheaper? | Faster? | Token Δ | Time Δ | Significant? |"
    )
    lines.append(
        "|--------|----------|---------|---------|--------|-------------|"
    )

    for sys_key, sys_name in SYSTEMS.items():
        if sys_key not in system_data:
            continue
        sd = system_data[sys_key]
        avg_b_tok = sum(sd["b_tokens"]) / len(sd["b_tokens"])
        avg_t_tok = sum(sd["t_tokens"]) / len(sd["t_tokens"])
        avg_b_time = sum(sd["b_times"]) / len(sd["b_times"])
        avg_t_time = sum(sd["t_times"]) / len(sd["t_times"])

        tok_d = delta_pct(avg_b_tok, avg_t_tok)
        time_d = delta_pct(avg_b_time, avg_t_time)

        cheaper = (
            "YES" if tok_d < -2 else ("~" if abs(tok_d) <= 2 else "no")
        )
        faster = (
            "YES" if time_d < -2 else ("~" if abs(time_d) <= 2 else "no")
        )

        sig_parts = []
        if sd["t_token_iqrs"]:
            tok_sig = sum(
                1
                for (q1, q3), bv in zip(
                    sd["t_token_iqrs"], sd["b_tokens"]
                )
                if bv < q1 or bv > q3
            )
            sig_parts.append(
                f"{tok_sig}/{len(sd['t_token_iqrs'])} tok"
            )
        if sd["t_time_iqrs"]:
            time_sig = sum(
                1
                for (q1, q3), bv in zip(
                    sd["t_time_iqrs"], sd["b_times"]
                )
                if bv < q1 or bv > q3
            )
            sig_parts.append(
                f"{time_sig}/{len(sd['t_time_iqrs'])} time"
            )
        sig = ", ".join(sig_parts) if sig_parts else "single run"

        lines.append(
            f"| {sys_name} | {cheaper} | {faster} | "
            f"{format_delta(tok_d)} | {format_delta(time_d)} | {sig} |"
        )

    all_b = sum(sum(sd["b_tokens"]) for sd in system_data.values())
    all_t = sum(sum(sd["t_tokens"]) for sd in system_data.values())
    overall_d = delta_pct(all_b, all_t)

    lines.append(f"\n## Overall\n")
    lines.append(f"- **Baseline total (median tokens):** {all_b:,.0f}")
    lines.append(f"- **Test total (median tokens):** {all_t:,.0f}")
    lines.append(f"- **Overall delta:** {format_delta(overall_d)}")

    if n_runs >= 5:
        lines.append("\n## Statistical Confidence\n")
        lines.append(
            "With 5 runs, the IQR (interquartile range) shows the spread "
            "of the middle 50% of results. When the baseline value falls "
            "outside the test IQR, the difference is likely real — not "
            "noise."
        )
        lines.append(
            "\nThe Significant? column shows how many queries per system "
            "have their baseline outside the test IQR. Higher counts = "
            "more confidence the change is real.\n"
        )

    lines.append("")
    out = phase / "comparison.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Wrote {out}")


def generate_quality_prompt(
    phase_dir: str,
    baseline_dir: str,
    runs: list[Path],
    queries: list[dict],
) -> None:
    """Generate a quality comparison prompt for a Sonnet agent."""
    phase = Path(phase_dir)
    baseline = Path(baseline_dir)
    baseline_runs = discover_runs(baseline)

    median_run = pick_median_run(runs, queries)
    median_run_name = (
        median_run.name if median_run.name.startswith("run-") else "single"
    )

    b_run = (
        pick_median_run(baseline_runs, queries)
        if len(baseline_runs) > 1
        else baseline_runs[0]
    )

    lines = [
        f"# Quality Comparison Prompt\n",
        f"**Test median run:** {median_run_name}",
        f"**Baseline run:** {b_run.name}\n",
        "Feed this to a Sonnet agent for quality comparison.\n",
        "---\n",
        "You are a quality checker for the gm-apprentice TTRPG plugin. "
        "Compare baseline and test responses using the plugin's own "
        "reference files as ground truth.\n",
        "For each query, read BOTH response files and the ground truth "
        "reference. Report:\n",
        "1. **Accuracy** — facts wrong vs the reference? Cite specifics.",
        "2. **Completeness** — important content missed or hallucinated?",
        "3. **Verdict** — BASELINE BETTER / TEST BETTER / EQUIVALENT\n",
        "| # | Baseline | Test | Ground truth |",
        "|---|----------|------|--------------|",
    ]

    for q in queries:
        qid = q["id"]
        b_path = b_run / f"query-{qid:02d}-response.md"
        t_path = median_run / f"query-{qid:02d}-response.md"
        gt = ", ".join(q["ground_truth"])
        lines.append(f"| {qid} | {b_path} | {t_path} | {gt} |")

    lines.append(
        f"\nWrite your report to: {phase}/quality-comparison.md\n"
    )

    out = phase / "quality-prompt.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Wrote {out}")


def main():
    parser = argparse.ArgumentParser(
        description="Analyze proof-of-improvement runs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Expected directory structure:

  Multi-run (5-run protocol):
    phase-1/run-1/query-01-response.md
    phase-1/run-1/metrics.json
    ...
    phase-1/run-5/query-12-response.md

  Single-run (backward compat):
    phase-0-baseline/query-01-response.md
    ...
    phase-0-baseline/query-12-response.md
""",
    )
    parser.add_argument("phase_dir", help="Path to phase directory")
    parser.add_argument(
        "--baseline", help="Path to baseline directory for comparison"
    )
    args = parser.parse_args()

    queries = load_queries()
    runs = discover_runs(args.phase_dir)

    if not runs:
        print(
            f"ERROR: No runs found in {args.phase_dir}", file=sys.stderr
        )
        sys.exit(1)

    print(f"Found {len(runs)} run(s) in {args.phase_dir}")

    generate_summary(args.phase_dir, runs, queries)

    if args.baseline:
        generate_comparison(
            args.phase_dir, args.baseline, runs, queries
        )
        generate_quality_prompt(
            args.phase_dir, args.baseline, runs, queries
        )


if __name__ == "__main__":
    main()
