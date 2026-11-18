"""The migration steps that ask the GM for something are registered, with the
release they belong to and the answers they take. One table for all of
them; what each step does is tested in the step's own file."""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import migrate  # noqa: E402
import migrate_site as ms  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

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


def _changelog_sections() -> dict[str, str]:
    text = "\n".join((REPO / p).read_text(encoding="utf-8") for p in
                     ("CHANGELOG.md", "docs/history/changelog-archive.md"))
    return {m.group(1): m.group(2) for m in re.finditer(
        r"^## \[([\d.]+)\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.M | re.S)}


@pytest.mark.parametrize("check", [c for c in migrate.CHECKS if c.release],
                         ids=lambda c: c.name)
def test_a_checks_release_is_the_one_that_ships_it(check):
    """A vault runs a check only when updating across its release, so the
    release must be the version that ships it. A PR renumbered at merge
    moves its version files; this catches a check left on the old number
    (#745: `adventure-shape` shipped in 1.12.68 marked 1.12.63, and every
    vault already past 1.12.63 skipped it). That release's CHANGELOG entry
    names the check."""
    sections = _changelog_sections()
    assert check.release in sections, (
        f"{check.name}: no CHANGELOG entry for {check.release}")
    assert f"`{check.name}`" in sections[check.release], (
        f"{check.name}: the {check.release} CHANGELOG entry doesn't name "
        f"the check; is the release the version that ships it?")
