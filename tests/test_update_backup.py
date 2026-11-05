"""update_backup: a copy of the vault's notes, taken before the update writes."""

import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import update_backup  # noqa: E402

NOTE_SUFFIXES = {".md", ".yaml", ".json"}


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.vault = self.tmp / "My Vault"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.vault.mkdir()
        # The settings read is not what these tests are about.
        p = mock.patch.object(update_backup, "_site_folder", return_value=None)
        p.start()
        self.addCleanup(p.stop)

    def _write(self, rel, text="x"):
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def _names(self, archive):
        with tarfile.open(archive) as tar:
            return sorted(tar.getnames())

    def test_backup_holds_every_note_including_spaced_and_unicode_names(self):
        self._write("Session 01/Scene 1 – Café.md")
        self._write("NPCs/Mr O'Neil & Co.md")
        self._write("config.yaml")
        self._write("data/x.json")
        archive = update_backup.backup(self.vault, home=self.home)
        expected = sorted(
            p.relative_to(self.vault).as_posix()
            for p in self.vault.rglob("*")
            if p.is_file() and p.suffix in NOTE_SUFFIXES)
        self.assertEqual(self._names(archive), expected)
        self.assertIn("Session 01/Scene 1 – Café.md", expected)
        self.assertTrue(archive.parent.name.startswith("My Vault-"))
        self.assertEqual(archive.parent.parent,
                         self.home / ".gm-apprentice" / "backups")
        self.assertTrue(archive.name.endswith(".tar.gz"))

    def test_backup_skips_images_and_obsidian(self):
        self._write("keep.md")
        self._write("pic.png")
        self._write(".obsidian/app.json")
        self._write(".git/config.json")
        self._write(".trash/old.md")
        self._write(".gm-apprentice/state.json")
        archive = update_backup.backup(self.vault, home=self.home)
        self.assertEqual(self._names(archive), ["keep.md"])

    def test_backup_skips_the_site_folder(self):
        self._write("keep.md")
        self._write("site/page.md")
        with mock.patch.object(update_backup, "_site_folder",
                               return_value=(self.vault / "site").resolve()):
            archive = update_backup.backup(self.vault, home=self.home)
        self.assertEqual(self._names(archive), ["keep.md"])

    def test_backup_keeps_five(self):
        self._write("a.md")
        made = []
        for i in range(7):
            with mock.patch.object(update_backup, "_stamp",
                                   return_value=f"20260101-00000{i}"):
                made.append(update_backup.backup(self.vault, home=self.home))
        left = sorted(made[0].parent.glob("*.tar.gz"))
        self.assertEqual(left, made[2:])

    def test_same_second_does_not_overwrite(self):
        self._write("a.md")
        with mock.patch.object(update_backup, "_stamp",
                               return_value="20260101-000000"):
            first = update_backup.backup(self.vault, home=self.home)
            second = update_backup.backup(self.vault, home=self.home)
        self.assertNotEqual(first, second)
        self.assertTrue(first.exists() and second.exists())
        self.assertTrue(second.name.endswith("-2.tar.gz"))

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "symlink"),
                         "symlinks and chmod are POSIX")
    def test_symlinks_are_skipped(self):
        outside = self.tmp / "secret.md"
        outside.write_text("s")
        self._write("keep.md")
        os.symlink(outside, self.vault / "link.md")
        archive = update_backup.backup(self.vault, home=self.home)
        self.assertEqual(self._names(archive), ["keep.md"])

    @unittest.skipUnless(os.name == "posix" and os.geteuid() != 0,
                         "chmod 000 only blocks reads for non-root POSIX")
    def test_unreadable_note_fails_naming_it(self):
        self._write("fine.md")
        bad = self._write("Session 01/Locked Note.md")
        bad.chmod(0)
        self.addCleanup(bad.chmod, 0o644)
        with self.assertRaises(update_backup.BackupFailed) as cm:
            update_backup.backup(self.vault, home=self.home)
        self.assertIn("Locked Note.md", str(cm.exception))
        # No half-made archive is left behind.
        self.assertEqual(
            list((self.home / ".gm-apprentice" / "backups").rglob("*.tar.gz")),
            [])


    def test_prune_leaves_foreign_files(self):
        self._write("a.md")
        first = update_backup.backup(self.vault, home=self.home)
        (first.parent / "mine.tar.gz").write_text("x")
        (first.parent / "notes.txt").write_text("x")
        for i in range(7):
            with mock.patch.object(update_backup, "_stamp",
                                   return_value=f"20270101-00000{i}"):
                update_backup.backup(self.vault, home=self.home)
        self.assertTrue((first.parent / "mine.tar.gz").exists())
        self.assertTrue((first.parent / "notes.txt").exists())

    def test_same_folder_name_gets_its_own_backup_folder(self):
        other = self.tmp / "elsewhere" / "My Vault"
        other.mkdir(parents=True)
        (other / "b.md").write_text("x")
        self._write("a.md")
        a = update_backup.backup(self.vault, home=self.home)
        b = update_backup.backup(other, home=self.home)
        self.assertNotEqual(a.parent, b.parent)

    @unittest.skipUnless(os.name == "posix" and os.geteuid() != 0,
                         "chmod 000 only blocks reads for non-root POSIX")
    def test_unreadable_directory_fails_naming_it(self):
        self._write("fine.md")
        self._write("Locked Dir/inside.md")
        d = self.vault / "Locked Dir"
        d.chmod(0)
        self.addCleanup(d.chmod, 0o755)
        with self.assertRaises(update_backup.BackupFailed) as cm:
            update_backup.backup(self.vault, home=self.home)
        self.assertIn("Locked Dir", str(cm.exception))


class SiteFolderTests(unittest.TestCase):
    def test_settings_failure_means_no_skip(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch("vaultlib.settings", side_effect=RuntimeError("bad")):
            self.assertIsNone(update_backup._site_folder(tmp))

    def test_relative_site_folder_resolves_inside_vault(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        fake = mock.Mock()
        fake.get.return_value = "site"
        with mock.patch("vaultlib.settings", return_value=fake):
            self.assertEqual(update_backup._site_folder(tmp),
                             (tmp / "site").resolve())

    def test_site_folder_outside_vault_is_not_a_skip(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        other = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, other, True)
        fake = mock.Mock()
        fake.get.return_value = str(other)
        with mock.patch("vaultlib.settings", return_value=fake):
            self.assertIsNone(update_backup._site_folder(tmp))


if __name__ == "__main__":
    unittest.main()
