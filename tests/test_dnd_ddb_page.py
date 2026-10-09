#!/usr/bin/env python3
"""The published D&D page reads what dnd_ddb.sync_text writes. Runs the publish tool's build through
Node into a pytest tmp_path; skipped when Node is not installed. No network, no deploy."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from ddb_builder import character, weapon  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
BUILD_LIB = ROOT / "tools" / "publish" / "lib" / "build"
NODE = shutil.which("node")
# VAULT_CHECK_REQUIRE_NODE turns a missing Node into a failure, as the migrate tests do.
needs_node = pytest.mark.skipif(NODE is None and not os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                                reason="node is not installed")
BUILD_JS = "require(process.argv[1]).build({configPath: process.argv[2]})"
HAND_ROW = "| Abbot Blade | 1 | | |"
SPELLS = (("Fire Bolt", 0, True, False, False, False, (1, 2), "Wizard"),
          ("Shield", 1, True, False, False, False, (1, 2), "Wizard"),
          ("Fireball", 3, True, False, False, False, (1, 2), "Wizard"))
INVENTORY = (("Rope, Hempen", 1, 10, False, False, "gear"), ("Torch", 3, 1, False, False, "gear"),
             ("Moon Ring", 1, 0, True, True, "gear", True, 3, 2), ("Dagger", 1, 1, False, False, "weapon"))


def wizard_five(**more):
    """An invented Wizard 5: three spells, gear, one attuned magic item with charges, one feat, a dagger."""
    fields = dict(hit_points={"base": 25}, spells=SPELLS, inventory=INVENTORY, feats=(("Alert",),),
                  item_details={"Dagger": weapon("1d4", "Piercing", properties=("Finesse", "Light"))})
    return character(**{**fields, **more})


def build_site(tmp_path, notes):
    """Build a site from {file name: note text} for a D&D vault under tmp_path.
    Returns (build output, {page slug: html}). The config has no host and there is no wrangler.toml."""
    vault = tmp_path / "vault"
    (vault / "Characters" / "PCs").mkdir(parents=True)
    for file_name, text in notes.items():
        (vault / "Characters" / "PCs" / file_name).write_text(text, encoding="utf-8", newline="\n")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({
        "vaultPath": str(vault), "outputDir": str(tmp_path / "docs"), "attachmentsDir": "_attachments",
        "siteTitle": "D&D Page Test", "system": "dnd-5e-2024", "excludeDirs": ["_meta", "_Templates"],
        "excludeSections": ["GM Notes"], "folderMap": {"Characters/PCs": "characters/pcs"}}), encoding="utf-8")
    done = subprocess.run([NODE, "-e", BUILD_JS, str(BUILD_LIB), str(config)], capture_output=True, text=True,
                          encoding="utf-8", timeout=180, cwd=str(tmp_path))
    assert done.returncode == 0, done.stderr
    pages = {p.stem: p.read_text(encoding="utf-8") for p in (tmp_path / "docs" / "characters" / "pcs").glob("*.html")
             if p.stem != "index"}
    return done.stdout + done.stderr, pages


def warnings(output):
    """The build's WARNING lines other than the standing one about settings in vault.config.json."""
    return [ln.strip() for ln in output.splitlines() if "WARNING" in ln and "vault.config.json still holds" not in ln]


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    if NODE is None:
        pytest.skip("node is not installed")
    first = sync_text(TEMPLATE, wizard_five())
    synced = first.text
    assert "| Torch | 3 | 1 lb | |" in synced
    note = synced.replace("| Torch | 3 | 1 lb | |", "| Torch | 3 | 1 lb | |\n" + HAND_ROW, 1)
    once = sync_text(note, wizard_five(), first.seen)
    twice = sync_text(once.text, wizard_five(), once.seen)
    assert HAND_ROW in twice.text and not [r for r in twice.rows + once.rows if "Abbot" in r[1]]
    output, pages = build_site(tmp_path_factory.mktemp("page"), {"Tavin_Reedmere.md": twice.text})
    return output, pages["tavin-reedmere"], twice.text


@needs_node
def test_the_page_shows_the_level_spells_items_and_feat(site):
    _, html, _ = site
    assert "Level 5" in html
    for name in ("Fire Bolt", "Shield", "Fireball", "Alert", "Rope, Hempen", "Torch", "Moon Ring", "Dagger"):
        assert f'<span class="dnd5e-entry-name">{name}</span>' in html, name


@needs_node
def test_the_page_draws_the_slot_totals_sync_wrote(site):
    _, html, _ = site
    for level, total in (("1st", 4), ("2nd", 3), ("3rd", 2)):
        assert f'aria-label="Spell slots, {level}: {total} of {total} left"' in html, level
    assert "Spell slots, 4th" not in html


@needs_node
def test_the_page_shows_armour_class_hit_point_maximum_and_an_attack_line(site):
    _, html, note = site
    assert '<span class="dnd5e-lbl">AC</span><span class="dnd5e-num">12</span>' in html
    assert '<span class="dnd5e-of">/ 35</span>' in html
    assert "| Dagger | +2 | 1d4+2 piercing | |" in note
    assert '<span class="dnd5e-num">+2</span> <span class="dnd5e-dmg">1d4+2 piercing</span>' in html


@needs_node
def test_the_build_names_no_warning_for_the_synced_pc(site):
    output, _, _ = site
    assert warnings(output) == []
    assert "tavin-reedmere" not in "\n".join(ln for ln in output.splitlines() if "WARNING" in ln)


@needs_node
def test_the_hand_added_row_is_on_the_page_by_its_plain_name_after_two_syncs(site):
    _, html, text = site
    assert HAND_ROW in text
    assert '<span class="dnd5e-entry-name">Abbot Blade</span>' in html
    assert "gift of the abbot" not in html


@pytest.fixture(scope="module")
def ringbearer(tmp_path_factory):
    """A slow character with a save bonus from an item: the two things sync writes that the first note lacks."""
    if NODE is None:
        pytest.skip("node is not installed")
    data = wizard_five(speed=20, inventory=INVENTORY + (("Cloak of Protection", 1, 3, True, True, "gear"),),
                       modifiers=(("item", "bonus", "saving-throws", 1, {"item": "Cloak of Protection"}),))
    text = sync_text(TEMPLATE, data).text
    assert "| Speed | 20 ft |" in text and "| Saves | +1 | Cloak of Protection |" in text
    output, pages = build_site(tmp_path_factory.mktemp("ringbearer"), {"Tavin_Reedmere.md": text})
    return output, pages["tavin-reedmere"]


@needs_node
def test_the_page_reads_the_speed_sync_wrote(ringbearer):
    _, html = ringbearer
    assert '<span class="dnd5e-lbl">Speed</span><span class="dnd5e-num">20 ft</span>' in html


@needs_node
def test_the_page_shows_the_bonus_row_sync_wrote_and_warns_of_nothing(ringbearer):
    output, html = ringbearer
    block = re.search(r'<section class="dnd5e-blk dnd5e-blk-bonuses">.*?</section>', html, re.S).group(0)
    assert block.count('class="dnd5e-entry"') == 1
    assert '<span class="dnd5e-entry-name">Cloak of Protection</span>' in block and "Saves" in block and "+1" in block
    assert warnings(output) == []
