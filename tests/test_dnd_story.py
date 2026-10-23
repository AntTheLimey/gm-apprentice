#!/usr/bin/env python3
"""Tests for dnd_story: safe player text, the Background sub-sections, who owns the text."""

import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import dnd_story as ds  # noqa: E402
from dnd_story import (MEMORY, Story, fingerprint, from_plain, memory_entries, memory_from,  # noqa: E402
                       note_parts, plan_story, source_parts)

MARKDOWN_IT = ROOT / "tools" / "publish" / "node_modules" / "markdown-it"
ALLOWED_TAGS = {"p", "ul", "li", "br"}
HOSTILE = "# Chapter One\n<script>x</script>\n[[Waterdeep]] ![[x.png]]\n<!-- gm-only -->\n| a | b |\n---\n```\n"

NOTE = """---
name: Brannoch
gender:
---
# Brannoch

## Background

**Species:** Dwarf

### Backstory

{BACKSTORY}

### Appearance

{APPEARANCE}

**Age:** — · **Height:** — · **Weight:** — · **Eyes:** — · **Hair:** — · **Skin:** — · **Faith:** —

### Personality

- **Traits:** —
- **Ideals:** —
- **Bonds:** —
- **Flaws:** —

## Notes

Kept.
"""
EMPTY = {"BACKSTORY": "{The player's backstory.}", "APPEARANCE": "{Physical description.}"}


def note(**fill: str) -> str:
    text = NOTE
    for key, value in {**EMPTY, **fill}.items():
        text = text.replace("{" + key + "}", value)
    return text


def body(text: str, part: str) -> str:
    span = note_parts(text)[part]
    assert span is not None
    return span.body


def rows_of(plan: ds.StoryPlan) -> list[tuple[str, str]]:
    return [(status, locus) for status, locus, _ in plan.rows]


def synced(text: str, story: Story) -> ds.StoryPlan:
    """A first sync, then the memory it leaves."""
    return plan_story(text, story, None)


# --- safe text -----------------------------------------------------------------------------

class Tags(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: set[str] = set()
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        self.tags.add(tag)

    def handle_data(self, data: str) -> None:
        self.text.append(data)


def render(markdown: str) -> str:
    script = ("const MarkdownIt = require(process.argv[1]);"
              "const md = new MarkdownIt({ html: false });"
              "process.stdout.write(md.render(require('fs').readFileSync(0, 'utf8')));")
    return subprocess.run(["node", "-e", script, str(MARKDOWN_IT)], input=markdown, capture_output=True,
                          text=True, check=True, encoding="utf-8").stdout


def test_markup_prints_as_typed():
    out = from_plain(HOSTILE)
    for bad in ("\n#", "<script", "[[", "![[", "<!--", "\n|", "\n---", "\n```"):
        assert bad not in "\n" + out
    if shutil.which("node") is None or not MARKDOWN_IT.is_dir():
        pytest.skip("node or the publish tool's markdown-it is not available")
    tags = Tags()
    tags.feed(render(out))
    assert tags.tags <= ALLOWED_TAGS
    assert " ".join("".join(tags.text).split()) == " ".join(HOSTILE.split())


def test_every_syntax_character_prints_as_typed():
    src = "a ==b== c\n$x$ and $5\n$$\nE=mc^2\n$$\nend ^abc\n1. one\n+ plus\n= eq\n== h ==\n\\*not bold\\* *x* _y_ ~~z~~ & &amp; 2) two\n>quote\n    indented\n%%c%%"
    out = from_plain(src)
    if shutil.which("node") is None or not MARKDOWN_IT.is_dir():
        pytest.skip("node or the publish tool's markdown-it is not available")
    tags = Tags()
    tags.feed(render(out))
    assert tags.tags <= ALLOWED_TAGS
    assert " ".join("".join(tags.text).split()) == " ".join(src.split())


def test_wording_of_write_messages():
    plan = synced(note(), STORY)
    said = {locus: msg for _, locus, msg in plan.rows}
    assert said["Background / Appearance"] == "from D&D Beyond (1 paragraph)"
    assert said["Background / Appearance / Facts"] == "from D&D Beyond"
    assert said["Background / Personality / Flaws"] == "from D&D Beyond"


def test_unreadable_frontmatter_is_check_for_gender():
    text = note().replace("gender:\n", "gender:\n  - [broken\n", 1).replace("---\n# Brannoch", "# Brannoch", 1)
    plan = synced(text, STORY)
    assert ("CHECK", "Frontmatter / gender",
            "the frontmatter could not be read; gender was not written") in plan.rows
    assert "Female" not in plan.text


def test_paragraphs_and_dash_lists():
    assert from_plain("One.\n\nTwo.\n - a\n- b") == "One.\n\nTwo.\n\n- a\n- b"


def test_line_breaks_inside_a_paragraph_stay():
    assert from_plain("Dear Sir,\nYours") == "Dear Sir,\\\nYours"


def test_a_dash_without_a_space_is_text():
    assert from_plain("---") == "\\---"
    assert from_plain("-quick") == "\\-quick"


def test_control_characters_dropped():
    assert from_plain("a\x00b\x1bc") == "abc"
    assert from_plain("a\x0bb\x85c d") == "abc\\\nd"


def test_fingerprint_ignores_line_endings_and_trailing_space():
    assert fingerprint("a  \r\nb\r\n") == fingerprint("a\nb")
    assert fingerprint("\n\na\n\n") == fingerprint("a")
    assert fingerprint("a") != fingerprint("b")
    assert len(fingerprint("a")) == 16


# --- the parts -----------------------------------------------------------------------------

def test_parts_are_found_with_their_text():
    text = note(BACKSTORY="Born in a forge.\n\nLeft it.", APPEARANCE="Short and broad.")
    parts = note_parts(text)
    assert set(parts) == set(ds.PARTS)
    assert body(text, "backstory") == "Born in a forge.\n\nLeft it."
    assert body(text, "appearance") == "Short and broad."
    assert body(text, "facts").startswith("**Age:** —")
    assert body(text, "traits") == "—"
    lines = text.splitlines(keepends=True)
    span = parts["flaws"]
    assert span is not None and lines[span.start].startswith("- **Flaws:**") and span.end == span.start + 1


def test_missing_parts_are_none_and_headings_inside_code_are_not_headings():
    text = "## Background\n\n### Backstory\n\n```\n### Appearance\n```\n\nText\n"
    parts = note_parts(text)
    assert parts["backstory"] is not None and parts["appearance"] is None and parts["traits"] is None
    assert note_parts("## Other\n\n### Backstory\n\nx\n")["backstory"] is None


def test_a_subsection_ends_at_a_heading_of_level_three_or_less():
    text = "## Background\n\n### Backstory\n\nA\n\n#### Deeper\n\nB\n\n# Top\n\nC\n"
    assert body(text, "backstory") == "A\n\n#### Deeper\n\nB"


def test_source_parts():
    parts = source_parts(Story(backstory="Hi *there*", facts={"Age": "60", "Faith": "Moradin"}, traits="Gruff\nand loud",
                               flaws="x"))
    assert parts["backstory"] == "Hi \\*there\\*"
    assert parts["appearance"] == ""
    assert parts["facts"] == ("**Age:** 60 · **Height:** — · **Weight:** — · **Eyes:** — · **Hair:** — · "
                              "**Skin:** — · **Faith:** Moradin")
    assert parts["traits"] == "Gruff and loud" and parts["ideals"] == "" and parts["flaws"] == "x"
    assert source_parts(Story())["facts"] == ""


# --- who owns the text ---------------------------------------------------------------------

STORY = Story(backstory="Born in a forge.\n\nLeft it.", appearance="Short.", facts={"Age": "60"},
              gender="Female", traits="Gruff", ideals="Craft", bonds="Clan", flaws="Pride")


def test_first_sync_empty_part_writes():
    plan = synced(note(), STORY)
    assert ("WRITE", "Background / Backstory", "from D&D Beyond (2 paragraphs)") in plan.rows
    assert [r[1] for r in plan.rows] == [ds.LOCUS[p] for p in ds.PARTS] + ["Frontmatter / gender"]
    assert body(plan.text, "backstory") == "Born in a forge.\n\nLeft it."
    assert body(plan.text, "appearance") == "Short."
    assert body(plan.text, "facts").startswith("**Age:** 60 · **Height:** —")
    assert body(plan.text, "traits") == "Gruff" and body(plan.text, "flaws") == "Pride"
    assert "- **Ideals:** Craft\n" in plan.text
    assert "gender: \"Female\"\n" in plan.text
    assert "## Notes\n\nKept.\n" in plan.text and plan.text.count("### ") == 3
    assert set(plan.remember) == set(ds.PARTS)


def test_unchanged_source_does_nothing():
    first = synced(note(), STORY)
    again = plan_story(first.text, STORY, first.remember)
    assert again.rows == [] and again.text == first.text and again.remember == first.remember


def test_second_sync_after_a_vault_edit_still_does_nothing():
    first = synced(note(), STORY)
    edited = first.text.replace("Short.", "Short, with a scar.")
    again = plan_story(edited, STORY, first.remember)
    assert again.rows == [] and again.text == edited and again.remember == first.remember


def test_changed_source_untouched_note_writes():
    first = synced(note(), STORY)
    new = Story(**{**STORY.__dict__, "backstory": "A new tale.", "bonds": "Anvil"})
    plan = plan_story(first.text, new, first.remember)
    assert rows_of(plan) == [("WRITE", "Background / Backstory"), ("WRITE", "Background / Personality / Bonds")]
    assert body(plan.text, "backstory") == "A new tale." and body(plan.text, "bonds") == "Anvil"
    assert body(plan.text, "appearance") == "Short."
    assert plan_story(plan.text, new, plan.remember).rows == []


def test_both_changed_is_check():
    first = synced(note(), STORY)
    edited = first.text.replace("Short.", "Short, with a scar.")
    new = Story(**{**STORY.__dict__, "appearance": "Tall."})
    plan = plan_story(edited, new, first.remember)
    assert plan.rows == [("CHECK", "Background / Appearance",
                          "the player changed this on D&D Beyond and it was also edited in the vault; "
                          "compare them, nothing was written")]
    assert plan.text == edited
    # this player version is now seen; the note fingerprint stays as last synced
    assert plan.remember["appearance"] == (fingerprint("Tall."), first.remember["appearance"][1])


def both_changed():
    first = synced(note(), STORY)
    edited = first.text.replace("Short.", "Short, with a scar.")
    new = Story(**{**STORY.__dict__, "appearance": "Tall."})
    return first, edited, new, plan_story(edited, new, first.remember)


def test_check_fires_once_per_player_version():
    _, edited, new, plan = both_changed()
    again = plan_story(edited, new, plan.remember)
    assert again.rows == [] and again.text == edited and again.remember == plan.remember


def test_later_player_change_checks_again_and_never_writes():
    _, edited, new, plan = both_changed()
    newer = Story(**{**STORY.__dict__, "appearance": "Taller."})
    third = plan_story(edited, newer, plan.remember)
    assert rows_of(third) == [("CHECK", "Background / Appearance")] and third.text == edited
    assert plan_story(edited, newer, third.remember).rows == []
    newest = Story(**{**STORY.__dict__, "appearance": ""})
    fourth = plan_story(edited, newest, third.remember)
    assert rows_of(fourth) == [("CHECK", "Background / Appearance")] and fourth.text == edited


def test_gm_pastes_player_text_plus_aside_is_never_overwritten():
    first = synced(note(), STORY)
    new = Story(**{**STORY.__dict__, "appearance": "Tall."})
    pasted = first.text.replace("Short.", "Tall.\n\nGM: she limps.")
    plan = plan_story(pasted, new, first.remember)
    assert rows_of(plan) == [("CHECK", "Background / Appearance")]
    assert plan_story(pasted, new, plan.remember).rows == []
    newer = Story(**{**STORY.__dict__, "appearance": "Taller."})
    again = plan_story(pasted, newer, plan.remember)
    assert rows_of(again) == [("CHECK", "Background / Appearance")] and again.text == pasted


def test_gm_pastes_exactly_the_new_player_text_settles_silently():
    first, edited, new, plan = both_changed()
    pasted = edited.replace("Short, with a scar.", "Tall.")
    settled = plan_story(pasted, new, plan.remember)
    assert settled.rows == [] and settled.text == pasted
    assert settled.remember["appearance"] == (fingerprint("Tall."), fingerprint("Tall."))


def test_both_changed_then_made_equal_settles():
    first = synced(note(), STORY)
    new = Story(**{**STORY.__dict__, "appearance": "Tall."})
    plan = plan_story(first.text.replace("Short.", "Tall."), new, first.remember)
    assert plan.rows == [] and plan.remember["appearance"][0] == fingerprint("Tall.")
    assert plan_story(plan.text, new, plan.remember).rows == []


def test_first_sync_part_with_text_is_check_and_remembers():
    text = note(BACKSTORY="Mine, written by the GM.")
    plan = synced(text, STORY)
    assert ("CHECK", "Background / Backstory",
            "the note already has text here; nothing was written, and the next change on D&D Beyond will be") in plan.rows
    assert body(plan.text, "backstory") == "Mine, written by the GM."
    assert plan.remember["backstory"] == (fingerprint(source_parts(STORY)["backstory"]),
                                          fingerprint("Mine, written by the GM."))
    new = Story(**{**STORY.__dict__, "backstory": "Changed at the source."})
    later = plan_story(plan.text, new, plan.remember)
    assert ("WRITE", "Background / Backstory") in rows_of(later)    # the next player change is seen
    assert body(later.text, "backstory") == "Changed at the source."
    edited = plan.text.replace("Mine, written by the GM.", "Mine, and then some.")
    assert ("CHECK", "Background / Backstory") in rows_of(plan_story(edited, new, plan.remember))


def test_first_sync_text_the_source_already_says_is_quiet():
    text = note(BACKSTORY="Born in a forge.\n\nLeft it.")
    plan = synced(text, STORY)
    assert ("CHECK", "Background / Backstory") not in rows_of(plan)


def test_lost_memory_writes_nothing_and_checks():
    first = synced(note(), STORY)
    new = Story(**{**STORY.__dict__, "backstory": "A new tale."})
    plan = plan_story(first.text, new, None)
    assert ("CHECK", "Background / Backstory") in rows_of(plan)
    assert [r for r in plan.rows if r[0] == "WRITE"] == []
    assert plan.text == first.text
    assert set(plan.remember) == set(ds.PARTS)


def test_source_emptied_clears_part():
    first = synced(note(), STORY)
    new = Story(**{**STORY.__dict__, "backstory": "", "facts": {}, "traits": ""})
    plan = plan_story(first.text, new, first.remember)
    assert rows_of(plan) == [("WRITE", "Background / Backstory"), ("WRITE", "Background / Appearance / Facts"),
                             ("WRITE", "Background / Personality / Traits")]
    assert body(plan.text, "backstory") == ""
    assert body(plan.text, "facts") == " · ".join(f"**{label}:** —" for label in ds.FACTS)
    assert body(plan.text, "traits") == "—"
    assert "### Backstory\n\n### Appearance\n" in plan.text
    assert plan_story(plan.text, new, plan.remember).rows == []


def test_missing_subsection_is_check():
    text = "---\nname: X\ngender:\n---\n## Background\n\n**Backstory & Personality:** Old line.\n\n## Notes\n"
    plan = synced(text, STORY)
    assert plan.text == text.replace("gender:\n", 'gender: "Female"\n')
    checks = [r for r in plan.rows if r[0] == "CHECK"]
    assert len(checks) == len(ds.PARTS) and not any(r[0] == "ERROR" for r in plan.rows)
    assert ("CHECK", "Background / Backstory",
            "the note has no ### Backstory under Background; run the vault upgrade (migrate.py), "
            "nothing was written") in plan.rows
    assert plan.remember == {}


def test_missing_bullet_in_an_existing_section_is_check():
    text = note().replace("- **Flaws:** —\n", "")
    plan = synced(text, STORY)
    assert ("CHECK", "Background / Personality / Flaws") in rows_of(plan)
    assert "Flaws" not in plan.text.split("### Personality")[1].split("## Notes")[0]


def test_nothing_to_say_about_a_missing_part_the_source_leaves_empty():
    text = "## Background\n\n### Backstory\n\n{x}\n"
    assert synced(text, Story(backstory="Hello")).rows == [("WRITE", "Background / Backstory",
                                                           "from D&D Beyond (1 paragraph)")]


def test_gender_only_fills_a_blank():
    text = note().replace("gender:\n", "gender: Male\n")
    plan = synced(text, STORY)
    assert "gender: Male\n" in plan.text and ("WRITE", "Frontmatter / gender") not in rows_of(plan)
    assert "gender" not in " ".join(r[1] for r in synced(note().replace("gender:\n", ""), STORY).rows).lower()


def test_hostile_text_does_not_change_the_notes_structure():
    plan = synced(note(), Story(backstory=HOSTILE, traits="# x | y\n- z", gender="a\nb: c"))
    before, after = note_parts(note()), note_parts(plan.text)
    assert [l for l in plan.text.splitlines() if l.startswith("#")] == \
           [l for l in note().splitlines() if l.startswith("#")]
    assert "<!--" not in plan.text and "<script" not in plan.text and "[[" not in plan.text
    assert after["traits"] is not None and after["traits"].body == "\\# x \\| y - z"
    assert "gender: \"a b: c\"\n" in plan.text
    assert before.keys() == after.keys()


def test_crlf_note_keeps_its_line_endings():
    text = note().replace("\n", "\r\n")
    plan = synced(text, STORY)
    assert plan.text.count("\n") == plan.text.count("\r\n")
    assert body(plan.text, "backstory").replace("\r\n", "\n") == "Born in a forge.\n\nLeft it."
    assert plan_story(plan.text, STORY, plan.remember).rows == []


def test_long_crlf_backstory_is_stable():
    long = "\n\n".join(("Paragraph %d. " % n) + "word " * 100 for n in range(12))
    story = Story(backstory=long)
    plan = synced(note().replace("\n", "\r\n"), story)
    assert len(long) > 6000 and ("WRITE", "Background / Backstory") in rows_of(plan)
    again = plan_story(plan.text, story, plan.remember)
    assert again.rows == [] and again.text == plan.text


def test_placeholders_count_as_empty_for_every_part():
    text = note().replace("- **Traits:** —", "- **Traits:** {Two or three traits.}")
    assert ("WRITE", "Background / Personality / Traits") in rows_of(synced(text, STORY))


# --- sync's memory -------------------------------------------------------------------------

def test_memory_round_trip():
    plan = synced(note(), STORY)
    entries = memory_entries(plan.remember)
    assert len(entries) == 7 and entries[0].startswith("backstory\t")
    assert memory_from({MEMORY: entries}) == plan.remember
    assert memory_from(None) is None and memory_from({"cells": []}) is None
    assert memory_from({MEMORY: ["nonsense", "x\ty\tz"]}) == {}


def test_the_shared_template_and_the_reader_agree():
    template = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
    assert all(note_parts(template).values())
    story = Story(backstory="Born in a forge.", appearance="Broad.", facts={"age": "41", "faith": "Moradin"},
                  traits="Gruff", ideals="Craft", bonds="Clan", flaws="Pride")
    plan = plan_story(template, story, None)
    assert [r for r in plan.rows if r[0] == "CHECK"] == []
    wrote = {r[1] for r in plan.rows if r[0] == "WRITE"}
    assert wrote == set(ds.LOCUS.values())
    assert body(plan.text, "backstory") == "Born in a forge."
