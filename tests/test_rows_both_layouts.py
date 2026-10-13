"""The scripts' rows are the same on a vault on the old settings file and on
the same vault after the move, apart from the settings file's name and the
setting names a message quotes. A setting name mistyped inside one of these
scripts reads the default on one layout or the other and fails here."""

import contextlib
import io
import re
import shutil
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dnd_ddb  # noqa: E402
import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
import tones  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib  # noqa: E402
from layouts import move_to_new_layout  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CASES = {
    "leak": FIXTURES / "slice-a" / "leak",
    "wrapup": FIXTURES / "slice-a" / "wrapup",
    "index": FIXTURES / "slice-b" / "index",
}


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def site_vault(tmp_path: Path, fixture: Path, name: str) -> Path:
    """A copy of `fixture` with a site of its own that names the vault."""
    vault = tmp_path / name / "vault"
    shutil.copytree(fixture, vault)
    site_fixture.give_site(vault, lambda p: None, private=True)
    site_fixture.point_site_at(vault)
    return vault


def normaliser(old_vault: Path):
    """A function turning the old-layout run's text into the new layout's
    words: the old file's name and each old setting name, as the tool says
    them (never a table here)."""
    written = vaultlib.settings(old_vault).names
    pairs = sorted(((old, new) for new, old in written.items() if old != new),
                   key=lambda p: -len(p[0]))

    def norm(text: str) -> str:
        text = text.replace("_meta/vault-config.md", "_meta/vault-config.yaml")
        for old, new in pairs:
            text = re.sub(rf"(?<![\w.]){re.escape(old)}(?![\w])", new, text)
        # The vault's own folder paths differ between the two copies.
        return text

    return norm


def run_all(vault: Path, root: Path) -> dict[str, object]:
    """Every script's rows for one vault, with the vault's path made
    relative so two copies compare."""
    def rel(rows):
        return [str(r).replace(str(vault), "<vault>").replace(str(root), "<root>")
                for r in rows]

    out: dict[str, object] = {}
    out["gm-leak"] = rel(vc.check_gm_leak(vault, None, fix=False))
    out["renest"] = rel(vc.check_gm_leak(vault, None, fix=False,
                                         renest_excludes=True))
    out["pc-body"] = rel(vc.check_pc_body(vault))
    out["site-faults"] = rel(vc.check_site_faults(vault))
    out["wrapup"] = rel(vc.check_wrapup(vault, None, False))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = tones.main([str(vault)])
    out["tones"] = [code, rel(buf.getvalue().splitlines())]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = dnd_ddb.main(["--party", str(vault), "--on-build"])
    out["ddb-party"] = [code, rel(buf.getvalue().splitlines())]
    finders = {}
    for name in ("find_gm_leak", "find_publish_site", "find_default_mode",
                 "find_fonts", "find_exclude_lists", "find_postbuild",
                 "find_tone_shown", "find_sheet_source", "find_unparseable",
                 "find_session_recaps"):
        try:
            items = getattr(ms, name)(vault)
            finders[name] = [(i.id, i.group, rel(i.lines)) for i in items]
        except Exception as e:   # a finder that stops is a row too
            finders[name] = ["stopped", rel([str(e)])]
    out["finders"] = finders
    return out


SKIPPED = re.compile(r"(\d+) notes skipped: the site does not publish them")


def _rows(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _rows(v)
    elif isinstance(value, list):
        for v in value:
            yield from _rows(v)


def skipped(value) -> int:
    """The count the `notes skipped` row gives (the same row in every
    check that prints it)."""
    found = {int(m.group(1)) for r in _rows(value) if (m := SKIPPED.search(r))}
    assert len(found) <= 1, found
    return found.pop() if found else 0


def unskipped(value):
    """The value without the `notes skipped` rows."""
    if isinstance(value, dict):
        return {k: unskipped(v) for k, v in value.items()}
    if isinstance(value, list):
        return [unskipped(v) for v in value
                if not (isinstance(v, str) and SKIPPED.search(v))]
    return value


def normalised(value, norm):
    if isinstance(value, str):
        return norm(value)
    if isinstance(value, dict):
        return {k: normalised(v, norm) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalised(v, norm) for v in value]
    return value


@pytest.mark.parametrize("case", sorted(CASES))
def test_the_rows_are_the_same_before_and_after_the_move(tmp_path, case):
    old = site_vault(tmp_path, CASES[case], "old")
    new = site_vault(tmp_path, CASES[case], "new")
    move_to_new_layout(new)
    assert vaultlib.vault_layout(old) == "legacy"
    assert vaultlib.vault_layout(new) == "new"
    norm = normaliser(old)
    before = normalised(run_all(old, tmp_path / "old"), norm)
    vaultlib.forget_settings(None)
    after = normalised(run_all(new, tmp_path / "new"), lambda t: t)
    assert unskipped(before) == unskipped(after)
    # The one honest difference: where the site folder does not hide `_meta`,
    # the old settings file is itself a note the site does not publish, so it
    # is one more of the skipped.
    assert skipped(before) - skipped(after) in (0, 1)


def test_the_comparison_notices_a_setting_read_under_a_wrong_name(tmp_path):
    """The proof the test above can fail: a script reading a mistyped name
    would give different rows, so it is the rows that are compared."""
    old = site_vault(tmp_path, CASES["leak"], "old")
    rows = run_all(old, tmp_path / "old")
    assert rows["gm-leak"], "the leak fixture has rows to compare"
