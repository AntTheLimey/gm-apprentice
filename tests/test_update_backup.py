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

    def test_backup_keeps_ten(self):
        self._write("a.md")
        made = []
        for i in range(12):
            with mock.patch.object(update_backup, "_stamp",
                                   return_value=f"20260101-0000{i:02d}"):
                made.append(update_backup.backup(self.vault, home=self.home))
        left = sorted(made[0].parent.glob("*.tar.gz"))
        self.assertEqual(left, made[2:])

    def test_backup_holds_the_site_files_and_props_pages_the_update_writes(self):
        self._write("keep.md")
        self._write("Chapters/One/Props/letter.html")
        self._write("Chapters/One/Props/letter.css")
        site = self.tmp / "Site Folder"
        for rel in ("package.json", "package-lock.json", "vault.config.json",
                    "scripts/add-props.mjs", "node_modules/x/package.json",
                    "docs/index.html"):
            (site / rel).parent.mkdir(parents=True, exist_ok=True)
            (site / rel).write_text("{}", encoding="utf-8")
        with mock.patch.object(update_backup, "_site_folder",
                               return_value=site.resolve()):
            archive = update_backup.backup(self.vault, home=self.home)
        self.assertEqual(self._names(archive), [
            ".gm-apprentice-site/package-lock.json",
            ".gm-apprentice-site/package.json",
            ".gm-apprentice-site/scripts/add-props.mjs",
            ".gm-apprentice-site/vault.config.json",
            "Chapters/One/Props/letter.css", "Chapters/One/Props/letter.html",
            "keep.md"])

    def test_a_vault_site_folder_of_notes_and_the_site_files_stay_apart(self):
        self._write("site/note.md")
        self._write("site/package.json", "mine")
        site = self.tmp / "Real Site"
        site.mkdir()
        (site / "package.json").write_text("{}", encoding="utf-8")
        with mock.patch.object(update_backup, "_site_folder",
                               return_value=site.resolve()):
            archive = update_backup.backup(self.vault, home=self.home)
        names = self._names(archive)
        self.assertEqual(names, [".gm-apprentice-site/package.json",
                                 "site/note.md", "site/package.json"])
        with tarfile.open(archive) as tar:
            self.assertEqual(tar.extractfile("site/package.json").read(), b"mine")

    def test_an_icloud_timeout_names_the_brctl_fix(self):
        path = self._write("Evicted.md")

        def add(*_a, **_k):
            raise OSError(60, "Operation timed out", str(path))
        with mock.patch.object(tarfile.TarFile, "add", add), \
                self.assertRaises(update_backup.BackupFailed) as cm:
            update_backup.backup(self.vault, home=self.home)
        self.assertIn(f'brctl download "{path}"', str(cm.exception))

    def test_an_interrupted_backup_leaves_no_archive(self):
        self._write("a.md")

        def add(*_a, **_k):
            raise KeyboardInterrupt
        with mock.patch.object(tarfile.TarFile, "add", add), \
                self.assertRaises(KeyboardInterrupt):
            update_backup.backup(self.vault, home=self.home)
        folder = next((self.home / ".gm-apprentice" / "backups").iterdir())
        self.assertEqual(list(folder.glob("*.tar.gz*")), [])

    def test_a_partial_archive_is_never_pruned_or_counted(self):
        self._write("a.md")
        first = update_backup.backup(self.vault, home=self.home)
        stray = first.parent / "20200101-000000.tar.gz.partial"
        stray.write_text("x")
        for i in range(10):
            with mock.patch.object(update_backup, "_stamp",
                                   return_value=f"20270101-0000{i:02d}"):
                update_backup.backup(self.vault, home=self.home)
        # Pruning counts finished archives only, and leaves the stray alone.
        self.assertTrue(stray.exists())
        self.assertFalse(first.exists())
        self.assertEqual(len(list(first.parent.glob("*.tar.gz"))), 10)

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
    def test_a_symlinked_note_is_archived_as_its_target_and_a_write_goes_through(self):
        from migrate_core import write_text_atomic
        outside = self.tmp / "secret.md"
        outside.write_text("before")
        self._write("keep.md")
        os.symlink(outside, self.vault / "link.md")
        archive = update_backup.backup(self.vault, home=self.home)
        self.assertEqual(self._names(archive), ["keep.md", "link.md"])
        with tarfile.open(archive) as tar:
            member = tar.getmember("link.md")
            self.assertTrue(member.isfile())
            self.assertEqual(tar.extractfile(member).read(), b"before")
        # The update writes the target and keeps the link: so the target is
        # what the backup must hold.
        write_text_atomic(self.vault / "link.md", "after")
        self.assertTrue((self.vault / "link.md").is_symlink())
        self.assertEqual(outside.read_text(), "after")

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "symlink"),
                         "symlinks are POSIX")
    def test_a_symlinked_site_package_json_is_archived_as_its_target(self):
        outside = self.tmp / "outside-package.json"
        outside.write_text('{"v": 1}')
        site = self.tmp / "Site"
        site.mkdir()
        os.symlink(outside, site / "package.json")
        with mock.patch.object(update_backup, "_site_folder",
                               return_value=site.resolve()):
            archive = update_backup.backup(self.vault, home=self.home)
        with tarfile.open(archive) as tar:
            data = tar.extractfile(".gm-apprentice-site/package.json").read()
        self.assertEqual(data, b'{"v": 1}')

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "symlink"),
                         "symlinks are POSIX")
    def test_a_broken_symlink_is_skipped(self):
        os.symlink(self.tmp / "gone.md", self.vault / "dead.md")
        self._write("keep.md")
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


    @unittest.skipUnless(os.name == "posix" and os.geteuid() != 0,
                         "chmod only blocks writes for non-root POSIX")
    def test_a_home_it_cannot_write_is_marked_outside(self):
        # An agent's sandbox often allows writes only in the project folder.
        self._write("fine.md")
        self.home.chmod(0o500)
        self.addCleanup(self.home.chmod, 0o755)
        with self.assertRaises(update_backup.BackupFailed) as cm:
            update_backup.backup(self.vault, home=self.home)
        self.assertIn(".gm-apprentice", str(cm.exception))
        self.assertTrue(cm.exception.outside)

    def test_update_puts_the_stop_after_its_sentence(self):
        import update
        e = update_backup.BackupFailed("could not make /h/.gm-apprentice: denied",
                                       outside=True)
        run = update._Run(self.vault, update.UpdateResult(), self.home, "1.0.0", "1.0.1")
        with mock.patch.object(update.update_backup, "backup", side_effect=e), \
                self.assertRaises(update.StepFailed) as cm:
            run.before_write()
        said = str(cm.exception)
        self.assertTrue(said.endswith(update_backup.OUTSIDE_STOP), said)
        self.assertIn("nothing more was changed. It is outside", said)


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

    def test_site_folder_outside_vault_is_still_found(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        other = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, other, True)
        fake = mock.Mock()
        fake.get.return_value = str(other)
        with mock.patch("vaultlib.settings", return_value=fake):
            self.assertEqual(update_backup._site_folder(tmp), other.resolve())

if __name__ == "__main__":
    unittest.main()
