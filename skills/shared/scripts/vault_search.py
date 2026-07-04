#!/usr/bin/env python3
"""Ranked vault search (index-free BM25). Stdlib only.

For exact-term lookups plain Grep is cheaper — use this when the query
is prose ("fallout from the duel subplot") and relevance ranking
matters. Scores every markdown note per query; no index, no staleness.

Usage:
  vault_search.py VAULT "query terms" [--limit N] [--context]

Output: `# matched: N` header, then one result per line:
  score<TAB>vault/relative/path.md
With --context, the best-matching line follows each result, indented.
"""

import argparse
import math
import re
import sys
from collections import Counter
from pathlib import Path

K1 = 1.5
B = 0.75
TITLE_WEIGHT = 3  # filename tokens count extra: titles signal topic

# [^\W_]+ splits on underscores too, so [[Some_Entity_Name]] mentions
# match their individual words.
TOKEN_RE = re.compile(r"[^\W_]+")


def tokens(text: str) -> list[str]:
    return [t.casefold() for t in TOKEN_RE.findall(text)]


def best_line(text: str, terms: set[str]) -> str:
    best, best_hits = "", 0
    for line in text.splitlines():
        hits = sum(1 for t in set(tokens(line)) if t in terms)
        if hits > best_hits:
            best, best_hits = line.strip(), hits
    return best[:200]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("query")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--context", action="store_true")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    terms = tokens(args.query)
    if not terms:
        print("error: empty query", file=sys.stderr)
        return 2

    docs = {}  # rel -> (Counter, length, text)
    for path in sorted(args.vault.rglob("*.md")):
        rel = path.relative_to(args.vault).as_posix()
        if any(p.startswith(".") for p in rel.split("/")):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        toks = tokens(text) + tokens(path.stem) * TITLE_WEIGHT
        docs[rel] = (Counter(toks), len(toks), text)

    if not docs:
        print("# matched: 0")
        return 0

    n = len(docs)
    avg_len = sum(length for _, length, _ in docs.values()) / n
    df = Counter()
    for tf, _, _ in docs.values():
        for t in set(terms):
            if tf[t]:
                df[t] += 1

    scores = {}
    for rel, (tf, length, _) in docs.items():
        score = 0.0
        for t in terms:
            if not tf[t]:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            norm = tf[t] * (K1 + 1) / (
                tf[t] + K1 * (1 - B + B * length / avg_len))
            score += idf * norm
        if score > 0:
            scores[rel] = score

    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    print(f"# matched: {len(ranked)}")
    term_set = set(terms)
    for rel, score in ranked[:args.limit]:
        print(f"{score:.3f}\t{rel}")
        if args.context:
            print(f"    {best_line(docs[rel][2], term_set)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
