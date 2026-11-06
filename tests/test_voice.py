"""The voice field: nine templates carry it, `voice_value` reads it, the
`voices` command lists it and `stamp_entities.py --set` writes it."""

import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import schema_rules as rules  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib as vl  # noqa: E402

TEMPLATES = REPO / "skills" / "shared" / "templates"
NAMES = ["campaign-overview", "npc", "pc-generic", "pc-coc-7e",
         "pc-coc-7e-regency", "pc-gurps-4e", "pc-fitd",
         "pc-dnd-5e-2024", "pc-pf2e"]


class TemplatesCarryVoice(unittest.TestCase):
    def test_templates_carry_voice(self):
        for name in NAMES:
            text = (TEMPLATES / f"{name}.md").read_text(encoding="utf-8")
            all_lines = text.splitlines()
            end, err = vl.frontmatter_span(all_lines)
            self.assertIsNone(err, name)
            lines = [ln for ln in all_lines[1:end] if ln.startswith("voice:")]
            self.assertEqual(len(lines), 1, name)
            self.assertRegex(lines[0], r'^voice: ""\s+#', name)

    def test_npc_table_delivery_line_is_speech(self):
        # One word, one meaning: `voice:` is the story voice; how the GM
        # plays them at the table is the Speech line under Playing Them.
        text = (TEMPLATES / "npc.md").read_text(encoding="utf-8")
        self.assertIn("- **Speech:** {accent, pace, a verbal tic}\n", text)
        self.assertNotIn("**Voice:**", text)

    def test_template_voice_comments(self):
        for name in NAMES:
            text = (TEMPLATES / f"{name}.md").read_text(encoding="utf-8")
            (line,) = [ln for ln in text.splitlines()
                       if ln.startswith("voice:")]
            comment = line.split("#", 1)[1].strip()
            self.assertTrue(comment, name)
            self.assertTrue(comment.endswith("never published"), name)

    def test_show_lists_voice(self):
        for etype in ("pc", "npc", "campaign_overview"):
            self.assertIn("voice", rules.show(etype), etype)


TRICKY = 'Says "aye", thinks: it\'s fine #notfine \\o/'


def note(path: Path, front: str, body: str = "# x\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\n{front}---\n{body}", encoding="utf-8")


def make_vault(tmp_path: Path, off: bool = False) -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    cfg = "version: 1\n" + ("vault:\n  voices: false\n" if off else "")
    (vault / "_meta" / "vault-config.yaml").write_text(cfg, encoding="utf-8")
    return vault


def populate(vault: Path) -> None:
    note(vault / "Campaign Overview.md",
         'type: campaign_overview\nvoice: "Dry and wary."\n')
    note(vault / "PCs" / "Ada Vane.md",
         'type: pc\nstatus: active\naliases: [Ada]\nvoice: "Clipped."\n')
    note(vault / "PCs" / "Bo Kell.md", 'type: pc\nstatus: active\nvoice: ""\n')
    note(vault / "NPCs" / "Marlo Petrak.md",
         'type: npc\naliases: [The Mayor]\nvoice: "Slow, warm."\n')
    note(vault / "NPCs" / "Quiet Tom.md", 'type: npc\nvoice: ""\n')


def voices(monkeypatch, capsys, vault, *names):
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault),
                                      "voices", *names])
    vl.forget_settings(None)
    code = vc.main()
    return code, capsys.readouterr().out.splitlines()


def test_voice_value_round_trip():
    assert vl.voice_value("---\nvoice: " + vl.yaml_scalar(TRICKY)
                          + "\n---\n") == TRICKY
    assert vl.voice_value("---\nvoice: 'it''s'\n---\n") == "it's"
    assert vl.voice_value("---\nvoice: plain one \n---\n") == "plain one"
    assert vl.voice_value("---\ntype: npc\n---\n") == ""
    assert vl.voice_value('---\nvoice: ""\n---\n') == ""


def test_voices_command_rows(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    code, out = voices(monkeypatch, capsys, vault)
    assert code == 0
    assert out == ["## voices", "# count: 4",
                   "campaign\tDry and wary.", "Ada Vane\tClipped.",
                   "Bo Kell\t(none)", "Marlo Petrak\tSlow, warm."]


def test_voices_empty_vault(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    code, out = voices(monkeypatch, capsys, vault)
    assert code == 0
    assert out == ["## voices", "# count: 1", "campaign\t(none)"]


def test_voices_named(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    code, out = voices(monkeypatch, capsys, vault, "the mayor", "Quiet Tom",
                       "Nobody")
    assert code == 0
    assert out[2:] == ["campaign\tDry and wary.",
                       "Marlo Petrak\tSlow, warm.", "Quiet Tom\t(none)",
                       "Nobody\t(no such character)"]


def test_voices_switch_off(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, off=True)
    populate(vault)
    code, out = voices(monkeypatch, capsys, vault)
    assert code == 0
    assert out == ["## voices", "# count: 0", "# off: vault.voices"]


def test_stamp_writes_voice(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    done = subprocess.run(
        [sys.executable, str(SCRIPTS / "stamp_entities.py"), str(vault),
         "PCs/Ada Vane.md", "--set", "voice=" + TRICKY, "--write"],
        capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    code, out = voices(monkeypatch, capsys, vault, "Ada Vane")
    assert out[3] == "Ada Vane\t" + TRICKY


def test_voice_value_ignores_trailing_comment():
    assert vl.voice_value('---\nvoice: "terse" # note\n---\n') == "terse"
    assert vl.voice_value("---\nvoice: 'it''s' # n\n---\n") == "it's"
    assert vl.voice_value("---\nvoice: bare # n\n---\n") == "bare"
    assert vl.voice_value('---\nvoice: "a # b"  # n\n---\n') == "a # b"


def test_voice_value_of_every_template_is_empty():
    for name in NAMES:
        text = (TEMPLATES / f"{name}.md").read_text(encoding="utf-8")
        assert vl.voice_value(text) == "", name


def test_voices_lists_no_template_npc(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    tpl = (TEMPLATES / "npc.md").read_text(encoding="utf-8")
    (vault / "NPCs").mkdir()
    (vault / "NPCs" / "Blank One.md").write_text(tpl, encoding="utf-8")
    code, out = voices(monkeypatch, capsys, vault)
    assert out == ["## voices", "# count: 1", "campaign\t(none)"]


def test_voices_name_ignores_underscore_and_case(tmp_path, monkeypatch,
                                                 capsys):
    vault = make_vault(tmp_path)
    note(vault / "NPCs" / "Freddy_Cavendish.md",
         'type: npc\nvoice: "Booming."\n')
    code, out = voices(monkeypatch, capsys, vault, "freddy Cavendish")
    assert out[3] == "Freddy_Cavendish\tBooming."


def fm(line: str) -> str:
    return f"---\ntype: npc\n{line}\n---\n"


@pytest.mark.parametrize("line", [
    "voice: null", "voice: ~", "voice: Null", "voice: NULL", "voice:",
    "voice:   ", "voice: # set only when", "voice:   # x", "voice: null # x",
    "voice: ~  # x"])
def test_voice_value_null_and_comment_only_are_empty(line):
    assert vl.voice_value(fm(line)) == ""
    assert vl.voice_read(fm(line)) == ""


def test_voice_value_bare_word_null_inside_text_is_kept():
    assert vl.voice_value(fm("voice: nullish and wary")) == "nullish and wary"


@pytest.mark.parametrize("value", [
    "Dry.\nSecond line", "Tab\there", "CR\rhere", "bell\x07", "sep\u2028x",
    "nel\x85x", "both \\ and \"quote\"\nnext"])
def test_yaml_scalar_escapes_control_characters(value):
    written = vl.yaml_scalar(value)
    assert len(written.splitlines()) == 1, written
    assert json.loads(written) == value
    assert vl.voice_value(fm("voice: " + written)) == value.strip()


@pytest.mark.parametrize("front", [
    "voice: |\n  Dry.\n  Wary.", "voice: >-\n  Dry.", "voice: plain\n  continued",
    'voice: "Dry.\n  Second"', "voice: 'never closed", "voice:\n  - a"])
def test_voice_read_unreadable_shapes(front):
    text = f"---\ntype: npc\n{front}\nstatus: active\n---\n"
    assert vl.voice_read(text) is None
    assert vl.voice_value(text) == ""


def test_voices_row_says_unreadable(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    note(vault / "NPCs" / "Folded.md", "type: npc\nvoice: |\n  Dry.\n")
    code, out = voices(monkeypatch, capsys, vault, "Folded")
    assert out[3] == "Folded\t" + vl.VOICE_UNREADABLE
    code, out = voices(monkeypatch, capsys, vault)
    assert "Folded\t" + vl.VOICE_UNREADABLE in out


def test_stamp_clearing_a_voice_reads_as_none(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    done = subprocess.run(
        [sys.executable, str(SCRIPTS / "stamp_entities.py"), str(vault),
         "NPCs/Marlo Petrak.md", "--set", "voice=", "--write"],
        capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    code, out = voices(monkeypatch, capsys, vault, "Marlo Petrak")
    assert out[3] == "Marlo Petrak\t(none)"
    code, out = voices(monkeypatch, capsys, vault)
    assert not any(r.startswith("Marlo Petrak") for r in out)


def test_stamp_writes_a_multi_line_voice(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    done = subprocess.run(
        [sys.executable, str(SCRIPTS / "stamp_entities.py"), str(vault),
         "PCs/Ada Vane.md", "--set", "voice=Dry.\nSecond\tline", "--write"],
        capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    text = (vault / "PCs" / "Ada Vane.md").read_text(encoding="utf-8")
    assert vl.voice_value(text) == "Dry.\nSecond\tline"
    code, out = voices(monkeypatch, capsys, vault, "Ada Vane")
    assert out[3:] == ["Ada Vane\tDry. Second line"]   # one row, one line


def test_voices_name_takes_a_wikilink_and_inner_spaces(tmp_path, monkeypatch,
                                                       capsys):
    vault = make_vault(tmp_path)
    populate(vault)
    code, out = voices(monkeypatch, capsys, vault, "[[Marlo Petrak]]",
                       "[[Marlo Petrak|the mayor]]", "Marlo   Petrak")
    assert out[2:] == ["campaign\tDry and wary."] + [
        "Marlo Petrak\tSlow, warm."] * 3


def test_voices_skip_story_companions_archives_and_templates(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path)
    (vault / "_archive").mkdir()
    note(vault / "_archive" / "Old Overview.md",
         'type: campaign_overview\nvoice: "Archived."\n')
    note(vault / "_archive" / "Marlo Petrak.md",
         'type: npc\nvoice: "Archived Marlo."\n')
    note(vault / "PCs" / "Ada Vane_Story.md",
         'type: pc\nstatus: active\nvoice: "Story copy."\n')
    note(vault / "_Templates" / "_Template_NPC.md",
         'type: npc\nvoice: "Template."\n')
    populate(vault)
    code, out = voices(monkeypatch, capsys, vault)
    assert out == ["## voices", "# count: 4",
                   "campaign\tDry and wary.", "Ada Vane\tClipped.",
                   "Bo Kell\t(none)", "Marlo Petrak\tSlow, warm."]
    code, out = voices(monkeypatch, capsys, vault, "Marlo Petrak",
                       "Ada Vane_Story")
    assert out[3:] == ["Marlo Petrak\tSlow, warm.",
                       "Ada Vane_Story\t(no such character)"]


def test_names_are_refused_on_other_commands(tmp_path, capsys, monkeypatch):
    vault = make_vault(tmp_path)
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault),
                                      "active-pcs", "Marlo"])
    with pytest.raises(SystemExit) as cm:
        vc.main()
    assert cm.value.code == 2
    assert "voices" in capsys.readouterr().err


if __name__ == "__main__":
    unittest.main()
