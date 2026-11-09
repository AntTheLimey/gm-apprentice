"""The migration steps that ask the GM for something are registered, with the
release they belong to and the answers they take. One table for all of
them; what each step does is tested in the step's own file."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import migrate_site as ms  # noqa: E402

# (registry, name, the fields of the registered check that are pinned)
REGISTERED = [
    (ms.SITE_CHECKS, "hide-fields-voice",
     {"release": "1.11.2", "band": 2, "choices": ("hide-add:",)}),
]


@pytest.mark.parametrize("registry, name, fields", REGISTERED,
                         ids=[r[1] for r in REGISTERED])
def test_the_check_is_registered(registry, name, fields):
    (check,) = [c for c in registry if c.name == name]
    assert check.release is not None
    for field, want in fields.items():
        assert getattr(check, field) == want, field
