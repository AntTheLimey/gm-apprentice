"""The voice field: nine templates carry it."""

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
            front = text.split("---")[1]
            lines = [ln for ln in front.splitlines() if ln.startswith("voice:")]
            self.assertEqual(len(lines), 1, name)
            self.assertRegex(lines[0], r'^voice: ""\s+#', name)

    def test_show_lists_voice(self):
        for etype in ("pc", "npc"):
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


if __name__ == "__main__":
    unittest.main()
