#!/usr/bin/env python3
"""The Image Guidance note: its template and `image_guidance.read` / `compose`."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import image_guidance  # noqa: E402

REL = "_Campaign/Image_Guidance.md"
NOTE = (
    "---\ntype: meta\n---\n# Image Guidance\n<!-- gm-only -->\n"
    "## Direction\nShow the worst moment.\n"
    "## Always\nRegency, 1814. No electric light.\n"
    "## Blocks\n### Oil\nDark Romantic oil painting.\n"
    "### Ink & wash\nPen and ink with sepia wash.\n<!-- /gm-only -->\n"
)


def write_and_read(tmp_path, text, rel=REL):
    path = tmp_path / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return image_guidance.read(tmp_path, rel)


def test_reads_always_and_blocks(tmp_path):
    g = write_and_read(tmp_path, NOTE)
    assert g.found and g.always == "Regency, 1814. No electric light."
    assert g.blocks == {"oil": "Dark Romantic oil painting.",
                        "ink & wash": "Pen and ink with sepia wash."}


def test_direction_is_never_in_a_prompt(tmp_path):
    prompt, missing = image_guidance.compose(
        write_and_read(tmp_path, NOTE), ["Oil"], "A man on a dock.")
    assert prompt == ("Regency, 1814. No electric light.\n\n"
                      "Dark Romantic oil painting.\n\nA man on a dock.")
    assert "worst moment" not in prompt and missing == []


def test_unknown_block_is_named_not_fatal(tmp_path):
    g = write_and_read(tmp_path, NOTE)
    prompt, missing = image_guidance.compose(g, ["Oil", "Etching"], "S.")
    assert missing == ["Etching"]
    assert "Dark Romantic oil painting." in prompt


def test_blocks_come_in_the_order_asked(tmp_path):
    g = write_and_read(tmp_path, NOTE)
    prompt, _ = image_guidance.compose(g, ["ink & wash", "OIL"], "S.")
    assert prompt.index("Pen and ink") < prompt.index("Dark Romantic")


def test_template_placeholders_are_not_sent(tmp_path):
    text = (SCRIPTS.parent / "templates" / "image-guidance.md").read_text(
        encoding="utf-8")
    g = write_and_read(tmp_path, text)
    assert g.found and g.always == "" and g.blocks == {}


def test_no_note(tmp_path):
    g = image_guidance.read(tmp_path, REL)
    assert g == image_guidance.Guidance("", {}, False)
    assert image_guidance.compose(g, ["Oil"], "A dock.") == ("A dock.", ["Oil"])


def test_a_heading_in_a_code_block_is_not_a_block(tmp_path):
    text = NOTE.replace(
        "### Oil\n",
        "### Oil\n```\n### Fake\nnot a block\n```\n")
    g = write_and_read(tmp_path, text)
    assert "fake" not in g.blocks
    assert "not a block" in g.blocks["oil"]
