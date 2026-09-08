#!/usr/bin/env python3
"""Regression tests for ingest_images.py — vault-ingest image filing.

Covers slug matching (exact, suffix-stripped, ambiguous), the portrait vs.
body-embed decision table from image-handling.md, duplicate detection
(identical-skip vs. flagged-differs), never overwriting an existing
portrait, and dry-run vs. --execute side effects.

Conversion (sips/magick) is exercised only via a monkeypatched "no
converter available" path — real conversion depends on tools this test
environment may not have, and asserting its output would make the suite
flaky across machines.

Run: python tests/test_ingest_images.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "ingest_images.py"
sys.path.insert(0, str(SCRIPTS))

import ingest_images as ii  # noqa: E402


def note(fm_lines: str, body: str = "") -> str:
    return f"---\n{fm_lines}\n---\n\n{body}"


class ScriptCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.vault = self.tmp / "vault"
        self.dir = self.tmp / "dropbox"
        self.vault.mkdir()
        self.dir.mkdir()

    def entity(self, rel: str, etype: str, portrait: str = "") -> Path:
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        fm = f"type: {etype}\ncanon_status: DRAFT\nportrait: \"{portrait}\""
        path.write_text(note(fm, f"# {Path(rel).stem}\n"), encoding="utf-8")
        return path

    def image(self, rel: str, content: bytes = b"\xff\xd8\xff\xe0fake") -> Path:
        path = self.dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def run_script(self, *args: str, rc: int = 0) -> str:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.vault), str(self.dir), *args],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(
            proc.returncode, rc,
            f"args={args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
        return proc.stdout


class SlugifyTests(unittest.TestCase):
    def test_spaces_and_underscores_become_hyphens(self):
        self.assertEqual(ii.slugify("Ronnie Vint_Young"), "ronnie-vint-young")

    def test_consecutive_hyphens_collapse(self):
        self.assertEqual(ii.slugify("A  B__C"), "a-b-c")

    def test_strip_suffix_drops_last_segment_only(self):
        self.assertEqual(ii.strip_suffix("ronnie-vint-young"), "ronnie-vint")
        self.assertEqual(ii.strip_suffix("ronnie"), None)


class SingleMatchTests(ScriptCase):
    def test_single_match_becomes_portrait_and_files_the_image(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("ronnie-vint.jpg")
        out = self.run_script("--execute")
        self.assertIn("FILED\tronnie-vint.jpg\tronnie-vint\t"
                      "Characters/Ronnie Vint.md\t"
                      "_attachments/characters/ronnie-vint.jpg\tportrait", out)
        dest = self.vault / "_attachments" / "characters" / "ronnie-vint.jpg"
        self.assertTrue(dest.exists())
        text = (self.vault / "Characters/Ronnie Vint.md").read_text(
            encoding="utf-8")
        self.assertIn(
            'portrait: "_attachments/characters/ronnie-vint.jpg"', text)

    def test_dry_run_reports_would_file_and_writes_nothing(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("ronnie-vint.jpg")
        out = self.run_script()
        self.assertIn("WOULD-FILE\tronnie-vint.jpg", out)
        self.assertFalse(
            (self.vault / "_attachments" / "characters" / "ronnie-vint.jpg")
            .exists())
        text = (self.vault / "Characters/Ronnie Vint.md").read_text(
            encoding="utf-8")
        self.assertIn('portrait: ""', text)

    def test_suffix_stripped_match_still_finds_the_entity(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("ronnie-vint-young.jpg")
        out = self.run_script("--execute")
        self.assertIn("Characters/Ronnie Vint.md", out)
        dest = (self.vault / "_attachments" / "characters"
                / "ronnie-vint-young.jpg")
        self.assertTrue(dest.exists())

    def test_unmatched_image_is_flagged_not_filed(self):
        self.image("mystery-npc.jpg")
        out = self.run_script("--execute")
        self.assertIn("UNMATCHED\tmystery-npc.jpg\tmystery-npc", out)
        self.assertFalse((self.vault / "_attachments").exists())

    def test_unconvertible_non_web_safe_image_is_skipped_not_filed(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("ronnie-vint.heic", b"not-actually-a-heic-file")
        out = self.run_script("--execute")
        self.assertIn("SKIP-NO-CONVERTER\tronnie-vint.heic\tronnie-vint\t"
                      "Characters/Ronnie Vint.md", out)
        self.assertFalse(
            (self.vault / "_attachments" / "characters"
             / "ronnie-vint.jpg").exists())


class MultiMatchTests(ScriptCase):
    def test_unsuffixed_wins_portrait_others_get_body_embed(self):
        self.entity("Locations/Old Manor.md", "location")
        self.image("old-manor.jpg")
        self.image("old-manor-night.jpg")
        out = self.run_script("--execute")
        self.assertIn("old-manor.jpg\told-manor\tLocations/Old Manor.md\t"
                      "_attachments/locations/old-manor.jpg\tportrait", out)
        self.assertIn("old-manor-night.jpg", out)
        self.assertIn("body-embed", out)
        text = (self.vault / "Locations/Old Manor.md").read_text(
            encoding="utf-8")
        self.assertIn('portrait: "_attachments/locations/old-manor.jpg"',
                      text)
        self.assertIn("## Attachments", text)
        self.assertIn("![[old-manor-night.jpg]]", text)

    def test_all_suffixed_defers_portrait_to_keeper_interview(self):
        self.entity("Locations/Old Manor.md", "location")
        self.image("old-manor-night.jpg")
        self.image("old-manor-day.jpg")
        out = self.run_script("--execute")
        self.assertIn("portrait-ambiguous", out)
        text = (self.vault / "Locations/Old Manor.md").read_text(
            encoding="utf-8")
        self.assertIn('portrait: ""', text)


class ExistingPortraitTests(ScriptCase):
    def test_existing_portrait_is_never_overwritten(self):
        self.entity("Characters/Katherine Winslow.md", "pc",
                    portrait="_attachments/characters/katherine-winslow.jpg")
        self.image("katherine-winslow.jpg")
        out = self.run_script("--execute")
        self.assertIn("body-embed (entity already has a portrait)", out)
        text = (self.vault / "Characters/Katherine Winslow.md").read_text(
            encoding="utf-8")
        self.assertIn(
            'portrait: "_attachments/characters/katherine-winslow.jpg"', text)
        self.assertIn("![[katherine-winslow.jpg]]", text)


class DuplicateTests(ScriptCase):
    def test_identical_existing_file_is_skipped_silently(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        content = b"\xff\xd8\xff\xe0samebytes"
        self.image("ronnie-vint.jpg", content)
        dest = (self.vault / "_attachments" / "characters"
                / "ronnie-vint.jpg")
        dest.parent.mkdir(parents=True)
        dest.write_bytes(content)
        out = self.run_script("--execute")
        self.assertIn("DUP-SKIP\tronnie-vint.jpg", out)

    def test_different_content_same_name_is_flagged_not_replaced(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("ronnie-vint.jpg", b"\xff\xd8\xff\xe0new")
        dest = (self.vault / "_attachments" / "characters"
                / "ronnie-vint.jpg")
        dest.parent.mkdir(parents=True)
        dest.write_bytes(b"\xff\xd8\xff\xe0old")
        out = self.run_script("--execute")
        self.assertIn("DUP-FLAG\tronnie-vint.jpg", out)
        self.assertEqual(dest.read_bytes(), b"\xff\xd8\xff\xe0old")

    def test_same_filename_twice_in_one_batch_keeps_the_first(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("a/ronnie-vint.jpg")
        self.image("b/ronnie-vint.jpg")
        out = self.run_script("--execute")
        self.assertIn("SKIP-BATCH-DUP", out)


class SlugCollisionTests(ScriptCase):
    """Two differently-named sources that slugify to the same destination
    — the seen_names filename dedup does not catch this, only a
    destination-keyed check does."""

    def test_different_filenames_same_slug_different_content_flags_both(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.image("Ronnie Vint.jpg", b"\xff\xd8\xff\xe0AAAA")
        self.image("ronnie_vint.jpg", b"\xff\xd8\xff\xe0BBBB")
        out = self.run_script("--execute")
        self.assertEqual(out.count("DUP-FLAG"), 2)
        self.assertNotIn("FILED", out)
        self.assertFalse(
            (self.vault / "_attachments" / "characters"
             / "ronnie-vint.jpg").exists(),
            "neither source should be silently written over the other")

    def test_different_filenames_same_slug_identical_content_files_once(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        content = b"\xff\xd8\xff\xe0samebytes"
        self.image("Ronnie Vint.jpg", content)
        self.image("ronnie_vint.jpg", content)
        out = self.run_script("--execute")
        self.assertEqual(out.count("FILED"), 1)
        self.assertIn("SKIP-BATCH-DUP", out)
        dest = (self.vault / "_attachments" / "characters"
                / "ronnie-vint.jpg")
        self.assertEqual(dest.read_bytes(), content)


class IdempotencyTests(ScriptCase):
    def test_rerun_after_manual_portrait_pick_completes_the_ambiguous_case(self):
        self.entity("Locations/Old Manor.md", "location")
        self.image("old-manor-night.jpg", b"\xff\xd8\xff\xe0NIGHT")
        self.image("old-manor-day.jpg", b"\xff\xd8\xff\xe0DAY")

        first = self.run_script("--execute")
        self.assertEqual(first.count("portrait-ambiguous"), 2)
        note_path = self.vault / "Locations/Old Manor.md"
        text = note_path.read_text(encoding="utf-8")
        self.assertIn('portrait: ""', text)
        self.assertNotIn("## Attachments", text)

        # The GM answers the keeper interview by hand (what
        # stamp_entities.py --set portrait=... would do).
        note_path.write_text(
            text.replace(
                'portrait: ""',
                'portrait: "_attachments/locations/old-manor-day.jpg"'),
            encoding="utf-8")

        second = self.run_script("--execute")
        self.assertEqual(second.count("DUP-SKIP"), 2)
        self.assertIn("body-embed (entity already has a portrait)", second)
        final_text = note_path.read_text(encoding="utf-8")
        self.assertIn("## Attachments", final_text)
        self.assertIn("![[old-manor-night.jpg]]", final_text)
        self.assertIn("![[old-manor-day.jpg]]", final_text)


class YamlSafetyTests(ScriptCase):
    def test_quote_in_source_filename_never_corrupts_the_written_yaml(self):
        self.entity("Items/Bobs Hat.md", "item")
        self.image('bob"s hat.jpg')
        self.run_script("--execute")
        text = (self.vault / "Items/Bobs Hat.md").read_text(encoding="utf-8")
        portrait_line = next(
            line for line in text.splitlines() if line.startswith("portrait:"))
        # Exactly two quote characters on the line: the value's own wrapper.
        self.assertEqual(portrait_line.count('"'), 2)


class MalformedEntityTests(ScriptCase):
    def test_frontmatter_that_fails_the_strict_yaml_check_is_an_error_not_a_crash(self):
        path = self.vault / "Characters" / "Ronnie Vint.md"
        path.parent.mkdir(parents=True)
        # extract_frontmatter's lenient per-line scanner indexes this fine
        # (a colon-less line is silently skipped), but vaultlib's stricter
        # frontmatter_span refuses to write into it — apply_metadata must
        # surface that as an ERROR row, not raise.
        path.write_text(
            "---\ntype: npc\ncanon_status: DRAFT\n"
            "some free text line without a colon\n"
            'portrait: ""\n---\n\n# Ronnie Vint\n',
            encoding="utf-8")
        self.image("ronnie-vint.jpg")
        out = self.run_script("--execute", rc=1)
        self.assertIn("ERROR\tronnie-vint.jpg", out)
        self.assertIn("not written", out)


class CrlfEntityTests(ScriptCase):
    def test_crlf_entity_file_keeps_its_line_endings(self):
        path = self.vault / "Characters" / "Ronnie Vint.md"
        path.parent.mkdir(parents=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write('---\r\ntype: npc\r\ncanon_status: DRAFT\r\n'
                   'portrait: ""\r\n---\r\n\r\n# Ronnie Vint\r\n')
        self.image("ronnie-vint.jpg")
        self.run_script("--execute")
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
        self.assertNotIn("\r\n\n", text)  # no mixed-EOL line introduced
        self.assertIn("\r\n", text)
        for line in text.splitlines(keepends=True)[:-1]:
            self.assertTrue(line.endswith("\r\n"), repr(line))


class NonFolderTypeTests(ScriptCase):
    def test_entity_type_outside_the_filing_map_is_never_matched(self):
        path = self.vault / "Chapters" / "Chapter 1.md"
        path.parent.mkdir(parents=True)
        path.write_text(
            '---\ntype: chapter\ncanon_status: DRAFT\n---\n\n# Chapter 1\n',
            encoding="utf-8")
        self.image("chapter-1.jpg")
        out = self.run_script("--execute")
        self.assertIn("UNMATCHED\tchapter-1.jpg", out)


class PortraitTypeGateTests(ScriptCase):
    def test_event_type_files_but_never_gets_a_portrait_field(self):
        # "event" is in FOLDER (image-handling.md's filing table) but not
        # in schema_rules.PORTRAIT_TYPES — the file still gets filed into
        # events/, but portrait: is never written for it.
        self.entity("Events/The Ritual.md", "event")
        self.image("the-ritual.jpg")
        out = self.run_script("--execute")
        self.assertIn("FILED\tthe-ritual.jpg\tthe-ritual\t"
                      "Events/The Ritual.md\t_attachments/events/"
                      "the-ritual.jpg\tbody-embed (entity type does not "
                      "support a portrait)", out)
        text = (self.vault / "Events/The Ritual.md").read_text(
            encoding="utf-8")
        self.assertIn('portrait: ""', text)
        self.assertIn("![[the-ritual.jpg]]", text)


class AmbiguousEntityTests(ScriptCase):
    def test_two_entities_sharing_a_slug_are_reported_not_guessed(self):
        self.entity("Characters/Ronnie Vint.md", "npc")
        self.entity("Locations/Ronnie Vint.md", "location")
        self.image("ronnie-vint.jpg")
        out = self.run_script("--execute")
        self.assertIn("AMBIGUOUS-ENTITY\tronnie-vint.jpg\tronnie-vint", out)


class NoConverterTests(unittest.TestCase):
    def test_no_converter_available_reports_skip_reason(self):
        # Exercises the real shutil.which check — only meaningful on a
        # machine with neither sips nor magick installed.
        if shutil.which("sips") or shutil.which("magick"):
            self.skipTest("a converter is installed on this machine")
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "photo.heic"
            src.write_bytes(b"heic-bytes")
            content, ext, reason = ii.read_content(src, Path(tmp))
        self.assertEqual(content, b"")
        self.assertIn("no conversion tool available", reason)


class UsageTests(unittest.TestCase):
    def test_missing_vault_is_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.run(
                [sys.executable, str(SCRIPT), str(Path(tmp) / "nope"), tmp],
                capture_output=True, text=True, timeout=60)
            self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()
