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


# The old settings file and the names its settings had. A page tells the reader to ask the
# `settings` command, which knows both layouts; it never names the old file or an old name.
OLD_FILE = re.compile(r"vault-config\.md")
OLD_NAME = re.compile(r"(?<![\w-])publish\.[a-z_]+(?:\.[a-z_]+)*")
# The record of what each release changed, and the page for authors of other tools, whose
# section on the old layout is what that section is for.
RECORDS = {"migrations.md"}
OLD_LAYOUT_SECTION = ("vault-config-format.md", re.compile(r"^## The old file\n.*?(?=^## |\Z)", re.M | re.S))


def _old_layout_mentions(name, text):
    """The old file name and old setting names in a page's hand-written text."""
    text = GENERATED.sub("", text.replace("\r\n", "\n"))
    if name == OLD_LAYOUT_SECTION[0]:
        text = OLD_LAYOUT_SECTION[1].sub("", text)
    return sorted({m.group(0) for pattern in (OLD_FILE, OLD_NAME) for m in pattern.finditer(text)})


def test_the_old_layout_scan_finds_what_it_looks_for():
    text = ("Open `_meta/vault-config.md` and set `publish.exclude_sections`.\n"
            "Run gm-publish.js; the note's own `publish: false` and `player_site.publish` are fine.\n"
            "<!-- settings:site -->\nwas `publish.site`\n<!-- /settings:site -->\n")
    assert _old_layout_mentions("any.md", text) == ["publish.exclude_sections", "vault-config.md"]
    page = "## The old file\n\n`publish.mode` in `vault-config.md`.\n\n## The state file\n\n`publish.mode`\n"
    assert _old_layout_mentions(OLD_LAYOUT_SECTION[0], page) == ["publish.mode"]


def test_no_page_names_the_old_settings_file_or_an_old_setting_name():
    pages = [p for p in [*_hand_written_pages(), ROOT / "README.md"] if p.name not in RECORDS]
    hits = [f"{p.relative_to(ROOT).as_posix()}: {found}" for p in pages
            for found in _old_layout_mentions(p.name, p.read_text(encoding="utf-8"))]
    assert hits == []
