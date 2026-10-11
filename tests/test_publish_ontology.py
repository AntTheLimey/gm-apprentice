#!/usr/bin/env python3
"""The publish tool's ontology copy is the export of the real one."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "export_publish_ontology.py"
COPY = REPO / "tools" / "publish" / "lib" / "ontology.json"


def _lf(data: bytes) -> str:
    # A Windows checkout may turn the file's LF into CRLF; the content is what counts.
    return data.decode("utf-8").replace("\r\n", "\n")


def test_copy_is_current():
    out = subprocess.run([sys.executable, str(SCRIPT), "--print"],
                         capture_output=True, check=True).stdout
    assert _lf(out) == _lf(COPY.read_bytes()), (
        "tools/publish/lib/ontology.json is stale: run "
        "python3 scripts/export_publish_ontology.py")


def test_copy_holds_every_tone_and_predicate():
    full = json.loads((REPO / "skills" / "shared" /
                       "gm-apprentice-ontology.json").read_text(encoding="utf-8"))
    copy = json.loads(COPY.read_text(encoding="utf-8"))
    assert copy["tones"] == full["tones"]
    assert [p["type"] for p in copy["predicates"]] == [p["type"] for p in full["predicates"]]
    assert set(copy["predicates"][0]) == {"type", "inverse", "category", "symmetric"}
