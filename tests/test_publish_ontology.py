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
    for p in copy["predicates"]:
        assert set(p) == {"type", "inverse", "category", "symmetric"}, p["type"]


def _exporter():
    import importlib.util
    spec = importlib.util.spec_from_file_location("export_publish_ontology", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _source() -> dict:
    return json.loads((REPO / "skills" / "shared" /
                       "gm-apprentice-ontology.json").read_text(encoding="utf-8"))


def test_export_refuses_a_tone_family_the_site_does_not_show():
    # The site shows a tone as warm, hostile or neutral. A fourth family would be coloured
    # as nothing, so the export stops and says which family it does not know.
    mod = _exporter()
    full = _source()
    full["tones"]["ambiguous"] = ["murky"]
    try:
        mod.export(full)
    except ValueError as err:
        assert "ambiguous" in str(err)
        assert "positive" in str(err)
    else:
        raise AssertionError("export accepted a tone family the site cannot show")


def test_export_refuses_a_missing_tone_family():
    mod = _exporter()
    full = _source()
    del full["tones"]["neutral"]
    try:
        mod.export(full)
    except ValueError as err:
        assert "neutral" in str(err)
    else:
        raise AssertionError("export accepted a tone list with no neutral family")


def test_main_reports_the_refusal_and_exits_1(tmp_path, monkeypatch, capsys):
    mod = _exporter()
    full = _source()
    full["tones"]["ambiguous"] = ["murky"]
    bad = tmp_path / "ontology.json"
    bad.write_text(json.dumps(full), encoding="utf-8")
    monkeypatch.setattr(mod, "SOURCE", bad)
    assert mod.main(["--print"]) == 1
    assert "ambiguous" in capsys.readouterr().err
