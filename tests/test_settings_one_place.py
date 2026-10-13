import sys
import re
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
GONE = ("parse_publish_list", "read_publish_list", "read_publish_scalar", "_publish_scalar",
        "DEFAULT_EXCLUDE_SECTIONS", "resolve_exclude_sections", "effective_exclude_sections",
        "publish_block_inline", "collapse_exclude_sections")

def test_no_script_reads_the_settings_block_itself():
    hits = [f"{p.name}: {name}" for p in SCRIPTS.glob("*.py") for name in GONE
            if re.search(rf"\b{re.escape(name)}\b", p.read_text(encoding="utf-8"))]
    assert hits == []

def test_no_script_restates_the_built_in_hidden_sections():
    hits = [p.name for p in SCRIPTS.glob("*.py")
            if re.search(r'"GM Notes",\s*"DM Notes"', p.read_text(encoding="utf-8"))]
    assert hits == []


# The generated parts of a page sit between these markers; the rest is hand-written.
GENERATED = re.compile(r"<!-- settings:(\S+) -->.*?<!-- /settings:\1 -->", re.S)
ROOT = Path(__file__).resolve().parents[1]
HIDING_LISTS = ("player_site.hide.folders", "player_site.hide.sections", "player_site.hide.fields")


def _hand_written_pages():
    pages = [*ROOT.glob("skills/**/*.md"), *ROOT.glob("docs/*.md")]
    return [p for p in pages if "personal" not in p.parts]


def _written_out(text, entries):
    """Whether the text holds every entry of the list, in order, one after the
    other (a few separator characters between): quoted, in backticks or as
    list items."""
    gap = r"[^A-Za-z0-9_]{1,12}"
    return re.search(gap.join(re.escape(e) for e in entries), text) is not None


def test_the_scan_sees_the_pages_it_is_meant_to_check():
    names = {p.name for p in _hand_written_pages()}
    assert {"setup-wizard.md", "site-settings.md", "schema-change-procedure.md"} <= names


def test_no_page_writes_out_a_default_hiding_list():
    import vaultlib
    lists = {name: vaultlib.settings_default(name) for name in HIDING_LISTS}
    for name, entries in lists.items():
        assert isinstance(entries, list) and len(entries) >= 2, name
    hits = [f"{p.relative_to(ROOT)}: {name}" for p in _hand_written_pages()
            for text in [GENERATED.sub("", p.read_text(encoding="utf-8"))]
            for name, entries in lists.items() if _written_out(text, entries)]
    assert hits == []
