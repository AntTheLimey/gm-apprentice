"""vaultlib's frontmatter reader against the text values the publish tool's
settings writer writes (tools/publish/test/yaml-shared-cases.test.js runs the
same cases from the writer's side)."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
from vaultlib import extract_frontmatter  # noqa: E402

CASES = json.loads((ROOT / "tests" / "shared-cases" / "yaml-scalars.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["value"] for c in CASES])
def test_the_written_text_reads_back_as_the_value(case):
    fm = extract_frontmatter(f"---\ntitle: {case['written']}\n---\n")
    assert fm == {"title": case["value"]}
