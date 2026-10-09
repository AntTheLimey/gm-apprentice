"""gurps_calc.py against the cases the publish tool's copy also runs."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
import gurps_calc as gc  # noqa: E402

DATA = json.loads((ROOT / "tests" / "shared-cases" / "gurps-calc.json").read_text(encoding="utf-8"))
SHARED = ("halve_up", "is_reeling", "is_tired", "basic_lift", "enc_max_weights",
          "enc_move", "enc_dodge", "parry", "block")


def test_the_case_file_holds_five_or_more_cases_for_exactly_the_listed_formulas():
    assert sorted(DATA["cases"]) == sorted(SHARED)
    assert all(len(v) >= 5 for v in DATA["cases"].values())


@pytest.mark.parametrize("name", SHARED)
def test_formula(name):
    for args, want in DATA["cases"][name]:
        got = getattr(gc, name)(*args)
        got = json.loads(json.dumps(got))
        assert got == want, f"{name}{tuple(args)}"


def test_constants():
    assert [list(x) for x in gc.ENC_LEVELS] == DATA["constants"]["ENC_LEVELS"]
    assert list(gc.ENC_PENALIZED_SKILLS) == DATA["constants"]["ENC_PENALIZED_SKILLS"]
