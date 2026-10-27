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
    vault = vault_with(tmp_path, {"Documents/Ghost.md": ghost, "Documents/Odd.md": odd})
    c = prop_move.convert(vault)
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert any("Documents/Ghost.md" in r and "hand ghost" in r and "font-family" in r for r in person)
    assert any("Documents/Odd.md" in r and "Odd_One-hand" in r for r in person)
    # No hand is registered for either, but both notes still convert.
    assert "_meta/prop-hands.json" not in c.batch.texts
    assert sorted(c.build_props) == ["Documents/Ghost.md", "Documents/Odd.md"]


# --- hand-made pages and kept folders (15b) -------------------------------------

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
<body><a href="index.html">Back</a><img src="assets/port-map.svg" alt="The Port and its Quays"></body></html>
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
    "moon-almanac": {"title": "Moon Almanac", "line": "Locked in its case.", "status": "shelved", "cover": None}}}
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
        "_meta/publish-list.yaml": "publish:\n  - Documents/Dinner_Menu.md\nexclude: []\nundecided: []\n",
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
    assert "[[Sealed_Letter]]" in c.batch.texts[rel]
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
    for rel in ("guide.html", "maps.html", "index.html", "assets/paper.jpg", "assets/port-map.svg"):
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
