#!/usr/bin/env python3
"""Regression test for the Plan `leads_to` field validation (node-based sequencing).

`leads_to` is optional on plan entities; when present it must be an array of
wiki-links to the plan node(s) this one leads to. Verifies validate_schema.py
accepts valid/absent forms and rejects malformed ones.
"""

import importlib.util
import os
import pathlib
import sys
import tempfile

SPEC = importlib.util.spec_from_file_location(
    "validate_schema",
    pathlib.Path(__file__).resolve().parent.parent / "scripts" / "validate_schema.py",
)
vs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vs)

FAILURES = []


def leads_to_errors(fragment: str) -> list[str]:
    """Validate a plan file with the given leads_to fragment; return only leads_to errors."""
    fm = "type: plan\nplan_type: scene\ncanon_status: DRAFT\nchapter: \"[[Chapter 1]]\""
    if fragment:
        fm += "\n" + fragment
    fd, name = tempfile.mkstemp(suffix=".md")
    os.close(fd)
    path = pathlib.Path(name)
    path.write_text(f"---\n{fm}\n---\n\nbody\n")
    try:
        return [e for e in vs.validate_file(path) if "leads_to" in e]
    finally:
        path.unlink(missing_ok=True)


def check(name: str, errors: list[str], want_error: bool):
    got_error = len(errors) > 0
    if got_error != want_error:
        FAILURES.append(f"{name}: expected {'an error' if want_error else 'no error'}, got {errors!r}")


check("valid array of wiki-links", leads_to_errors('leads_to:\n  - "[[Plan B]]"\n  - "[[Plan C]]"'), False)
check("single-target array", leads_to_errors('leads_to:\n  - "[[Plan B]]"'), False)
check("absent field", leads_to_errors(""), False)
check("empty array", leads_to_errors("leads_to: []"), False)
check("non-wiki-link entry rejected", leads_to_errors("leads_to:\n  - Plan B"), True)
check("scalar (non-array) rejected", leads_to_errors("leads_to: 7"), True)

if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S):", file=sys.stderr)
    for f in FAILURES:
        print(f"  {f}", file=sys.stderr)
    sys.exit(1)
print("All plan leads_to validation tests passed.")
