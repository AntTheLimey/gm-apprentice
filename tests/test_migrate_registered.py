"""The migration steps that ask the GM for something are registered, with the
release they belong to and the answers they take. One table for all of
them; what each step does is tested in the step's own file."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import migrate_site as ms  # noqa: E402
import migrate_vault as mv  # noqa: E402

# (registry, name, the fields of the registered check that are pinned)
REGISTERED = [
    (mv.VAULT_CHECKS, "open-threads-fold", {"choices": ("open-threads-fold=",)}),
    (mv.VAULT_CHECKS, "required-ties-section",
     {"release": "1.10.65", "band": 3,
      "choices": ("required-ties-section",)}),
    (mv.VAULT_CHECKS, "tone-words",
     {"release": "1.10.44", "band": 3, "choices": ("tone-words=",)}),
    (mv.VAULT_CHECKS, "tone-list",
     {"release": "1.10.44", "band": 3, "choices": (), "asks_site": False}),
    (ms.SITE_CHECKS, "sheet-source", {"choices": ("sheet-source:=",)}),
    (ms.SITE_CHECKS, "retire-steps",
     {"release": "1.10.63", "choices": ("retire-step:=",)}),
    (ms.SITE_CHECKS, "retire-steps-2",
     {"release": "1.10.92", "choices": ("retire-step:=",)}),
]


@pytest.mark.parametrize("registry, name, fields", REGISTERED,
                         ids=[r[1] for r in REGISTERED])
def test_the_check_is_registered(registry, name, fields):
    (check,) = [c for c in registry if c.name == name]
    assert check.release is not None
    for field, want in fields.items():
        assert getattr(check, field) == want, field


def test_required_ties_runs_right_after_the_schema_mirror():
    ids = [c.name for c in mv.VAULT_CHECKS]
    assert ids.index("required-ties-section") == ids.index("schema-mirror") + 1
