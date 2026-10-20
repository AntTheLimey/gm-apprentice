#!/usr/bin/env python3
"""Regression test for the Plan `leads_to` field validation (node-based sequencing).

`leads_to` is optional on plan entities; when present it must be an array of
wiki-links to the plan node(s) this one leads to. Verifies validate_schema.py
accepts valid/absent forms and rejects malformed ones.
"""

import importlib.util
import os
import pathlib
import tempfile

import pytest

SPEC = importlib.util.spec_from_file_location(
    "validate_schema",
    pathlib.Path(__file__).resolve().parent.parent / "scripts" / "validate_schema.py",
)
vs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vs)


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


@pytest.mark.parametrize("fragment, want_error", [
    pytest.param('leads_to:\n  - "[[Plan B]]"\n  - "[[Plan C]]"', False,
                 id="valid array of wiki-links"),
    pytest.param('leads_to:\n  - "[[Plan B]]"', False, id="single-target array"),
    pytest.param("", False, id="absent field"),
    pytest.param("leads_to: []", False, id="empty array"),
    pytest.param("leads_to:\n  - Plan B", True, id="non-wiki-link entry rejected"),
    pytest.param("leads_to: 7", True, id="scalar (non-array) rejected"),
])
def test_leads_to(fragment, want_error):
    errors = leads_to_errors(fragment)
    assert (len(errors) > 0) == want_error, errors
