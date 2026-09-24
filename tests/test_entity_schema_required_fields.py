#!/usr/bin/env python3
"""Regression test for issue #221: `shared/entity-schema.md` § Required
Fields must agree with `schema_rules.REQUIRED_FIELDS`.

The doc used to list seven fields as required for every entity type;
`schema_rules.REQUIRED_FIELDS`, which `vault_check.py frontmatter`
actually enforces, requires only `type` + `canon_status` for most types
plus per-type extras, and treats the other five as unenforced. The code
is authoritative — this test parses the doc's per-type block (the fenced
list immediately under "### Required Fields (by Entity Type)") and
asserts it matches `REQUIRED_FIELDS` exactly, so the two representations
can never drift apart again without a test failure.

Stdlib only, deliberately: the doc block is a flat `key: [a, b, c]` list
rather than real YAML precisely so no parser dependency is needed here.

Run: python3 tests/test_entity_schema_required_fields.py
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import schema_rules as sr  # noqa: E402

DOC = ROOT / "skills" / "shared" / "entity-schema.md"
HEADING = "### Required Fields (by Entity Type)"
LINE_RE = re.compile(r"^([A-Za-z][\w-]*):\s*\[([^\]]*)\]\s*$")


def doc_required_fields() -> dict[str, list[str]]:
    """Parse the fenced `type: [field, field, ...]` block that follows
    `HEADING` in entity-schema.md into a dict matching REQUIRED_FIELDS'
    shape. Raises AssertionError with a useful message if the block is
    missing or a line doesn't parse — a silently-empty result would make
    this test pass for the wrong reason."""
    text = DOC.read_text(encoding="utf-8")
    start = text.index(HEADING)
    fence_start = text.index("```yaml", start)
    fence_end = text.index("```", fence_start + len("```yaml"))
    body = text[fence_start + len("```yaml"):fence_end]

    result: dict[str, list[str]] = {}
    for lineno, line in enumerate(body.splitlines(), start=1):
        if not line.strip():
            continue
        m = LINE_RE.match(line.strip())
        if not m:
            raise AssertionError(
                f"entity-schema.md Required Fields block line {lineno} "
                f"does not parse as 'type: [field, ...]': {line!r}")
        etype, raw_fields = m.groups()
        if etype in result:
            raise AssertionError(
                f"entity-schema.md Required Fields block line {lineno} "
                f"repeats type {etype!r} — the first occurrence would be "
                f"silently overwritten")
        fields = [f.strip() for f in raw_fields.split(",") if f.strip()]
        result[etype] = fields
    return result


class RequiredFieldsDriftTest(unittest.TestCase):
    def setUp(self):
        self.doc_fields = doc_required_fields()

    def test_doc_block_is_not_empty(self):
        # A parsing regression that silently returns {} must not read as
        # "everything matches".
        self.assertTrue(self.doc_fields)

    def test_doc_matches_schema_rules_exactly(self):
        self.assertEqual(self.doc_fields, sr.REQUIRED_FIELDS)

    def test_same_set_of_types(self):
        self.assertEqual(set(self.doc_fields), set(sr.REQUIRED_FIELDS))

    def test_every_type_requires_the_type_field(self):
        for etype, fields in self.doc_fields.items():
            self.assertIn("type", fields, etype)

    def test_no_stale_seven_field_universal_list(self):
        # The bug this test exists to catch: the old doc required
        # aliases/tags/source_document/campaign/first_appearance on every
        # type, which REQUIRED_FIELDS never enforced.
        for etype, fields in self.doc_fields.items():
            for stale in ("aliases", "tags", "source_document", "campaign",
                          "first_appearance"):
                self.assertNotIn(stale, fields, (etype, stale))

    def test_recommended_fields_are_labelled_not_required(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("Recommended on every type, though not enforced",
                      text)
        self.assertNotIn("(`vault_check.py frontmatter` enforces `type` "
                         "and `canon_status`,\nplus per-type extras; "
                         "write the rest anyway.)", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
