#!/usr/bin/env python3
"""Write the generated blocks of the gma llms pages from the command tree.

    gen_gma_docs.py                write them
    gen_gma_docs.py --check        exit 1 and name each page out of date
    gen_gma_docs.py --stub NAME    print a starting page for a new command

Source: gma.full_tree() (every command's own parser). Copies: the
generated blocks in skills/shared/gma/llms.md and llms/<command>.md,
rendered by skills/shared/scripts/gma_docs.py. A missing page or block is
reported, never written in: where it goes among the prose is a person's call.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
import gma  # noqa: E402
import gma_docs  # noqa: E402


def stub(tree: argparse.ArgumentParser, name: str) -> str:
    blocks = "\n".join(f"<!-- BEGIN GENERATED: {b} -->\n{gma_docs.END}\n"
                       for b in gma_docs.expected_blocks(tree, name))
    return (f"# gma {name}\n\nWhen to use it, and what it needs: one or two "
            f"plain lines.\n\n{gma_docs.render(blocks, tree)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gen_gma_docs.py")
    ap.add_argument("--check", action="store_true",
                    help="write nothing; exit 1 if any page is out of date")
    ap.add_argument("--stub", metavar="NAME",
                    help="print a starting page for command NAME")
    ap.add_argument("--docs", type=Path, default=gma_docs.DOCS,
                    help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    tree = gma.full_tree()
    if args.stub:
        if args.stub not in gma_docs.commands(tree):
            print(f"gen_gma_docs.py: no command {args.stub}", file=sys.stderr)
            return 2
        sys.stdout.write(stub(tree, args.stub))
        return 0
    if not args.check:
        for path in gma_docs.documents(tree, args.docs):
            if path.is_file():
                doc = path.read_text(encoding="utf-8")
                new = gma_docs.render(doc, tree)
                if new != doc:
                    path.write_text(new, encoding="utf-8", newline="\n")
                    print(f"wrote {path.relative_to(args.docs).as_posix()}")
    found = gma_docs.problems(tree, args.docs)
    for line in found:
        print(f"gen_gma_docs.py: {line}", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
