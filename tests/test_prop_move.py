"""prop_move.py: a vault's own props become prop notes, the site is checked
against what is live, and the old way is retired, or the vault is put back.

Every vault and site here is made up for the test (original text, shaped
like the two layouts the move reads)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import prop_move  # noqa: E402

# --- the build_props layout (15a) ----------------------------------------------

STYLESHEET = """/* The looks.
   .gull-hand   a sailor's hand
*/
.terminal { font-family: 'VT323', monospace; }
.gull-hand { position: absolute;
  font-family: 'Gochi Hand', cursive; font-size: 3cqw; }
.wren-hand, .spare { font-family: "Nanum Pen Script", cursive; }
.wren-hand .hard { font-family: 'Not This One', cursive; }
"""

LETTER = """---
type: reference
doc_kind: handout
campaign: "Test"
prop: gull-letter.html
prop_look: hand
prop_title: "A Note from Gull"
prop_plate: "Left under the hatch"
prop_blurb: "The note that was waiting in the hold."
prop_frank: "PAID|3 CR"
prop_hand: gull-hand
prop_hand_shift: "~~~~"
prop_group: "Gull: background"
prop_breaks: ["PS"]
for_player: "Ana"
offered_to: "Ana"
---

# Handout: A Note from Gull

> A note in an old friend's hand.

## The document (in-world)

Torn from a logbook, the ink run where it got wet.

```
Ana, the pumps are fixed.
Do not trust the harbourmaster.
~~~~
PS burn this
```

---

## GM Notes

Gull wrote it the night before he left.
"""


def vault_with(tmp_path: Path, notes: dict[str, str], css: str | None = STYLESHEET) -> Path:
    vault = tmp_path / "vault"
    for rel, text in notes.items():
        p = vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
    if css is not None:
        p = vault / "Chapters" / "Chapter 1 - The Run" / "Props" / "props.css"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(css, encoding="utf-8")
    return vault


def test_build_props_note_converted() -> None:
    crlf = LETTER.replace("\n", "\r\n")
    new, hand, why = prop_move.convert_build_props_note(crlf)
    assert why is None and hand == "gull-hand"
    assert new is not None
    # Line endings kept: no bare \n left.
    assert "\n" not in new.replace("\r\n", "")
    fm = new.split("\r\n---\r\n", 1)[0].split("\r\n")[1:]
    assert fm == [
        "type: prop",
        "doc_kind: handout",
        'campaign: "Test"',
        'prop_title: "A Note from Gull"',
        'prop_plate: "Left under the hatch"',
        'prop_line: "The note that was waiting in the hold."',
        'prop_frank: "PAID"',
        'prop_frank_amount: "3 CR"',
        "prop_hand: gull",
        'prop_shift: "~~~~"',
        'prop_group: "Gull: background"',
        'prop_breaks: ["PS"]',
        'for_player: "Ana"',
        'offered_to: "Ana"',
        "prop_style: hand",
        "prop_address: props/gull-letter.html",
    ]
    # A quoted hand keeps its quotes.
    quoted, _, _ = prop_move.convert_build_props_note(
        LETTER.replace("prop_hand: gull-hand", 'prop_hand: "gull-hand"'))
    assert quoted is not None and 'prop_hand: "gull"\n' in quoted


def test_description_moves_above_the_text() -> None:
    new, _, _ = prop_move.convert_build_props_note(LETTER)
    assert new is not None
    body = new.split("\n---\n", 1)[1]
    assert "## The document (in-world)" not in body
    assert ("> A note in an old friend's hand.\n\n"
            "Torn from a logbook, the ink run where it got wet.\n\n"
            "## The Text\n\n```\nAna, the pumps are fixed.\n") in body
    # The fence's lines are exactly as they were.
    assert "Do not trust the harbourmaster.\n~~~~\nPS burn this\n```\n" in body


def test_rule_after_fence_dropped() -> None:
    new, _, _ = prop_move.convert_build_props_note(LETTER)
    assert new is not None
    assert new.endswith("PS burn this\n```\n\n## GM Notes\n\n"
                        "Gull wrote it the night before he left.\n")
    # A rule that is not right after the fence stays.
    later = LETTER.replace("```\n\n---\n\n## GM Notes", "```\n\nSome words.\n\n---\n\n## GM Notes")
    kept, _, _ = prop_move.convert_build_props_note(later)
    assert kept is not None and "```\n\nSome words.\n\n---\n\n## GM Notes" in kept


def test_hands_read_from_stylesheet(tmp_path: Path) -> None:
    wren = LETTER.replace("gull-letter.html", "wren-card.html").replace("gull-hand", "wren-hand")
    vault = vault_with(tmp_path, {"Documents/Gull.md": LETTER, "Documents/Wren.md": wren})
    c = prop_move.convert(vault)
    assert sorted(c.build_props) == ["Documents/Gull.md", "Documents/Wren.md"]
    hands = json.loads(c.batch.texts["_meta/prop-hands.json"])
    assert hands == {"hands": {"gull": {"font": "Gochi Hand", "who": ""},
                               "wren": {"font": "Nanum Pen Script", "who": ""}}}
    assert not [r for r in c.rows if r.startswith(prop_move.PERSON)]
    # Nothing is written: the conversion is held in memory.
    assert not (vault / "_meta" / "prop-hands.json").exists()
    assert (vault / "Documents" / "Gull.md").read_text(encoding="utf-8") == LETTER


def test_unreadable_hand_needs_a_person(tmp_path: Path) -> None:
    ghost = LETTER.replace("gull-hand", "ghost-hand")
    odd = LETTER.replace("gull-letter.html", "odd.html").replace("gull-hand", "Odd_One-hand")
    # An envelope with no hand of its own was written in a hand build_props chose.
    mail = (LETTER.replace("gull-letter.html", "mail.html").replace("prop_look: hand", "prop_look: terminal")
            .replace("prop_hand: gull-hand\n", "prop_envelope: ANA\n"))
    vault = vault_with(tmp_path, {"Documents/Ghost.md": ghost, "Documents/Odd.md": odd, "Documents/Mail.md": mail})
    c = prop_move.convert(vault)
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert any("Documents/Ghost.md" in r and "hand ghost" in r and "font-family" in r for r in person)
    assert any("Documents/Odd.md" in r and "Odd_One-hand" in r for r in person)
    assert any(r.startswith(f"{prop_move.PERSON}\tDocuments/Mail.md\t") and "envelope" in r for r in person)
    # No hand is registered, but every note still converts.
    assert "_meta/prop-hands.json" not in c.batch.texts
    assert sorted(c.build_props) == ["Documents/Ghost.md", "Documents/Mail.md", "Documents/Odd.md"]


# --- hand-made pages and kept folders (15b) -------------------------------------

import shutil  # noqa: E402
import subprocess  # noqa: E402
from unittest import mock  # noqa: E402

TOOL = ROOT / "tools" / "publish"
CH4 = "Chapters/Chapter 4 - Port/Props"
CH3 = "Chapters/Chapter 3 - Hill/Props"
NOTES = "Chapters/Chapter 4 - Port/Props/Gazetteer"


def page(title: str, ribbon: str, sheet: str, credits: str, css: str = "props.css") -> str:
    return (f"<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            f"<title>{title}</title>\n<link rel=\"stylesheet\" href=\"{css}\">\n</head>\n<body>\n"
            f"<nav class=\"ribbon\">\n{ribbon}</nav>\n<div class=\"sheet\">\n{sheet}</div>\n"
            f"<p class=\"credits\">{credits}</p>\n</body>\n</html>\n")


KEEPER_RIBBON = ('  <a href="index.html">&larr; Keeper shelf</a>\n'
                 '  <span class="plate">KEEPER ONLY &middot; {what}</span>\n')
LIVE_RIBBON = ('  <a href="index.html">&larr; The Papers</a>\n'
               '  <span class="plate">{what}</span>\n'
               '  <a href="../index.html">The Gazetteer</a>\n')
MENU_SHEET = "<h1>Bill of Fare</h1>\n<p>Pepper water, then a roast of kid.</p>\n<p>Mangoes in syrup.</p>\n"
QUAY_SHEET = "<h1>Notice</h1>\n<p>A barge was found adrift below the quay.</p>\n"
HILL_SHEET = "<h1>From the Hill</h1>\n<p>The bells rang twice at dusk.</p>\n"
SEALED_SHEET = "<h1>Private</h1>\n<p>The Keeper alone knows who wrote this.</p>\n"

VAULT_PAGE = {
    f"{CH4}/dinner-menu.html": page("The Bill of Fare", KEEPER_RIBBON.format(what="the Collector's dinner"),
                                    MENU_SHEET, "Made for the table."),
    f"{CH4}/quay-notice.html": page("Quay Notice", KEEPER_RIBBON.format(what="the quay"),
                                    QUAY_SHEET, "Made for the table."),
    f"{CH4}/sealed-letter.html": page("The Sealed Letter — Keeper", KEEPER_RIBBON.format(what="the sealed letter"),
                                      SEALED_SHEET, "Made for the table."),
    f"{CH3}/hill-letter.html": page("Hill Letter", KEEPER_RIBBON.format(what="the hill"),
                                    HILL_SHEET, "Made for the table."),
}
LIVE_PAGE = {
    "gazetteer/papers/dinner-menu.html": page("The Bill of Fare", LIVE_RIBBON.format(what="The Collector's dinner"),
                                              MENU_SHEET, "Bound into the Gazetteer.", "papers.css"),
    "gazetteer/papers/quay-notice.html": page("Quay Notice", LIVE_RIBBON.format(what="The quay"),
                                              QUAY_SHEET, "Bound into the Gazetteer.", "papers.css"),
    "gazetteer/papers/hill-letter.html": page("Hill Letter", LIVE_RIBBON.format(what="The hill"),
                                              HILL_SHEET, "Bound into the Gazetteer.", "papers.css"),
}
PAPERS_INDEX = """<!DOCTYPE html>
<html><head><title>The Papers — The Port Gazetteer</title><link rel="stylesheet" href="papers.css"></head>
<body>
<h1>THE PAPERS</h1>
<p class="sub">Everything the party has been handed.</p>
<p class="sub">Carried from the hill.</p>
<ul class="shelf">
  <li><a href="hill-letter.html"><span class="t">The Hill Letter</span><span class="s">Brought down by a runner.</span></a></li>
</ul>
<p class="sub">At the port &mdash; papers in hand.</p>
<ul class="shelf">
  <li><a href="dinner-menu.html"><span class="t">The Bill of Fare</span><span class="s">Laid at each end of the table.</span></a></li>
  <li><a href="quay-notice.html"><span class="t">The Quay Notice</span><span class="s">Nailed to the customs door.</span></a></li>
</ul>
</body></html>
"""
COVER = """<!DOCTYPE html>
<html><head><title>The Port Gazetteer</title><link rel="stylesheet" href="gazetteer.css"></head>
<body><h1>The Port Gazetteer</h1>
<a href="guide.html">The Harbour Guide</a>
<a href="maps.html">The Maps</a>
<a href="papers/index.html">The Papers</a>
<a href="shelf/index.html">The Shelf</a>
</body></html>
"""
GUIDE = """<!DOCTYPE html>
<html><head><title>The Harbour Guide — The Port Gazetteer</title><link rel="stylesheet" href="gazetteer.css"></head>
<body><a href="index.html">Back</a><h1>The Harbour Guide</h1><p>Mind the tides at the bar.</p></body></html>
"""
MAPS = """<!DOCTYPE html>
<html><head><title>The Maps — The Port Gazetteer</title><link rel="stylesheet" href="gazetteer.css"></head>
<body><a href="index.html">Back</a><img src="assets/port-map.svg" alt="The Port and its Quays — the bar, the customs house and the moorings">
<a class="plate-frame" data-map="assets/plate-full.jpg" data-overlay="plate" href="#">Open the plate</a></body></html>
"""
SHELF_INDEX = """<!DOCTYPE html>
<html><head><title>The Shelf — The Port Gazetteer</title><link rel="stylesheet" href="shelf.css"></head>
<body><a href="../index.html">Back</a><div id="shelf"></div>
<script src="state.js"></script>
<script src="shelf.js"></script>
</body></html>
"""
STATE_JS = """window.SHELF = {
  'tide-tables': { title: 'Tide Tables', line: 'A damp almanac of the bar.', href: 'tide-tables.html',
    status: 'open', cover: 'assets/tide.jpg', marks: [{ name: 'spring', state: 'sealed' }] },
  'moon-almanac': { title: 'Moon Almanac', line: 'Locked in its case.', status: 'shelved', cover: null }
};
"""
# `gm-publish props read-state shelf/state.js --json`, run on STATE_JS.
STATE_ANSWER = {"global": "SHELF", "items": {
    "tide-tables": {"title": "Tide Tables", "line": "A damp almanac of the bar.", "href": "tide-tables.html",
                    "status": "open", "cover": "assets/tide.jpg", "marks": [{"name": "spring", "state": "sealed"}]},
    "moon-almanac": {"title": "Moon Almanac", "line": "Locked in its case.", "status": "shelved", "cover": None}},
    "tool_fields": ["prop_address", "prop_breaks", "prop_container", "prop_file", "prop_font", "prop_group", "prop_hand",
                    "prop_kind", "prop_line", "prop_shift", "prop_state", "prop_state_global", "prop_style", "prop_title",
                    "show_sealed"]}
DINNER_NOTE = """---
name: "The Collector's Dinner Menu"
type: document
---

The bill of fare from the dinner.

- **Printable prop:** `Chapters/Chapter 4 - Port/Props/dinner-menu.html`. One sheet.
"""
SEALED_NOTE = """---
name: "The Sealed Letter"
type: document
withheld: true
---

### Printable prop

`Chapters/Chapter 4 - Port/Props/sealed-letter.html`, folded twice.
"""


def write_tree(root: Path, files: dict[str, str | bytes]) -> None:
    for rel, data in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))


def gazetteer(tmp_path: Path, extra_vault: dict[str, str | bytes] | None = None) -> tuple[Path, Path]:
    """A vault shaped like Canticle's (hand-made pages in two chapters' Props
    folders, handout notes naming them) and its site, whose output keeps a
    hand-made gazetteer/ folder. (vault, site)."""
    vault, site = tmp_path / "vault", tmp_path / "site"
    write_tree(vault, {
        "_meta/vault-config.yaml": (
            "version: 1\nplayer_site:\n"
            f"  folder: {json.dumps(str(site))}\n"
            "  title: Port\n"
            "  folder_map:\n    Chapters: chapters\n    Documents: documents\n"
            "  keep:\n    - gazetteer\n"
            "  after_build:\n    - node inject-gazetteer.js\n    - node add-weather.mjs\n"
            "    - node add-extra.mjs\n"),
        "_meta/publish-list.yaml": "publishing:\n  - Documents/Dinner_Menu.md\nexcluded: []\nneeds_decision: []\n",
        **VAULT_PAGE,
        f"{CH4}/index.html": "<html><body><a href='dinner-menu.html'>Keeper shelf</a></body></html>\n",
        f"{CH4}/props.css": ".sheet { color: black; }\n",
        f"{CH3}/props.css": ".sheet { color: black; }\n",
        "Documents/Dinner_Menu.md": DINNER_NOTE,
        "Documents/Sealed_Letter.md": SEALED_NOTE,
        **(extra_vault or {}),
    })
    docs = site / "docs"
    write_tree(site, {
        "vault.config.json": json.dumps({"vaultPath": str(vault)}),
        "inject-gazetteer.js": "// adds the gazetteer box to docs/index.html\n",
        "add-weather.mjs": "// writes docs/weather.html\n",
        "add-extra.mjs": "// copies a page into docs/gazetteer/extra.html\n",
    })
    write_tree(docs, {
        "index.html": "<html><body><a href=\"gazetteer/\">The Port Gazetteer</a></body></html>\n",
        **LIVE_PAGE,
        "gazetteer/index.html": COVER,
        "gazetteer/guide.html": GUIDE,
        "gazetteer/maps.html": MAPS,
        "gazetteer/gazetteer.css": "body { background: url('assets/paper.jpg'); }\n",
        "gazetteer/assets/paper.jpg": b"\xff\xd8paper",
        "gazetteer/assets/port-map.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>Port</title></svg>\n",
        "gazetteer/assets/unused.jpg": b"\xff\xd8unused",
        "gazetteer/assets/plate-full.jpg": b"\xff\xd8plate",
        "gazetteer/papers/index.html": PAPERS_INDEX,
        "gazetteer/papers/papers.css": "body { background: url('../assets/paper.jpg'); }\n",
        "gazetteer/shelf/index.html": SHELF_INDEX,
        "gazetteer/shelf/state.js": STATE_JS,
        "gazetteer/shelf/shelf.js": "document.getElementById('shelf').textContent = Object.keys(window.SHELF).join();\n",
        "gazetteer/shelf/shelf.css": "#shelf { margin: 0; }\n",
        "gazetteer/shelf/tide-tables.html": ("<!DOCTYPE html><html><head><title>Tide Tables — The Port Gazetteer</title>"
                                             "<link rel=\"stylesheet\" href=\"shelf.css\"></head>"
                                             "<body><p>High water at noon.</p></body></html>\n"),
        "gazetteer/shelf/assets/tide.jpg": b"\xff\xd8tide",
    })
    return vault, site


def read_state_stub(path: Path) -> dict | None:
    return STATE_ANSWER if path.name == "state.js" else None


def converted(vault: Path, site: Path, given: dict | None = None) -> prop_move.Conversion:
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        return prop_move.convert(vault, site=site, given=given)


def fm_of(text: str) -> dict:
    import vaultlib
    return vaultlib.extract_frontmatter(text) or {}


def test_held_page_gets_unlisted_note(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    rel = f"{CH4}/sealed-letter.md"
    fm = fm_of(c.batch.texts[rel])
    assert fm["type"] == "prop" and fm["prop_kind"] == "document"
    assert fm["prop_file"] == "sealed-letter.html"
    # Where most of its live siblings sit, under its own name.
    assert fm["prop_address"] == "gazetteer/papers/sealed-letter.html"
    # The handout note's title, not the page's.
    assert fm["prop_title"] == "The Sealed Letter"
    # Its handout note does not publish, so it is named for the GM only.
    assert ("<!-- gm-only -->\n\n## GM Notes\n\nThe page that goes with [[Sealed_Letter]].\n\n"
            "<!-- /gm-only -->\n") in c.batch.texts[rel]
    # Never on the publish list: the handout note publishing must not carry it.
    assert rel not in c.publish
    assert not [p for p in c.publish if "sealed" in p.lower()]


def test_live_page_address_and_listing_fields(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    rel = f"{CH4}/dinner-menu.md"
    fm = fm_of(c.batch.texts[rel])
    assert fm["prop_file"] == "dinner-menu.html"
    assert fm["prop_address"] == "gazetteer/papers/dinner-menu.html"
    assert fm["prop_title"] == "The Bill of Fare"
    assert fm["prop_line"] == "Laid at each end of the table."
    assert fm["prop_group"] == "At the port — papers in hand."
    assert 'prop_container: "[[The Papers]]"\n' in c.batch.texts[rel]
    assert rel in c.publish
    body = c.batch.texts[rel].split("\n---\n", 1)[1]
    assert body.lstrip().startswith("## Description")
    assert "[[Dinner_Menu]]" in body
    hill = fm_of(c.batch.texts[f"{CH3}/hill-letter.md"])
    assert hill["prop_group"] == "Carried from the hill."
    assert hill["prop_address"] == "gazetteer/papers/hill-letter.html"
    # The listing becomes a container the move creates, listed for publishing.
    papers = f"{NOTES}/papers/The Papers.md"
    pfm = fm_of(c.batch.texts[papers])
    assert pfm["prop_kind"] == "container" and pfm["prop_address"] == "gazetteer/papers/index.html"
    assert pfm["show_sealed"] == "none"
    assert papers in c.publish
    assert c.decisions["listings"] == {"gazetteer/papers/index.html": {"container": "The Papers", "style": None}}


def test_diff_merge_player_view_equals_live(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    merged = c.files[f"{CH4}/dinner-menu.html"].decode("utf-8")
    # The vault's Keeper ribbon stays for the GM, inside a gm-only fence.
    assert "<!-- gm-only -->\n  <a href=\"index.html\">&larr; Keeper shelf</a>" in merged
    # A hunk of tags alone keeps the vault's side: the vault's stylesheet.
    assert 'href="props.css"' in merged and "papers.css" not in merged
    old, new = tmp_path / "old", tmp_path / "new"
    write_tree(old, {"gazetteer/papers/dinner-menu.html": LIVE_PAGE["gazetteer/papers/dinner-menu.html"]})
    (tmp_path / "merged.html").write_text(merged, encoding="utf-8")
    cut = subprocess.run(
        ["node", "-e", "const fs=require('fs');const {cutHtml}=require(process.argv[1]);"
         "fs.mkdirSync(process.argv[3],{recursive:true});"
         "fs.writeFileSync(process.argv[3]+'/dinner-menu.html',cutHtml(fs.readFileSync(process.argv[2],'utf8')).text);",
         str(TOOL / "lib" / "props" / "html-cut.js"), str(tmp_path / "merged.html"), str(new / "gazetteer" / "papers")],
        capture_output=True, text=True)
    assert cut.returncode == 0, cut.stderr
    done = subprocess.run(["node", str(TOOL / "bin" / "gm-publish.js"), "props", "compare", "--old", str(old),
                           "--new", str(new), "--serves", "gazetteer/"], capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.startswith("SAME-WORDS\tgazetteer/papers/dinner-menu.html\t"), done.stdout


def test_held_keeper_lines_wrapped(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    held = c.files[f"{CH4}/sealed-letter.html"].decode("utf-8")
    assert ("<!-- gm-only -->\n  <a href=\"index.html\">&larr; Keeper shelf</a>\n"
            "  <span class=\"plate\">KEEPER ONLY &middot; the sealed letter</span>\n<!-- /gm-only -->\n") in held
    assert "<!-- gm-only -->\n<p class=\"credits\">Made for the table.</p>\n<!-- /gm-only -->\n" in held
    # The prop's own words are left alone.
    assert "\n<p>The Keeper alone knows who wrote this.</p>\n" in held
    assert any(r.startswith(f"WOULD-WRAP\t{CH4}/sealed-letter.html\t3 Keeper lines") for r in c.rows), c.rows


def test_site_only_pages_become_supplied_props(tmp_path: Path) -> None:
    clash = f"{NOTES}/gazetteer.css"
    vault, site = gazetteer(tmp_path, {clash: "/* the GM's own */\n"})
    c = converted(vault, site)
    docs = site / "docs" / "gazetteer"
    # Each site-only page and the files it links, copied with its layout.
    # (The full plate is named only in a data- attribute the page's script opens.)
    for rel in ("guide.html", "maps.html", "index.html", "assets/paper.jpg", "assets/port-map.svg",
                "assets/plate-full.jpg"):
        assert c.files[f"{NOTES}/{rel}"] == (docs / rel).read_bytes(), rel
    assert f"{NOTES}/assets/unused.jpg" not in c.files
    # A vault file is never overwritten: the clash is for a person.
    assert clash not in c.files
    assert any(r.startswith(f"{prop_move.PERSON}\t{clash}\t") for r in c.rows)
    guide = fm_of(c.batch.texts[f"{NOTES}/The Harbour Guide.md"])
    assert guide["prop_kind"] == "supplied" and guide["prop_file"] == "guide.html"
    assert guide["prop_address"] == "gazetteer/guide.html"
    assert guide["prop_title"] == "The Harbour Guide"
    assert guide["prop_group"] == "The Port Gazetteer"
    # A map is named by its picture's alt text, before any " — ".
    svg = fm_of(c.batch.texts[f"{NOTES}/The Port and its Quays.md"])
    assert svg["prop_kind"] == "supplied" and svg["prop_file"] == "assets/port-map.svg"
    assert svg["prop_address"] == "gazetteer/assets/port-map.svg"
    for rel in ("The Harbour Guide.md", "The Maps.md", "The Port Gazetteer.md", "The Port and its Quays.md"):
        assert f"{NOTES}/{rel}" in c.publish, rel
    # The cover's note is the props page's cover.
    assert c.decisions["settings"]["player_site.props.cover"] == "[[The Port Gazetteer]]"
    assert 'prop_file: "index.html"\n' in c.batch.texts[f"{NOTES}/The Port Gazetteer.md"]
    assert c.decisions["settings"]["player_site.props.title"] == "The Port Gazetteer"
    assert c.decisions["retire"] == {"keep": ["gazetteer"], "after_build": ["node inject-gazetteer.js"]}
    assert c.decisions["serves"] == ["gazetteer/"]
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert any("add-extra.mjs" in r for r in person)
    assert not any("add-weather.mjs" in r for r in person)
    assert any("player_site.landing.banner" in r for r in person)


def test_state_file_becomes_container_and_items(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    shelf = f"{NOTES}/shelf/The Shelf.md"
    fm = fm_of(c.batch.texts[shelf])
    assert fm["prop_kind"] == "container" and fm["prop_file"] == "index.html"
    assert fm["prop_state"] == "state.js" and fm["prop_state_global"] == "SHELF"
    assert fm["prop_address"] == "gazetteer/shelf/index.html"
    tide_text = c.batch.texts[f"{NOTES}/shelf/Tide Tables.md"]
    tide = fm_of(tide_text)
    assert 'prop_container: "[[The Shelf]]"\n' in tide_text and tide["prop_line"] == "A damp almanac of the bar."
    assert tide["prop_file"] == "tide-tables.html" and tide["prop_address"] == "gazetteer/shelf/tide-tables.html"
    assert tide["prop_status"] == "open" and tide["prop_cover"] == "assets/tide.jpg"
    assert 'prop_marks: [{"name": "spring", "state": "sealed"}]' in tide_text
    moon_text = c.batch.texts[f"{NOTES}/shelf/Moon Almanac.md"]
    assert "prop_cover: null" in moon_text and "prop_file:" not in moon_text.replace('prop_file: ""', "")
    for rel in (shelf, f"{NOTES}/shelf/Tide Tables.md", f"{NOTES}/shelf/Moon Almanac.md"):
        assert rel in c.publish, rel
    # The page, its state file (kept for the GM), its script, the book page and its picture.
    for rel in ("index.html", "state.js", "shelf.js", "shelf.css", "tide-tables.html", "assets/tide.jpg"):
        assert f"{NOTES}/shelf/{rel}" in c.files, rel


def test_handout_notes_untouched(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    before = {rel: (vault / rel).read_bytes() for rel in ("Documents/Dinner_Menu.md", "Documents/Sealed_Letter.md")}
    c = converted(vault, site)
    for rel, data in before.items():
        assert rel not in c.batch.changed()
        assert rel not in c.publish
        assert (vault / rel).read_bytes() == data


# --- plan, apply, roll back (15c) ------------------------------------------------

# `gm-publish props move-check --json` on a site whose live page the vault no
# longer builds (and whose vault page carries its note's GM Notes sentence),
# on one where every served page is still there, and a leak alone: real runs.
CHECK_BLOCKED = {"rows": [
    {"kind": "missing", "address": "gazetteer/papers/extra.html", "detail": "not in the new site", "blocker": True},
    {"kind": "same-words", "address": "gazetteer/papers/menu.html",
     "detail": "added: \"the fish course hides the poisoned sauce boat\"", "blocker": False}],
    "blockers": 1, "served": 2, "pages": 2, "same": 1,
    "leaks": [{"code": "HIDDEN_TEXT", "page": "gazetteer/papers/menu.html",
               "text": "the fish course hides the poisoned sauce boat", "note": "Documents/Menu.md",
               "reason": "GM Notes section"}]}
CHECK_PASSED = {"rows": [
    {"kind": "same-words", "address": "gazetteer/papers/menu.html", "detail": "other markup, the same words",
     "blocker": False}], "blockers": 0, "served": 1, "pages": 1, "same": 1, "leaks": []}
CHECK_LEAK = {**CHECK_PASSED, "leaks": CHECK_BLOCKED["leaks"]}


def snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def mtimes(root: Path) -> dict[str, int]:
    return {p.relative_to(root).as_posix(): p.stat().st_mtime_ns for p in sorted(root.rglob("*"))}


def folders(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_dir()}


def run_apply(vault: Path, check: dict, *extra: str, calls: list[str] | None = None) -> tuple[int, str]:
    import contextlib
    import io

    def fake_check(config: Path, _decisions: dict, keep: Path | None = None) -> dict:
        if calls is not None:
            calls.append("check")
        # The build move-check keeps: the live output as the vault would make it (the state file as it was).
        if keep is not None:
            shutil.copytree(config.parent / "docs", keep)
        return check
    out = io.StringIO()
    with mock.patch.object(prop_move, "move_check", fake_check), contextlib.redirect_stdout(out):
        code = prop_move.main([str(vault), "apply", *extra])
    return code, out.getvalue()


def test_plan_writes_nothing(tmp_path: Path) -> None:
    import contextlib
    import io
    vault, site = gazetteer(tmp_path)
    before_v, before_s = snapshot(vault), snapshot(site)
    dirs_v, dirs_s = folders(vault), folders(site)
    times_v, times_s = mtimes(vault), mtimes(site)
    draft, report = tmp_path / "draft.json", tmp_path / "plan.json"
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = prop_move.main([str(vault), "plan", "--draft", str(draft), "--json", str(report)])
    text = out.getvalue()
    assert code == 0, text
    assert snapshot(vault) == before_v and snapshot(site) == before_s
    assert folders(vault) == dirs_v and folders(site) == dirs_s
    assert mtimes(vault) == times_v and mtimes(site) == times_s
    assert f"WOULD-CREATE\t{CH4}/dinner-menu.md\t" in text
    assert f"WOULD-COPY\t{NOTES}/guide.html\t" in text
    assert f"WOULD-PUBLISH\t{CH4}/dinner-menu.md\t" in text
    assert f"WOULD-PUBLISH\t{CH4}/sealed-letter.md" not in text
    assert "WOULD-SET\tplayer_site.props.cover\t" in text
    assert "WOULD-RETIRE\tplayer_site.keep\tgazetteer" in text
    assert "WOULD-RETIRE\tplayer_site.after_build\tnode inject-gazetteer.js" in text
    # move-check ran on the copy against the live output: the page the
    # gazetteer step injected is still linked from nowhere (the banner is the
    # GM's to write), so it is a blocker the plan shows.
    assert "CHECK\tindex.html\tLINK-LOST" in text
    # The state file the build makes holds every entry and value of the live one (read back by the tool).
    assert "STATE-DIFFERS" not in text, text
    assert text.rstrip().splitlines()[-1].startswith("# notes: ")
    assert json.loads(draft.read_text(encoding="utf-8"))["retire"]["keep"] == ["gazetteer"]
    assert json.loads(report.read_text(encoding="utf-8"))["counts"]["blockers"] >= 1


def test_apply_rolls_back_on_failed_check(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    before, dirs = snapshot(vault), folders(vault)
    code, text = run_apply(vault, CHECK_BLOCKED)
    assert code == 1, text
    assert "CHECK\tgazetteer/papers/extra.html\tMISSING" in text
    assert snapshot(vault) == before
    assert folders(vault) == dirs
    assert "the vault is as it was" in text


def test_apply_publishes_only_live(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    code, text = run_apply(vault, CHECK_PASSED)
    assert code == 0, text
    listed = (vault / "_meta" / "publish-list.yaml").read_text(encoding="utf-8")
    for rel in (f"{CH4}/dinner-menu.md", f"{CH4}/quay-notice.md", f"{CH3}/hill-letter.md",
                f"{NOTES}/papers/The Papers.md", f"{NOTES}/The Harbour Guide.md", f"{NOTES}/shelf/Tide Tables.md"):
        assert rel in listed, rel
    assert "sealed-letter" not in listed
    assert (vault / CH4 / "sealed-letter.md").is_file()
    # The handout note that already published is still the only other entry.
    assert "Documents/Dinner_Menu.md" in listed and "Sealed_Letter" not in listed


def test_apply_retires_only_after_check(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    calls: list[str] = []
    real_remove = prop_move.settings_remove

    def remove(v: Path, name: str, entries: list[str]) -> list[str]:
        calls.append(f"retire {name}")
        return real_remove(v, name, entries)
    with mock.patch.object(prop_move, "settings_remove", remove):
        code, text = run_apply(vault, CHECK_BLOCKED, calls=calls)
        assert code == 1 and calls == ["check"]
        calls.clear()
        code, text = run_apply(vault, CHECK_PASSED, calls=calls)
    assert code == 0, text
    assert calls == ["check", "retire player_site.keep", "retire player_site.after_build"]
    config = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
    assert "gazetteer" not in config.split("after_build")[0].split("keep")[-1]
    assert "inject-gazetteer" not in config
    assert "add-weather.mjs" in config and "add-extra.mjs" in config
    assert "RETIRED\tplayer_site.keep\tgazetteer" in text


def test_unknown_steps_never_retired(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    decisions = tmp_path / "decisions.json"
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        inferred = prop_move.convert(vault, site=site).decisions
    inferred["retire"]["after_build"] = ["node add-weather.mjs", "node inject-gazetteer.js"]
    decisions.write_text(json.dumps(inferred), encoding="utf-8")
    code, text = run_apply(vault, CHECK_PASSED, "--decisions", str(decisions))
    assert code == 0, text
    config = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
    assert "add-weather.mjs" in config and "inject-gazetteer" not in config
    assert f"{prop_move.PERSON}\tnode add-weather.mjs\t" in text


def test_log_created_before_tracking_only(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    code, text = run_apply(vault, CHECK_PASSED)
    assert code == 0, text
    log = json.loads((vault / "_meta" / "reveals.json").read_text(encoding="utf-8"))
    assert len(log["entries"]) == 1 and log["entries"][0]["before_tracking"] is True
    assert "session" not in log["entries"][0]
    # A log that is there is left as it is.
    vault2, _site2 = gazetteer(tmp_path / "again")
    kept = '{"entries": [{"session": "Session 3", "published": []}]}\n'
    (vault2 / "_meta" / "reveals.json").write_text(kept, encoding="utf-8")
    code, text = run_apply(vault2, CHECK_PASSED)
    assert code == 0, text
    assert (vault2 / "_meta" / "reveals.json").read_text(encoding="utf-8") == kept


def test_decisions_file_overrides_inference(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    given = {"version": 1, "notes_folder": {"gazetteer": "Documents/Gazetteer"},
             "settings": {"player_site.props.title": "Port Papers",
                          "player_site.landing.banner.title": "The Gazetteer",
                          "player_site.landing.banner.text": "Open it.",
                          "player_site.landing.banner.link": "gazetteer/index.html"},
             "listings": {}, "groups": {"gazetteer": "From the port"}}
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        c = prop_move.convert(vault, site=site, given=given)
    assert c.decisions["notes_folder"] == {"gazetteer": "Documents/Gazetteer"}
    assert c.decisions["settings"] == given["settings"]
    guide = fm_of(c.batch.texts["Documents/Gazetteer/The Harbour Guide.md"])
    assert guide["prop_group"] == "From the port"
    # No listing: no container, and the papers keep no prop_container; the
    # hand-made listing page is a supplied page of its own.
    assert "prop_container: \"[[" not in c.batch.texts[f"{CH4}/dinner-menu.md"]
    assert fm_of(c.batch.texts["Documents/Gazetteer/papers/The Papers.md"])["prop_kind"] == "supplied"
    assert "Documents/Gazetteer/papers/index.html" in c.files
    assert not [r for r in c.rows if "player_site.landing.banner" in r]


# --- fix round 1: build_props credits lines (Ruling 27) ---------------------------

def built_page(credits: str) -> str:
    """A page shaped like the ones build_props writes: a ribbon with the shelf
    crumb and the note link, the sheet, and its credits line."""
    return ("<!DOCTYPE html>\n<html><head><title>A Note from Gull</title>"
            "<link rel=\"stylesheet\" href=\"props.css\"></head>\n<body>\n<nav class=\"ribbon\">\n"
            "  <a href=\"index.html\">&larr; Chapter 1 props</a>\n  <span class=\"plate\">Left under the hatch</span>\n"
            "  <a href=\"../documents/gull.html\">About this handout</a>\n</nav>\n"
            "<pre class=\"hand gull-hand\">Ana, the pumps are fixed.\nDo not trust the harbourmaster.</pre>\n"
            f"<p class=\"credits\">{credits}</p>\n</body></html>\n")


def test_build_props_credits_expected_gone(tmp_path: Path) -> None:
    credits = ("One page. Text is verbatim from <em>Documents/Gull.md</em>. "
               "To print, tick <strong>Background graphics</strong> &amp; set margins to None.")
    vault = vault_with(tmp_path, {"Documents/Gull.md": LETTER})
    site = tmp_path / "site"
    write_tree(vault, {"_meta/vault-config.yaml": (
        "version: 1\nplayer_site:\n"
        f"  folder: {json.dumps(str(site))}\n  title: Run\n"
        "  folder_map:\n    Documents: documents\n"
        "  after_build:\n    - node scripts/add-props.mjs\n")})
    old = built_page(credits)
    write_tree(site, {"vault.config.json": json.dumps({"vaultPath": str(vault)}),
                      "scripts/add-props.mjs": "// builds docs/props/ with build_props.py\n",
                      "docs/props/gull-letter.html": old})
    c = prop_move.convert(vault, site=site)
    said = ("One page. Text is verbatim from Documents/Gull.md. "
            "To print, tick Background graphics & set margins to None.")
    assert c.decisions["expect_gone"] == ["Chapter 1 props", "About this handout", said]
    assert f"EXPECT-GONE\tprops/gull-letter.html\t{said}" in c.rows
    # The phrase reads as the tool reads the page: a page without the crumb,
    # the note link and the credits line keeps every other word.
    now = old.replace('  <a href="index.html">&larr; Chapter 1 props</a>\n', "").replace(
        '  <a href="../documents/gull.html">About this handout</a>\n', "").replace(
        f'<p class="credits">{credits}</p>\n', "")
    write_tree(tmp_path / "new", {"props/gull-letter.html": now})
    args = ["node", str(TOOL / "bin" / "gm-publish.js"), "props", "compare", "--old", str(site / "docs"),
            "--new", str(tmp_path / "new"), "--serves", "props/"]
    for phrase in c.decisions["expect_gone"]:
        args += ["--expect-gone", phrase]
    done = subprocess.run(args, capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.startswith("SAME-WORDS\tprops/gull-letter.html\t"), done.stdout
    # A decisions file's expect_gone wins, and then no credits row is shown for a phrase it left out.
    given = prop_move.convert(vault, site=site, given={"version": 1, "expect_gone": ["Chapter 1 props"]})
    assert given.decisions["expect_gone"] == ["Chapter 1 props"]
    assert not [r for r in given.rows if r.startswith("EXPECT-GONE")]


# --- fix round 3 (Rulings 31, 32) ---------------------------------------------------

def test_unchecked_keep_and_steps_never_retire(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        decisions = prop_move.convert(vault, site=site).decisions
    # The check would compare only the papers: the cover, maps and shelf would go unchecked.
    decisions["serves"] = ["gazetteer/papers/"]
    path = tmp_path / "decisions.json"
    path.write_text(json.dumps(decisions), encoding="utf-8")
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        c = prop_move.convert(vault, site=site, given=decisions)
    assert c.decisions["retire"] == {"keep": [], "after_build": []}
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert any(r.startswith(f"{prop_move.PERSON}\tgazetteer/\tnot retired") for r in person), person
    assert any(r.startswith(f"{prop_move.PERSON}\tnode inject-gazetteer.js\tnot retired") for r in person), person
    code, text = run_apply(vault, CHECK_PASSED, "--decisions", str(path))
    assert code == 0, text
    config = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
    assert "- gazetteer" in config and "inject-gazetteer.js" in config


def test_apply_blocks_on_a_new_leak(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    before, dirs = snapshot(vault), folders(vault)
    code, text = run_apply(vault, CHECK_LEAK)
    assert code == 1, text
    assert ('CHECK\tgazetteer/papers/menu.html\tLEAK: "the fish course hides the poisoned sauce boat" '
            "from Documents/Menu.md (GM Notes section); the live site does not show it") in text
    assert "the vault is as it was" in text and "RETIRED" not in text and "PRUNED" not in text
    assert snapshot(vault) == before and folders(vault) == dirs
    # The same finding on the live site before the move is not the move's.
    with mock.patch.object(prop_move, "leak_findings",
                           lambda _c: {("gazetteer/papers/menu.html", "the fish course hides the poisoned sauce boat")}):
        code, text = run_apply(vault, CHECK_LEAK)
    assert code == 0, text
    assert "LEAK" not in text and "PRUNED\t" in text


def test_tag_only_hunk_with_outside_addresses_keeps_live_side() -> None:
    vault = ('<html><head>\n<link href="https://fonts.example.com/css?family=Old+Face" rel="stylesheet">\n'
             '<link rel="stylesheet" href="props.css">\n</head><body>\n<p>Words.</p>\n</body></html>\n')
    live = ('<html><head>\n<link href="https://fonts.example.com/css?family=Old+Face&family=New+Hand" rel="stylesheet">\n'
            '<link rel="stylesheet" href="papers.css">\n</head><body>\n<p>Words.</p>\n</body></html>\n')
    merged, keeper = prop_move.merge_delivered(vault, live)
    # The font service's link is the live page's; the stylesheet beside the page stays the vault's.
    assert "family=New+Hand" in merged and "family=Old+Face\"" not in merged
    assert 'href="props.css"' in merged and "papers.css" not in merged
    assert keeper == [] and "gm-only" not in merged


def test_listing_words_win_over_other_links(tmp_path: Path) -> None:
    cover = COVER.replace('<a href="papers/index.html">The Papers</a>',
                          '<a href="papers/index.html">The Papers</a>\n<a href="papers/dinner-menu.html">Supper</a>')
    vault, site = gazetteer(tmp_path)
    (site / "docs" / "gazetteer" / "index.html").write_text(cover, encoding="utf-8")
    c = converted(vault, site)
    assert fm_of(c.batch.texts[f"{CH4}/dinner-menu.md"])["prop_title"] == "The Bill of Fare"


def test_plan_points_the_gm_site_at_a_stand_in(tmp_path: Path) -> None:
    import contextlib
    import io
    vault, site = gazetteer(tmp_path)
    config = vault / "_meta" / "vault-config.yaml"
    gm = tmp_path / "gm-site"
    config.write_text(config.read_text(encoding="utf-8") + f"gm_site:\n  folder: {json.dumps(str(gm))}\n",
                      encoding="utf-8")
    seen: list[list[tuple[str, object]]] = []
    real = prop_move._set_settings

    def record(v: Path, pairs: list[tuple[str, object]]) -> None:
        seen.append(list(pairs))
        real(v, pairs)
    with mock.patch.object(prop_move, "_set_settings", record), contextlib.redirect_stdout(io.StringIO()):
        assert prop_move.main([str(vault), "plan"]) == 0
    first = dict(seen[0])
    assert first["player_site.folder"] != str(site) and first["gm_site.folder"] != str(gm)
    assert not gm.exists()


def test_a_note_the_tool_does_not_call_a_prop_names_no_page(tmp_path: Path) -> None:
    # An NPC note naming the menu page by prop_file is no prop (the publish tool says so): the page is still hand-made.
    npc = "---\ntype: npc\nprop_file: dinner-menu.html\n---\nThe Collector.\n"
    vault, site = gazetteer(tmp_path, {f"{CH4}/The Collector.md": npc})
    c = converted(vault, site)
    assert f"{CH4}/dinner-menu.md" in c.batch.texts


def test_a_font_link_only_the_live_page_has_is_kept() -> None:
    vault = '<html><head>\n<link rel="stylesheet" href="props.css">\n</head><body>\n<p>Words.</p>\n</body></html>\n'
    live = ('<html><head>\n<link href="https://fonts.example.com/css?family=New+Hand" rel="stylesheet">\n'
            '<link rel="stylesheet" href="props.css">\n</head><body>\n<p>Words.</p>\n</body></html>\n')
    merged, keeper = prop_move.merge_delivered(vault, live)
    assert merged == live and keeper == []
    # A local line only the live page has stays out: the vault's own files are the page's.
    local = live.replace("https://fonts.example.com/css?family=New+Hand", "papers.css")
    assert prop_move.merge_delivered(vault, local)[0] == vault


# --- fix wave: Rulings 35-44 --------------------------------------------------------

def test_state_field_the_tool_reads_needs_a_person(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    answer = json.loads(json.dumps(STATE_ANSWER))
    answer["items"]["tide-tables"].update({"group": "Poetry", "kind": "folio", "state": "wet"})
    with mock.patch.object(prop_move, "read_state", lambda p: answer if p.name == "state.js" else None):
        c = prop_move.convert(vault, site=site)
    text = c.batch.texts[f"{NOTES}/shelf/Tide Tables.md"]
    fm = fm_of(text)
    # Not written: the tool reads these itself and would never give them back to the shelf's script.
    assert fm["prop_kind"] == "document" and not fm.get("prop_group") and not fm.get("prop_state")
    assert "Poetry" not in text and "folio" not in text and "wet" not in text
    assert fm["prop_status"] == "open"
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    for k in ("group", "kind", "state"):
        assert any(f"tide-tables: field {k!r}" in r and "the publish tool reads" in r for r in person), (k, person)
    # An answer from a tool too old to name its fields is a failure, not a guess.
    old = {k: v for k, v in STATE_ANSWER.items() if k != "tool_fields"}
    with mock.patch.object(prop_move, "read_state", lambda p: old if p.name == "state.js" else None):
        try:
            prop_move.convert(vault, site=site)
        except prop_move.StepFailed as e:
            assert "older" in str(e)
        else:
            raise AssertionError("no failure")


def test_state_files_compared(tmp_path: Path) -> None:
    live = tmp_path / "live"
    build = tmp_path / "build"
    write_tree(live, {"g/shelf/state.js": STATE_JS})
    same = STATE_JS.replace("'moon-almanac': {", "'moon-almanac': { sealed: false,").replace(
        "  'tide-tables': {", "  'tide-tables': { sealed: false,")
    write_tree(build, {"g/shelf/state.js": same})
    c = prop_move.new_conversion(tmp_path)
    c.live_root = live
    c.states = ["g/shelf/state.js"]
    # Order, and the tool's own sealed: false, are no difference; nor a null field left out.
    assert prop_move.state_rows(c, build) == []
    write_tree(build, {"g/shelf/state.js": same.replace(", cover: null", "")})
    assert prop_move.state_rows(c, build) == []
    write_tree(build, {"g/shelf/state.js": same.replace("status: 'open'", "status: 'shut'")
                       .replace("cover: null", "cover: 'x.jpg'").replace("'Moon Almanac'", "'Moon Book'")})
    rows = prop_move.state_rows(c, build)
    assert len(rows) == 1 and rows[0].startswith("CHECK\tg/shelf/state.js\tSTATE-DIFFERS: "), rows
    assert "tide-tables.status" in rows[0] and "moon-almanac.cover" in rows[0] and "moon-almanac.title" in rows[0]
    write_tree(build, {"g/shelf/state.js": "window.SHELF = { 'tide-tables': { title: 'Tide Tables' } };\n"})
    rows = prop_move.state_rows(c, build)
    assert "moon-almanac gone" in rows[0] and "tide-tables.marks gone" in rows[0], rows
    (build / "g/shelf/state.js").unlink()
    assert "no state file" in prop_move.state_rows(c, build)[0]


def test_apply_blocks_when_the_state_file_differs(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    before = snapshot(vault)
    real = prop_move.move_check

    def changed(config: Path, decisions: dict, keep: Path | None = None) -> dict:
        assert keep is not None
        shutil.copytree(config.parent / "docs", keep)
        state = keep / "gazetteer" / "shelf" / "state.js"
        state.write_text(state.read_text(encoding="utf-8").replace("'open'", "'shut'"), encoding="utf-8")
        return CHECK_PASSED
    import contextlib
    import io
    out = io.StringIO()
    with mock.patch.object(prop_move, "move_check", changed), contextlib.redirect_stdout(out):
        code = prop_move.main([str(vault), "apply"])
    assert prop_move.move_check is real
    text = out.getvalue()
    assert code == 1, text
    assert "CHECK\tgazetteer/shelf/state.js\tSTATE-DIFFERS: tide-tables.status" in text
    assert "the vault is as it was" in text and snapshot(vault) == before


def test_prune_keeps_what_the_checked_build_needs(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    seen: list[list[str]] = []
    real = prop_move.plugin_tool

    def tool(args: list[str]) -> tuple[int, str, str]:
        if args[:2] == ["leaks", "prune"]:
            seen.append(list(args))
            keep = Path(args[args.index("--also") + 1])
            assert (keep / "gazetteer" / "shelf" / "state.js").is_file(), "the checked build is still there"
        return real(args)
    with mock.patch.object(prop_move, "plugin_tool", tool):
        code, text = run_apply(vault, CHECK_PASSED)
    assert code == 0, text
    assert len(seen) == 1 and "--also" in seen[0]
    # The checked build is removed afterwards.
    assert not Path(seen[0][seen[0].index("--also") + 1]).exists()


def test_plan_round_trip_blocks_a_state_field_the_tool_reads(tmp_path: Path) -> None:
    import contextlib
    import io
    vault, site = gazetteer(tmp_path)
    state = site / "docs" / "gazetteer" / "shelf" / "state.js"
    state.write_text(STATE_JS.replace("status: 'open',", "status: 'open', group: 'Poetry',"), encoding="utf-8")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert prop_move.main([str(vault), "plan"]) == 0
    text = out.getvalue()
    assert f"{prop_move.PERSON}\t{NOTES}/shelf/The Shelf.md\ttide-tables: field 'group' not carried over" in text, text
    # Built and read back, the made state file lacks it: a blocker, not a quiet loss.
    assert "CHECK\tgazetteer/shelf/state.js\tSTATE-DIFFERS: tide-tables.group gone" in text, text


def test_a_killed_apply_puts_the_vault_back(tmp_path: Path) -> None:
    import contextlib
    import io
    import os
    import signal
    for n, sig in enumerate((signal.SIGTERM, signal.SIGHUP)):
        vault, site = gazetteer(tmp_path / str(n))
        before, dirs = snapshot(vault), folders(vault)
        kept = signal.getsignal(sig)

        def killed(config: Path, decisions: dict, keep: Path | None = None, sig: signal.Signals = sig) -> dict:
            # The notes are written and published by now: the half state a kill must never leave.
            assert (vault / CH4 / "dinner-menu.md").is_file()
            os.kill(os.getpid(), sig)
            raise AssertionError("the signal did not stop the move")
        out = io.StringIO()
        with mock.patch.object(prop_move, "move_check", killed), contextlib.redirect_stdout(out):
            code = prop_move.main([str(vault), "apply"])
        text = out.getvalue()
        assert code == 1, text
        assert f"stopped by {sig.name}" in text and "the vault is as it was" in text, text
        assert snapshot(vault) == before and folders(vault) == dirs
        # The handlers are the caller's again afterwards.
        assert signal.getsignal(sig) == kept


def test_every_new_prop_note_has_its_title(tmp_path: Path) -> None:
    # Ruling 38: the page heading, the prop bar and Connections read `title:`, else the file name (a slug here).
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    made = [rel for rel in c.batch.changed() if rel.endswith(".md") and c.batch.originals.get(rel) is None]
    assert made
    for rel in made:
        fm = fm_of(c.batch.texts[rel])
        assert fm.get("title") == fm["name"], rel
    assert fm_of(c.batch.texts[f"{CH4}/dinner-menu.md"])["title"] == "The Bill of Fare"
    assert fm_of(c.batch.texts[f"{CH4}/sealed-letter.md"])["title"] == "The Sealed Letter"
    assert fm_of(c.batch.texts[f"{NOTES}/shelf/Tide Tables.md"])["title"] == "Tide Tables"


def test_new_note_names_free_as_links_fold_them(tmp_path: Path) -> None:
    # Ruling 39: [[The Port Gazetteer]] must name one note; the site folds case, underscores and spaces, and reads
    # titles and aliases too.
    vault, site = gazetteer(tmp_path, {
        "Documents/The_Port_Gazetteer.md": "---\ntype: document\n---\nThe old write-up.\n",
        "Locations/Quay.md": "---\ntype: location\naliases: [\"the  harbour guide\"]\n---\nThe quay.\n",
        "Items/tide__TABLES.md": "---\ntype: item\n---\nA book.\n",
        # A title is not a link name: it takes nothing.
        "Items/Book.md": "---\ntype: item\ntitle: The Maps\n---\nA book.\n"})
    c = converted(vault, site)
    made = {Path(rel).stem for rel in c.batch.changed() if c.batch.originals.get(rel) is None}
    assert {"The Port Gazetteer (prop)", "The Harbour Guide (prop)", "Tide Tables (prop)"} <= made, made
    assert not {"The Port Gazetteer", "The Harbour Guide", "Tide Tables"} & made
    assert "The Maps" in made
    assert c.decisions["settings"]["player_site.props.cover"] == "[[The Port Gazetteer (prop)]]"
    # Both names taken: a person names it.
    vault2, site2 = gazetteer(tmp_path / "two", {
        "Documents/The_Port_Gazetteer.md": "---\ntype: document\n---\nOld.\n",
        "Documents/Other.md": "---\ntype: document\naliases: [The Port Gazetteer (Prop)]\n---\nOld.\n"})
    c2 = converted(vault2, site2)
    assert any(r.startswith(f"{prop_move.PERSON}\t{NOTES}/The Port Gazetteer.md\tno free note name") for r in c2.rows), c2.rows


def test_envelope_hand_read_from_the_live_page(tmp_path: Path) -> None:
    # Ruling 42: build_props writes every envelope word in one fixed hand class; the live page says which.
    mail = (LETTER.replace("gull-letter.html", "mail.html").replace("prop_look: hand", "prop_look: terminal")
            .replace("prop_hand: gull-hand\n", "prop_envelope: ANA\n"))
    both = (LETTER.replace("gull-letter.html", "both.html").replace("prop_hand: gull-hand\n",
                                                                   "prop_hand: wren-hand\nprop_envelope: ANA\n"))
    same = (LETTER.replace("gull-letter.html", "same.html").replace("prop_hand: gull-hand\n",
                                                                   "prop_hand: six-hand\nprop_envelope: ANA\n"))
    css = STYLESHEET + ".six-hand { position: absolute; font-family: 'Permanent Marker', cursive; }\n"
    vault = vault_with(tmp_path, {"Documents/Mail.md": mail, "Documents/Both.md": both, "Documents/Same.md": same}, css)
    site = tmp_path / "site"
    envelope = ('<section class="sheet desk"><div class="envelope"><div class="frank">PAID</div>'
                '<div class="six-hand">ANA</div></div></section>')
    write_tree(vault, {"_meta/vault-config.yaml": (
        "version: 1\nplayer_site:\n"
        f"  folder: {json.dumps(str(site))}\n  title: Run\n"
        "  folder_map:\n    Documents: documents\n"
        "  after_build:\n    - node scripts/add-props.mjs\n")})
    write_tree(site, {"vault.config.json": json.dumps({"vaultPath": str(vault)}),
                      **{f"docs/props/{p}.html": f"<html><body>{envelope}</body></html>\n" for p in ("mail", "both", "same")}})
    c = prop_move.convert(vault, site=site)
    assert fm_of(c.batch.texts["Documents/Mail.md"])["prop_hand"] == "six"
    hands = json.loads(c.batch.texts["_meta/prop-hands.json"])["hands"]
    assert hands["six"]["font"] == "Permanent Marker"
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert not [r for r in person if "Mail.md" in r or "Same.md" in r], person
    assert fm_of(c.batch.texts["Documents/Same.md"])["prop_hand"] == "six"
    # The letter has a hand of its own, and prop_hand holds one: a person chooses.
    assert fm_of(c.batch.texts["Documents/Both.md"])["prop_hand"] == "wren"
    assert any(r.startswith(f"{prop_move.PERSON}\tDocuments/Both.md\t") and "six" in r and "envelope" in r for r in person), person


def test_a_state_item_without_a_page_keeps_its_state_key_when_its_name_is_taken(tmp_path: Path) -> None:
    # The tool keys an item with no page of its own by its note's file name: "(prop)" would change the key the
    # shelf's script reads, so the old key itself names the note (its title stays the book's).
    vault, site = gazetteer(tmp_path, {"Items/Moon_Almanac.md": "---\ntype: item\n---\nThe real almanac.\n"})
    c = converted(vault, site)
    rel = f"{NOTES}/shelf/moon-almanac.md"
    assert rel in c.batch.texts, sorted(c.batch.changed())
    assert fm_of(c.batch.texts[rel])["title"] == "Moon Almanac"
    assert f"{NOTES}/shelf/Moon Almanac (prop).md" not in c.batch.texts
    # An item with a page of its own is keyed by its page: "(prop)" is fine there.
    vault2, site2 = gazetteer(tmp_path / "two", {"Items/Tide_Tables.md": "---\ntype: item\n---\nOld.\n"})
    assert f"{NOTES}/shelf/Tide Tables (prop).md" in converted(vault2, site2).batch.texts


def test_a_stop_during_another_put_back_does_not_cut_it_short(tmp_path: Path) -> None:
    import os
    import signal
    vault, site = gazetteer(tmp_path)
    before, dirs = snapshot(vault), folders(vault)
    real = prop_move.Journal.restore

    def restore(self: prop_move.Journal) -> list[str]:
        os.kill(os.getpid(), signal.SIGTERM)    # arrives while a blocker's put-back runs
        return real(self)
    with mock.patch.object(prop_move.Journal, "restore", restore):
        code, text = run_apply(vault, CHECK_BLOCKED)
    assert code == 1, text
    assert "the vault is as it was" in text
    assert snapshot(vault) == before and folders(vault) == dirs


# --- props-move fixes (1.10.106) -------------------------------------------------------

def test_live_notes_are_settled_and_held_ones_stay_draft(tmp_path: Path) -> None:
    # #528: a note made for a page that is live today is settled canon; a held paper keeps the template's DRAFT.
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    status = {rel: fm_of(c.batch.texts[rel]).get("canon_status") for rel in c.batch.changed() if rel.endswith(".md")}
    for rel in c.publish:
        assert status[rel] == prop_move.SETTLED, rel
    assert status[f"{CH4}/sealed-letter.md"] == "DRAFT"
    assert prop_move.SETTLED == "AUTHORITATIVE"
    # The schema's values: DRAFT / AUTHORITATIVE / SUPERSEDED / STUB.
    schema = (ROOT / "skills" / "shared" / "entity-schema.md").read_text(encoding="utf-8")
    assert "DRAFT / AUTHORITATIVE / SUPERSEDED / STUB" in schema


def test_a_missing_listing_style_is_a_person_row_before_any_build(tmp_path: Path) -> None:
    # #527: a style the decisions name that neither the vault nor the plugin has.
    vault, site = gazetteer(tmp_path)
    given = converted(vault, site).decisions
    given["listings"]["gazetteer/papers/index.html"]["style"] = "port-papers"
    c = converted(vault, site, given)
    row = (f"{prop_move.PERSON}\tlistings.gazetteer/papers/index.html.style\t"
           f'no style "port-papers" in _meta/prop-styles/ or the plugin')
    assert any(r.startswith(row) for r in c.rows), c.rows
    assert c.missing_styles == ["port-papers"]
    # In the vault it is no row.
    write_tree(vault, {"_meta/prop-styles/port-papers/layout.html": "<main>{{{items}}}</main>\n"})
    assert converted(vault, site, given).missing_styles == []
    # A plugin style is no row either.
    given["listings"]["gazetteer/papers/index.html"]["style"] = "letter"
    assert converted(vault, site, given).missing_styles == []


def test_apply_with_a_missing_listing_style_changes_nothing(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    given = converted(vault, site).decisions
    given["listings"]["gazetteer/papers/index.html"]["style"] = "port-papers"
    decisions = tmp_path / "decisions.json"
    decisions.write_text(json.dumps(given), encoding="utf-8")
    before = snapshot(vault)
    calls: list[str] = []
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        code, text = run_apply(vault, CHECK_PASSED, "--decisions", str(decisions), calls=calls)
    assert code == 1 and calls == [], text
    assert 'no style "port-papers"' in text and "the vault is as it was" in text
    assert snapshot(vault) == before
    # The plan says so and builds nothing: no CHECK row, no "the page is gone".
    import contextlib
    import io
    out = io.StringIO()
    with mock.patch.object(prop_move, "read_state", read_state_stub), contextlib.redirect_stdout(out):
        assert prop_move.main([str(vault), "plan", "--decisions", str(decisions)]) == 0
    said = out.getvalue()
    assert 'listings.gazetteer/papers/index.html.style\tno style "port-papers"' in said
    assert "CHECK\t" not in said and "LISTING-LOST" not in said
    assert said.rstrip().endswith("blockers: 1")
    assert snapshot(vault) == before


def test_a_reordered_listing_is_counted_in_the_plan_summary(tmp_path: Path) -> None:
    vault, site = gazetteer(tmp_path)
    c = converted(vault, site)
    rows = ["CHECK\tgazetteer/papers/index.html\tLISTING-REORDERED: 3 links kept, in another order: 2 moved; …",
            "CHECK\tgazetteer/papers/menu.html\tSAME-WORDS: other markup, the same words"]
    n = prop_move.counts(c, 0, rows)
    assert n["reordered"] == 1 and n["blockers"] == 0
    assert "listings reordered: 1 blockers: 0" in prop_move.totals(n)
    assert "reordered" not in prop_move.totals(prop_move.counts(c, 0, rows[1:]))


BUILT_LETTER = ("<!DOCTYPE html>\n<html><head><title>A Note from Gull</title><link rel=\"stylesheet\" href=\"props.css\">"
                "</head>\n<body>\n<pre class=\"hand gull-hand\">Ana, the pumps are fixed.</pre>\n</body></html>\n")


def build_props_vault(tmp_path: Path) -> tuple[Path, Path]:
    """A vault shaped like Dead End's: a build_props note whose page build_props wrote into the chapter's Props folder,
    served live under props/ by a site step."""
    vault = vault_with(tmp_path, {"Documents/Gull.md": LETTER,
                                  "Chapters/Chapter 1 - The Run/Props/gull-letter.html": BUILT_LETTER})
    site = tmp_path / "site"
    write_tree(vault, {
        "_meta/vault-config.yaml": (
            "version: 1\nplayer_site:\n"
            f"  folder: {json.dumps(str(site))}\n  title: Run\n"
            "  folder_map:\n    Documents: documents\n    Chapters: chapters\n"
            "  after_build:\n    - node scripts/add-props.mjs\n"),
        "_meta/publish-list.yaml": "publishing:\n  - Documents/Gull.md\nexcluded: []\nneeds_decision: []\n"})
    write_tree(site, {"vault.config.json": json.dumps({"vaultPath": str(vault)}),
                      "scripts/add-props.mjs": "// builds docs/props/ with build_props.py\n",
                      "docs/index.html": "<html><body><a href=\"props/gull-letter.html\">Gull</a></body></html>\n",
                      "docs/props/gull-letter.html": BUILT_LETTER})
    return vault, site


def test_a_finished_move_is_not_offered_again(tmp_path: Path) -> None:
    # #525: the old build_props pages stay in the Props folder on purpose; a moved note's style builds each one now.
    import migrate_site
    vault, _site = build_props_vault(tmp_path)
    assert migrate_site.find_props_move(vault), "offered before the move"
    code, text = run_apply(vault, CHECK_PASSED)
    assert code == 0, text
    assert (vault / "Chapters/Chapter 1 - The Run/Props/gull-letter.html").is_file()
    assert migrate_site.find_props_move(vault) == []
    # A second plan finds nothing to move either: the page is no hand-made page.
    assert prop_move._handmade_pages(prop_move.new_conversion(vault)) == []
    # The move recorded the page it left, by its vault path.
    record = json.loads((vault / prop_move.RECORD).read_text(encoding="utf-8"))
    assert record == {"version": 1, "pages": ["Chapters/Chapter 1 - The Run/Props/gull-letter.html"]}
    assert f"RECORDED\t{prop_move.RECORD}\t" in text
    # A page of the same name in another chapter is a page the move never dealt with: offered.
    write_tree(vault, {"Chapters/Chapter 2 - The Shore/Props/gull-letter.html": BUILT_LETTER})
    (item,) = migrate_site.find_props_move(vault)
    assert any("1 hand-made page in Props folders" in ln for ln in item.lines), item.lines
    assert prop_move._handmade_pages(prop_move.new_conversion(vault)) == ["Chapters/Chapter 2 - The Shore/Props/gull-letter.html"]


def test_a_vault_that_answered_leave_is_offered_as_before(tmp_path: Path) -> None:
    import migrate_site
    vault, _site = build_props_vault(tmp_path)
    (item,) = migrate_site.find_props_move(vault)
    assert item.apply("leave") == ["left the props where they are; nothing moved"]
    (again,) = migrate_site.find_props_move(vault)
    assert again.lines == item.lines


def moved_like_1_10_105(tmp_path: Path) -> Path:
    """The gazetteer vault after a move made by 1.10.105: its new notes as DRAFT."""
    vault, _site = gazetteer(tmp_path)
    code, text = run_apply(vault, CHECK_PASSED)
    assert code == 0, text
    for p in vault.rglob("*.md"):
        t = p.read_text(encoding="utf-8")
        if f"canon_status: {prop_move.SETTLED}\n" in t:
            p.write_text(t.replace(f"canon_status: {prop_move.SETTLED}\n", "canon_status: DRAFT\n", 1), encoding="utf-8")
    return vault


def test_moved_drafts_are_offered_for_settling_by_name(tmp_path: Path) -> None:
    import migrate_site
    vault = moved_like_1_10_105(tmp_path)
    # A GM's own draft prop, published: written by vault_write (a body of its own, no title after relationships).
    write_tree(vault, {f"{CH4}/My Draft.md": (
        "---\nname: \"My Draft\"\ntype: prop\ncanon_status: DRAFT\nprop_kind: document\nsource: \"\"\n"
        "createdSession: \"\"\nlastUpdated: \"\"\nrelationships: []\n---\n\n## Description\n\nStill thinking.\n")})
    with mock.patch.object(prop_move, "read_state", read_state_stub):
        assert prop_move.apply_publish(vault, [f"{CH4}/My Draft.md"])[1] is None
    (item,) = migrate_site.find_props_settle(vault)
    assert (item.id, item.group, item.wants, item.holds_stamp) == ("props-settle", migrate_site.CHOICE, "settle or leave", True)
    named = [ln.split("\t")[0] for ln in item.lines[1:]]
    listed = (vault / "_meta" / "publish-list.yaml").read_text(encoding="utf-8")
    assert f"{CH4}/dinner-menu.md" in named and f"{NOTES}/shelf/Tide Tables.md" in named
    assert f"{CH4}/sealed-letter.md" not in named          # held: not published
    assert f"{CH4}/My Draft.md" not in named               # the GM's own
    assert all(rel in listed for rel in named)
    before = (vault / CH4 / "My Draft.md").read_bytes()
    done = item.apply("settle")
    assert len(done) == len(named)
    for rel in named:
        assert fm_of((vault / rel).read_text(encoding="utf-8"))["canon_status"] == prop_move.SETTLED, rel
    assert fm_of((vault / CH4 / "sealed-letter.md").read_text(encoding="utf-8"))["canon_status"] == "DRAFT"
    assert (vault / CH4 / "My Draft.md").read_bytes() == before
    # Once settled, nothing is offered.
    assert migrate_site.find_props_settle(vault) == []
    check = next(c for c in migrate_site.SITE_CHECKS if c.name == "props-settle")
    assert (check.release, check.band, check.asks_site, check.choices) == ("1.10.106", 4, True, ("props-settle=",))


def test_an_already_promoted_vault_is_not_offered(tmp_path: Path) -> None:
    import migrate_site
    vault, _site = gazetteer(tmp_path)
    code, text = run_apply(vault, CHECK_PASSED)       # this release's move: live notes are settled already
    assert code == 0, text
    assert migrate_site.find_props_settle(vault) == []


def test_settle_leaves_notes_the_gm_has_touched_or_a_session_revealed(tmp_path: Path) -> None:
    import migrate_site
    vault = moved_like_1_10_105(tmp_path)
    menu, quay = vault / CH4 / "dinner-menu.md", vault / CH4 / "quay-notice.md"
    menu.write_text(menu.read_text(encoding="utf-8") + "\nThe GM's own words.\n", encoding="utf-8")
    log = json.loads((vault / "_meta" / "reveals.json").read_text(encoding="utf-8"))
    log["entries"].append({"session": "Session 3", "published": [f"{CH4}/quay-notice.md"], "released": []})
    (vault / "_meta" / "reveals.json").write_text(json.dumps(log), encoding="utf-8")
    (item,) = migrate_site.find_props_settle(vault)
    named = [ln.split("\t")[0] for ln in item.lines[1:]]
    assert f"{CH4}/dinner-menu.md" not in named and f"{CH4}/quay-notice.md" not in named
    assert f"{CH3}/hill-letter.md" in named
    assert item.apply("leave") == ["left the moved prop notes as DRAFT"]
    assert fm_of(quay.read_text(encoding="utf-8"))["canon_status"] == "DRAFT"
    # No reveals log with a before-tracking entry: nothing is offered.
    (vault / "_meta" / "reveals.json").unlink()
    assert migrate_site.find_props_settle(vault) == []


def test_settle_names_what_it_changed_when_it_stops_partway(tmp_path: Path) -> None:
    import migrate_core
    import migrate_site
    vault = moved_like_1_10_105(tmp_path)
    (item,) = migrate_site.find_props_settle(vault)
    rels = [ln.split("\t")[0] for ln in item.lines[1:]]
    assert "published, still as the move wrote them, never revealed by a session" in item.lines[0]
    assert "already live" not in item.lines[0]
    # The third note stops being DRAFT behind the item's back.
    third = vault / rels[2]
    third.write_text(third.read_text(encoding="utf-8").replace("canon_status: DRAFT", "canon_status: STUB", 1), encoding="utf-8")
    try:
        item.apply("settle")
    except migrate_core.StepFailed as e:
        said = str(e)
    else:
        raise AssertionError("settle went through")
    assert said.startswith(f"{rels[2]} was not settled (")
    assert said.endswith(f"settled before it: {rels[0]}, {rels[1]}"), said
