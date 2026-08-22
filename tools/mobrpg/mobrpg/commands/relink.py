"""mobrpg relink — re-point a moved/renamed note's mobrpg external_ref.

When a synced note is renamed or moved, its `mobrpg: external_ref` still names
the OLD vault path, so a re-push would mint a duplicate element and orphan the
old link (the name-collision hazard). `relink` rewrites external_ref to the
note's CURRENT path while keeping element_id, and records the prior ref in
`previous_ref`. Pure vault surgery — no mobRPG call, so no token/world needed —
gated dry-run -> --execute like the other vault mutations.

    mobrpg relink --vault <path> --to <new-rel-path> [--from <old-rel-path>] [--execute]

--to  is the note's current vault-relative path (no .md). --from is an optional
guard: relink refuses if the note's current external_ref doesn't match it.
"""
from __future__ import annotations

import argparse
import os
import sys

from mobrpg import node


def relink_node(n: dict, new_ref: str) -> dict:
    """Return a copy of `n` with external_ref set to new_ref, the prior ref
    recorded in previous_ref, and element_id (and everything else) preserved."""
    out = dict(n)
    out["previous_ref"] = n.get("external_ref")
    out["external_ref"] = new_ref
    return out


def _canonical_rel(rel: str) -> str:
    """The canonical vault-relative ref path: drop a trailing .md, normalize, and
    use forward slashes — matching suggest.external_ref so a relinked ref is
    byte-identical to what a future push/suggest computes for the same file."""
    rel = rel[:-3] if rel.endswith(".md") else rel
    return os.path.normpath(rel).replace(os.sep, "/")


def _escapes_vault(rel: str) -> bool:
    norm = os.path.normpath(rel)
    return os.path.isabs(norm) or norm == ".." or norm.startswith(".." + os.sep)


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg relink",
        description="Re-point a moved/renamed note's mobrpg external_ref to its "
                    "current path (keeps element_id). Vault-only; dry-run unless --execute.")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--to", required=True,
                    help="the note's CURRENT vault-relative path (no .md)")
    ap.add_argument("--from", dest="from_", default="",
                    help="optional guard: the note's OLD vault-relative path; refuse "
                         "if it doesn't match the note's current external_ref")
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args(argv)

    if _escapes_vault(args.to[:-3] if args.to.endswith(".md") else args.to):
        print(f"ERROR: --to {args.to!r} escapes the vault.", file=sys.stderr)
        return 1
    to_rel = _canonical_rel(args.to)
    path = os.path.join(os.path.expanduser(args.vault), to_rel + ".md")
    if not os.path.exists(path):
        print(f"ERROR: no note at {path}", file=sys.stderr)
        return 1
    txt = open(path, encoding="utf-8").read()
    n = node.read_node(txt)
    if not n or not n.get("external_ref"):
        print(f"ERROR: {path} has no mobrpg: node with an external_ref to relink.",
              file=sys.stderr)
        return 1

    old_ref = n["external_ref"]
    ns = old_ref.split(":", 1)[0] if ":" in old_ref else ""
    if not ns:
        print(f"ERROR: external_ref {old_ref!r} has no namespace prefix.", file=sys.stderr)
        return 1
    new_ref = f"{ns}:{to_rel}"

    if args.from_:
        expected = f"{ns}:{_canonical_rel(args.from_)}"
        if old_ref != expected:
            print(f"ERROR: --from mismatch. Note's current external_ref is {old_ref!r}, "
                  f"not {expected!r}. Refusing to relink.", file=sys.stderr)
            return 2

    if new_ref == old_ref:
        print(f"already linked: {old_ref}  (nothing to do)")
        return 0

    print(f"relink {path}")
    print(f"  external_ref: {old_ref}")
    print(f"             -> {new_ref}")
    print(f"  element_id preserved: {n.get('element_id')!r}")
    if not args.execute:
        print("  [dry-run — no files changed; re-run with --execute to apply]")
        return 0
    merged = node.write_node(txt, relink_node(n, new_ref))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(merged)
    print("  ✓ relinked")
    return 0
