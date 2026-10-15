import sys
import re
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
GONE = ("parse_publish_list", "read_publish_list", "read_publish_scalar", "_publish_scalar",
        "DEFAULT_EXCLUDE_SECTIONS", "resolve_exclude_sections", "effective_exclude_sections",
        "publish_block_inline", "collapse_exclude_sections",
        "PC_INACTIVE_STATUS", "DESCRIPTOR_MAX", "RECENT_CHANGES_CAP")

def test_no_script_reads_the_settings_block_itself():
    hits = [f"{p.name}: {name}" for p in SCRIPTS.glob("*.py") for name in GONE
            if re.search(rf"\b{re.escape(name)}\b", p.read_text(encoding="utf-8"))]
    assert hits == []

def test_no_script_restates_the_built_in_hidden_sections():
    hits = [p.name for p in SCRIPTS.glob("*.py")
            if re.search(r'"GM Notes",\s*"DM Notes"', p.read_text(encoding="utf-8"))]
    assert hits == []


def test_no_script_restates_a_number_that_is_a_setting():
    stale = re.compile(r"stale.*>= 3|>= 3.*stale", re.I)
    hits = [f"{p.name}:{n}" for p in SCRIPTS.glob("*.py")
            for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
            if stale.search(line) or "default=0.85" in line]
    assert hits == []


READS = re.compile(r"read_text|read_bytes|open\(|safe_load|import yaml")


def _list_readers(texts):
    """Scripts that read the publish list file themselves, or load a YAML library."""
    return [name for name, text in texts.items()
            if re.search(r"^\s*(import|from) yaml\b", text, re.M)
            or any("publish-list" in line and READS.search(line) for line in text.splitlines())]


def test_the_list_scan_finds_what_it_looks_for():
    assert _list_readers({"a.py": 'p.read_text(vault / "_meta" / "publish-list.yaml")'}) == ["a.py"]
    assert _list_readers({"b.py": "import yaml"}) == ["b.py"]
    assert _list_readers({"c.py": 'REL = "_meta/publish-list.yaml"'}) == []


def test_no_script_reads_the_publish_list_file():
    # Python asks the tool (`manifest list --json`); it parses no YAML.
    texts = {p.name: p.read_text(encoding="utf-8") for p in SCRIPTS.glob("*.py")}
    assert _list_readers(texts) == []


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


# An old key written bare (`exclude_sections`, with no `publish.` before it). The names come
# from the tool's list. Only the ones that could not be anything else are looked for: the key
# has an underscore, and the setting's new name does not end the same way (`live_stats` is
# still the last part of `player_site.features.live_stats`, so it cannot be told apart).
# A PC note's own `sheet_skin` and `sheet_frame` fields are real and keep their names.
NOTE_FIELDS = {"sheet_skin", "sheet_frame"}
# The set-up note's own keys, which the publish set-up guide reads back.
SETUP_NOTE_KEYS = {"setup-wizard.md": {"site_dir", "site_title"}}


def _bare_old_keys():
    import vaultlib
    keys = set()
    for row in vaultlib._run_settings(["list"])["names"]:
        for old in re.findall(r"\bpublish\.([a-z_.]+)", row.get("was") or ""):
            first, last = old.split(".")[0], old.split(".")[-1]
            if "_" in first and last != row["name"].split(".")[-1]:
                keys.add(first)
            elif old == "overrides.fields":
                keys.add(old)
    return keys - NOTE_FIELDS


def _bare_old_key_mentions(name, text, keys):
    text = GENERATED.sub("", text.replace("\r\n", "\n"))
    if name == OLD_LAYOUT_SECTION[0]:
        text = OLD_LAYOUT_SECTION[1].sub("", text)
    allowed = SETUP_NOTE_KEYS.get(name, set())
    # `<site_dir>` is a placeholder for a path; `publish_exclude_fields` is a note's own field.
    return sorted(k for k in keys - allowed
                  if re.search(rf"(?<![\w.<]){re.escape(k)}(?!\w)", text))


def test_the_bare_old_keys_come_from_the_tool():
    keys = _bare_old_keys()
    assert {"exclude_sections", "exclude_fields", "exclude_dirs", "exclude_callouts", "exclude_drafts",
            "site_dir", "site_title", "attachments_dir", "pc_prose_sections", "character_sheets",
            "sheet_crest", "four_oh_four", "overrides.fields"} <= keys
    assert not keys & {"mode", "search", "footer", "system", "inbox", "theme", "landing", "images",
                       "banners", "locations", "live_stats", "sheet_skin", "sheet_frame"}
    text = "Add it to `exclude_sections`, not `publish_exclude_fields`; build in <site_dir>."
    assert _bare_old_key_mentions("any.md", text, keys) == ["exclude_sections"]


def test_no_page_names_an_old_key_bare():
    keys = _bare_old_keys()
    pages = [p for p in [*_hand_written_pages(), ROOT / "README.md"] if p.name not in RECORDS]
    hits = [f"{p.relative_to(ROOT).as_posix()}: {found}" for p in pages
            for found in _bare_old_key_mentions(p.name, p.read_text(encoding="utf-8"), keys)]
    assert hits == []


# The keys a site folder's file and its package.json used to hold. They are settings of the
# vault now; a page names the setting, never the key it came from. The record of each release
# (the changelog and the migrations page) and the format page's section on the old layout
# are where they may still be named.
SITE_FOLDER_WORDS = re.compile(r"\b(?:siteUrl|outputDir|preserveDirs|cloudflarePagesProject|prebuild|postbuild)\b")


# Sections where the old keys are the subject, by page (path from the repository root) and
# heading: the format page's account of the old layout, and the publish tool's own reference
# for the keys an older site file may still hold.
OLD_KEY_SECTIONS = {
    "docs/vault-config-format.md": OLD_LAYOUT_SECTION[1],
    "tools/publish/README.md": re.compile(r"^## vault\.config\.json reference\n.*?(?=^## |\Z)", re.M | re.S),
}
# `docs/mechanization-analysis/` is a dated analysis of the code as it stood when it was
# written; it is a record, not a page that tells anyone what to do now. The other folders under
# docs/ hold local plans and specs (gitignored).
RECORD_FOLDERS = ("docs/mechanization-analysis/", "docs/superpowers/", "docs/plans/")


def _site_folder_word_mentions(rel, text):
    text = GENERATED.sub("", text.replace("\r\n", "\n"))
    if rel in OLD_KEY_SECTIONS:
        text = OLD_KEY_SECTIONS[rel].sub("", text)
    return sorted({m.group(0) for m in SITE_FOLDER_WORDS.finditer(text)})


def _pages_that_must_not_name_site_folder_keys():
    pages = [*_hand_written_pages(), *ROOT.glob("docs/**/*.md"), ROOT / "README.md", ROOT / "ROADMAP.md",
             ROOT / "tools" / "publish" / "README.md"]
    seen = {}
    for p in pages:
        rel = p.relative_to(ROOT).as_posix()
        if p.name in RECORDS or rel.startswith(RECORD_FOLDERS) or "personal" in p.parts:
            continue
        seen[rel] = p
    return seen


def test_the_site_folder_word_scan_finds_what_it_looks_for():
    text = ("Set `siteUrl` and `postbuild`.\n<!-- settings:site -->\nwas `outputDir`\n<!-- /settings:site -->\n")
    assert _site_folder_word_mentions("any.md", text) == ["postbuild", "siteUrl"]
    page = "## The old file\n\n`prebuild`.\n\n## The state file\n\n`preserveDirs`\n"
    assert _site_folder_word_mentions("docs/vault-config-format.md", page) == ["preserveDirs"]
    readme = "## Other\n\n`prebuild`\n\n## vault.config.json reference\n\n`siteUrl`\n\n## Next\n\n`outputDir`\n"
    assert _site_folder_word_mentions("tools/publish/README.md", readme) == ["outputDir", "prebuild"]


def test_the_scan_goes_red_on_a_plain_page(tmp_path):
    page = tmp_path / "plain.md"
    page.write_text("# A page\n\nSet `cloudflarePagesProject` first.\n", encoding="utf-8")
    assert _site_folder_word_mentions("docs/plain.md", page.read_text(encoding="utf-8")) == ["cloudflarePagesProject"]


def test_the_site_folder_word_scan_covers_the_pages_it_names():
    rels = set(_pages_that_must_not_name_site_folder_keys())
    assert {"ROADMAP.md", "README.md", "tools/publish/README.md", "docs/site-settings.md"} <= rels
    assert not any(r.startswith(RECORD_FOLDERS) or r.endswith("migrations.md") for r in rels)


def test_no_page_names_a_site_folder_key_or_build_hook():
    hits = [f"{rel}: {found}" for rel, p in _pages_that_must_not_name_site_folder_keys().items()
            for found in _site_folder_word_mentions(rel, p.read_text(encoding="utf-8"))]
    assert hits == []
