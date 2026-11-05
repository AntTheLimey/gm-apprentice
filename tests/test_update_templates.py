"""Templates decided by rule, each decision remembered in the update record
(`_meta/update-record.json`) against both texts it was made on."""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
import migrate_vault as mv  # noqa: E402
import template_compare as tc  # noqa: E402
import update_record as ur  # noqa: E402
from migrate_core import CHOICE, PERSON, WILL, StepFailed  # noqa: E402
from vaultlib import plugin_version, read_stamp, write_stamp  # noqa: E402

VERSION = plugin_version()[0]
NPC = "_Template_NPC.md"
DOC = "_Template_Document.md"
TEMPLATES_CHECK = next(c for c in mv.VAULT_CHECKS if c.name == "templates")


def make_vault(case, system="coc-7e", version="1.10.12"):
    """A vault with every template as the plugin writes it."""
    vault = Path(tempfile.mkdtemp(prefix="updt-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.md").write_text(
        f'---\ngm_apprentice_version: "{version}"\npublish:\n  system: {system}\n---\n',
        encoding="utf-8")
    (vault / "_Templates").mkdir()
    for name, text in mv.expected_templates(vault).items():
        (vault / "_Templates" / name).write_text(text, encoding="utf-8")
    return vault


def by_id(items):
    return {item.id: item for item in items}


def record(vault):
    return json.loads((vault / ur.RECORD_FILE).read_text(encoding="utf-8"))


def edited_npc(vault):
    """The vault's NPC template with one field, one heading and one table
    row of its own: the GM's text, in no release."""
    path = vault / "_Templates" / NPC
    text = mv.expected_templates(vault)[NPC]
    text = text.replace("---\n", "---\nmood: grim\n", 1) \
        + "\n## My Section\n\n| Mine | Row |\n|---|---|\n| a | b |\n"
    path.write_text(text, encoding="utf-8")
    return path


def run(fn, *args, **kw):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = fn(*args, **kw)
    return code, out.getvalue(), err.getvalue()


class TemplateRuleTests(unittest.TestCase):
    def test_missing_template_is_copied_and_recorded(self):
        vault = make_vault(self)
        (vault / "_Templates" / NPC).unlink()
        item = by_id(mv.find_templates(vault))[f"template:{NPC}"]
        self.assertEqual(item.group, WILL)
        self.assertEqual(item.lines, [f"copy the missing template _Templates/{NPC}"])
        self.assertEqual(item.apply(None), ["Added the missing NPC template."])
        self.assertEqual((vault / "_Templates" / NPC).read_text(encoding="utf-8"),
                         mv.expected_templates(vault)[NPC])
        entry = record(vault)["templates"][NPC]
        self.assertEqual((entry["state"], entry["matches"], entry["decision"]),
                         ("plugin", VERSION, None))
        self.assertEqual(entry["file_sha"], entry["shipped_sha"])
        self.assertEqual(entry["plugin"], VERSION)
        # The templates found the same ride along with the write.
        self.assertEqual(record(vault)["templates"][DOC]["matches"], VERSION)
        self.assertEqual(mv.find_templates(vault), [])

    def older(self, release):
        vault = make_vault(self)
        old = mv.expected_templates(vault)[DOC] + "\n## Handout Notes\n"
        (vault / "_Templates" / DOC).write_text(old, encoding="utf-8")
        file = Path(tempfile.mkdtemp(prefix="updh-")) / "template-history.json"
        self.addCleanup(shutil.rmtree, file.parent, ignore_errors=True)
        file.write_text(json.dumps({"coc-7e": {DOC: {mv.text_hash(old): release}}}),
                        encoding="utf-8")
        patch = mock.patch.object(mv, "HISTORY", file)
        patch.start()
        self.addCleanup(patch.stop)
        return vault

    def test_unedited_old_release_is_updated_and_reported_with_its_release(self):
        vault = self.older("1.10.20")
        item = by_id(mv.find_templates(vault))[f"template:{DOC}"]
        self.assertEqual(item.group, WILL)
        self.assertEqual(item.lines, [f"update the Document template to {VERSION} "
                                      f"(it is 1.10.20's text, unedited)"])
        self.assertEqual(item.apply(None), [
            f"Updated the Document template to {VERSION} (it was 1.10.20's text, unedited)."])
        entry = record(vault)["templates"][DOC]
        self.assertEqual((entry["state"], entry["matches"]), ("plugin", VERSION))
        self.assertEqual(mv.find_templates(vault), [])

    def test_an_old_release_the_history_does_not_name_is_an_earlier_release(self):
        item = by_id(mv.find_templates(self.older(None)))[f"template:{DOC}"]
        self.assertIn("it is an earlier release's text", item.lines[0])

    def test_crlf_copy_of_the_shipped_template_is_the_same(self):
        vault = make_vault(self)
        path = vault / "_Templates" / NPC
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        self.assertIn(b"\r\n", path.read_bytes())
        self.assertEqual(mv.find_templates(vault), [])

    def test_empty_template_is_a_read_problem_not_a_difference(self):
        vault = make_vault(self)
        path = vault / "_Templates" / NPC
        path.write_text("", encoding="utf-8")
        items = by_id(mv.find_templates(vault))
        self.assertNotIn(f"template:{NPC}", items)
        row = items[f"template-unreadable:{NPC}"]
        self.assertEqual(row.group, PERSON)
        self.assertFalse(row.holds_stamp)
        # Truly 0 bytes: no download brings it back.
        self.assertEqual(row.lines, [
            f"_Templates/{NPC} is empty (0 bytes on disk); left as it is. Fix: "
            f"restore it from a backup, or delete it so the update copies the "
            f"plugin's, then run the update again."])
        self.assertEqual(path.read_text(encoding="utf-8"), "")
        self.assertFalse((vault / ur.RECORD_FILE).exists())

    def test_a_file_that_reads_empty_but_holds_bytes_is_an_icloud_problem(self):
        vault = make_vault(self)
        path = vault / "_Templates" / NPC
        size = path.stat().st_size
        real = Path.read_text

        def read_text(self, *a, **kw):
            return "" if self.name == NPC else real(self, *a, **kw)

        with mock.patch.object(Path, "read_text", read_text):
            items = by_id(mv.find_templates(vault))
        self.assertNotIn(f"template:{NPC}", items)
        self.assertEqual(items[f"template-unreadable:{NPC}"].lines, [
            f"_Templates/{NPC} could not be read (it read as empty, though it "
            f"holds {size} bytes); left as it is. "
            f'Fix: brctl download "{path}" (iCloud), or check its permissions, '
            f"then run the update again."])

    def test_a_template_of_blank_lines_is_empty_not_a_difference(self):
        vault = make_vault(self)
        (vault / "_Templates" / NPC).write_text("\n\n", encoding="utf-8")
        items = by_id(mv.find_templates(vault))
        self.assertNotIn(f"template:{NPC}", items)
        self.assertIn("is empty (only blank lines)", items[f"template-unreadable:{NPC}"].lines[0])

    def test_unreadable_template_oserror_is_a_read_problem(self):
        vault = make_vault(self)
        path = vault / "_Templates" / NPC
        real = Path.read_text

        def read_text(self, *a, **kw):
            if self.name == NPC:
                raise OSError(60, "Operation timed out")
            return real(self, *a, **kw)

        with mock.patch.object(Path, "read_text", read_text):
            items = by_id(mv.find_templates(vault))   # not a StepFailed
        self.assertNotIn(f"template:{NPC}", items)
        (line,) = items[f"template-unreadable:{NPC}"].lines
        self.assertIn("could not be read (Operation timed out)", line)
        self.assertIn(f'brctl download "{path}"', line)

    def test_a_dataless_file_is_named_as_icloud_and_the_flag_is_safe_elsewhere(self):
        stub = types.SimpleNamespace(stat=lambda: types.SimpleNamespace(
            st_flags=mv.DATALESS, st_size=0))
        self.assertIn("iCloud", mv._unreadable_reason(stub))
        stub = types.SimpleNamespace(stat=lambda: types.SimpleNamespace(st_size=12))
        self.assertIn("12 bytes", mv._unreadable_reason(stub))   # no st_flags (Linux)

    def test_a_template_that_is_not_utf8_is_a_read_problem(self):
        vault = make_vault(self)
        (vault / "_Templates" / NPC).write_bytes(b"\xff\xfe\x00bad")
        items = by_id(mv.find_templates(vault))
        self.assertIn("not UTF-8", items[f"template-unreadable:{NPC}"].lines[0])
        self.assertNotIn(f"template:{NPC}", items)

    def test_differing_template_asks_with_a_comparison_and_never_says_lost(self):
        vault = make_vault(self)
        edited_npc(vault)
        item = by_id(mv.find_templates(vault))[f"template:{NPC}"]
        self.assertEqual(item.group, CHOICE)
        self.assertFalse(item.holds_stamp)
        self.assertEqual(item.wants, "keep or take")
        self.assertEqual(item.lines, [
            "Your NPC template differs from every release of the plugin's. "
            "Keep yours, or take the plugin's?"])
        comparison = item.detail["comparison"]
        self.assertEqual(comparison["fields_only_vault"], ["mood"])
        self.assertEqual(comparison["headings_only_vault"], ["My Section"])
        json.dumps(item.detail)   # JSON-able
        rows = [row for _who, row in migrate._rows(item)]
        self.assertEqual(len(rows), 1)
        self.assertIn("(only yours has 1 field, 1 heading and 2 table rows)", rows[0])
        for line in [*item.lines, *rows, item.detail["summary"]]:
            self.assertNotIn("lost", line)
            self.assertNotIn("\n", line)

    def test_take_writes_the_plugins_text_and_records_it(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        item = by_id(mv.find_templates(vault))[f"template:{NPC}"]
        self.assertEqual(item.apply("take"), ["took the plugin's NPC template"])
        self.assertEqual(path.read_text(encoding="utf-8"), mv.expected_templates(vault)[NPC])
        self.assertEqual(record(vault)["templates"][NPC]["decision"], "take")
        self.assertEqual(mv.find_templates(vault), [])

    def test_leave_is_recorded_as_keep_and_another_answer_is_refused(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        text = path.read_text(encoding="utf-8")
        item = by_id(mv.find_templates(vault))[f"template:{NPC}"]
        self.assertEqual(item.apply("leave"), ["kept your NPC template"])
        self.assertEqual(path.read_text(encoding="utf-8"), text)
        entry = record(vault)["templates"][NPC]
        self.assertEqual((entry["state"], entry["decision"]), ("gms", "keep"))
        self.assertNotIn(f"template:{NPC}", by_id(mv.find_templates(vault)))
        with self.assertRaises(StepFailed):
            item.apply("y")

    def test_template_answers_need_keep_or_take(self):
        vault = make_vault(self)
        edited_npc(vault)
        code, _out, err = run(migrate.run_apply, vault, [(f"template:{NPC}", None)],
                              checks=[TEMPLATES_CHECK])
        self.assertEqual(code, 2)
        self.assertIn("needs a value", err)


class RememberedTests(unittest.TestCase):
    def keep(self, vault):
        code, out, err = run(migrate.run_apply, vault, [(f"template:{NPC}", "keep")],
                             checks=[TEMPLATES_CHECK])
        self.assertEqual(code, 0, out + err)
        self.assertIn("kept your NPC template", out)
        return out

    def test_keep_is_remembered_after_stamping(self):
        vault = make_vault(self)
        edited_npc(vault)
        self.keep(vault)
        self.assertEqual(read_stamp(vault), VERSION)
        entry = record(vault)["templates"][NPC]
        self.assertEqual((entry["state"], entry["decision"], entry["matches"]),
                         ("gms", "keep", None))
        code, out, _ = run(migrate.run_plan, vault, checks=[TEMPLATES_CHECK])
        self.assertIn("up to date", out)
        # The next update, a release later: not asked, and said in the report.
        write_stamp(vault, "1.10.12")
        code, out, _ = run(migrate.run_plan, vault, checks=[TEMPLATES_CHECK])
        self.assertNotIn(f"template:{NPC}", out)
        self.assertIn(f"keep your NPC template (decided {entry['on']})", out)
        code, out, err = run(migrate.run_apply, vault, [], checks=[TEMPLATES_CHECK])
        self.assertEqual(code, 0, out + err)
        self.assertIn(f"kept your NPC template (decided {entry['on']})", out)
        self.assertEqual(read_stamp(vault), VERSION)

    def test_keep_is_reasked_when_the_vault_file_changes(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        self.keep(vault)
        path.write_text(path.read_text(encoding="utf-8") + "\nMore of mine\n",
                        encoding="utf-8")
        self.assertEqual(by_id(mv.find_templates(vault))[f"template:{NPC}"].group, CHOICE)

    def test_keep_is_reasked_when_the_plugin_template_changes(self):
        vault = make_vault(self)
        edited_npc(vault)
        self.keep(vault)
        real = mv.expected_templates

        def newer(v):
            out = dict(real(v))
            out[NPC] = out[NPC] + "\n## New In This Release\n"
            return out

        with mock.patch.object(mv, "expected_templates", newer):
            item = by_id(mv.find_templates(vault))[f"template:{NPC}"]
        self.assertEqual(item.group, CHOICE)
        self.assertEqual(item.detail["comparison"]["headings_only_shipped"],
                         ["New In This Release"])

    def held(self, vault):
        edited_npc(vault)
        patch = mock.patch.object(mv, "read_held", return_value={
            "left": {f"template:{NPC}", "other"}, "said": set()})
        patch.start()
        self.addCleanup(patch.stop)

    def test_an_older_updates_leave_in_update_held_is_a_keep(self):
        vault = make_vault(self)
        self.held(vault)
        items = by_id(mv.find_templates(vault))
        self.assertNotIn(f"template:{NPC}", items)
        item = items[f"template-kept:{NPC}"]
        self.assertEqual(item.group, WILL)
        self.assertEqual(item.lines, ["keep your NPC template (you answered before)"])
        # plan is read-only: finding it wrote nothing
        self.assertFalse((vault / ur.RECORD_FILE).exists())

    def test_the_held_leave_is_written_to_the_record_on_apply(self):
        vault = make_vault(self)
        self.held(vault)
        text = (vault / "_Templates" / NPC).read_text(encoding="utf-8")
        item = by_id(mv.find_templates(vault))[f"template-kept:{NPC}"]
        self.assertEqual(item.apply(None), ["kept your NPC template (you answered before)"])
        entry = record(vault)["templates"][NPC]
        self.assertEqual((entry["state"], entry["decision"]), ("gms", "keep"))
        self.assertEqual(entry["file_sha"], mv.text_hash(text))
        self.assertEqual(entry["shipped_sha"], mv.text_hash(mv.expected_templates(vault)[NPC]))
        self.assertEqual((vault / "_Templates" / NPC).read_text(encoding="utf-8"), text)
        # From now on the record answers it, with update_held gone too.
        with mock.patch.object(mv, "read_held", return_value={"left": set(), "said": set()}):
            items = by_id(mv.find_templates(vault))
        self.assertNotIn(f"template:{NPC}", items)
        self.assertIn("decided", items[f"template-kept:{NPC}"].lines[0])

    def test_a_no_op_update_writes_no_record_and_a_stamp_keeps_it(self):
        vault = make_vault(self)
        self.assertEqual(mv.find_templates(vault), [])
        self.assertFalse((vault / ur.RECORD_FILE).exists())
        edited_npc(vault)
        self.keep(vault)
        raw = (vault / ur.RECORD_FILE).read_text(encoding="utf-8")
        self.assertTrue(raw.endswith("}\n"))
        self.assertEqual(raw, json.dumps(json.loads(raw), indent=2, ensure_ascii=False) + "\n")
        write_stamp(vault, "1.10.13")
        self.assertEqual((vault / ur.RECORD_FILE).read_text(encoding="utf-8"), raw)

    def test_an_unreadable_record_stops_the_check_and_is_never_written_over(self):
        vault = make_vault(self)
        edited_npc(vault)
        (vault / ur.RECORD_FILE).write_text("{not json", encoding="utf-8")
        with self.assertRaises(StepFailed) as caught:
            mv.find_templates(vault)
        self.assertIn("restore _meta/update-record.json from the latest update backup",
                      str(caught.exception))
        self.assertIn("~/.gm-apprentice/backups/", str(caught.exception))
        self.assertIn("or delete it and answer the template questions again", str(caught.exception))
        self.assertEqual((vault / ur.RECORD_FILE).read_text(encoding="utf-8"), "{not json")


class CompareTests(unittest.TestCase):
    def test_compare_reports_fields_headings_rows_and_sections(self):
        shipped = ("---\ntype: npc\nshipped_only: \"\"\n---\n\n# Name\n\n"
                   "## Shared\n\nA line.\n\n| Key | Value |\n|---|---|\n| plugin | row |\n\n"
                   "## Plugin Heading\n\nTheirs.\n")
        vault = ("---\ntype: npc\nvault_only: x\n---\n\n# Name\n\n"
                 "## Shared\n\nA line.\nMy extra line.\n\n| Key | Value |\n|---|---|\n| my | row |\n\n"
                 "## Vault Heading\n\nMine.\n")
        c = tc.compare(vault, shipped)
        self.assertEqual(c.fields_only_vault, ["vault_only"])
        self.assertEqual(c.fields_only_shipped, ["shipped_only"])
        self.assertEqual(c.headings_only_vault, ["Vault Heading"])
        self.assertEqual(c.headings_only_shipped, ["Plugin Heading"])
        self.assertEqual(c.table_rows_only_vault, ["| my | row |"])
        self.assertEqual(c.table_rows_only_shipped, ["| plugin | row |"])
        self.assertEqual(c.sections_changed, [("Shared", 2, 1)])
        self.assertEqual(tc.compare(vault.replace("\n", "\r\n"), vault), tc.Comparison())
        self.assertEqual(
            tc.summary(c), "only yours has 1 field, 1 heading and 1 table row; "
            "only the plugin's has 1 field, 1 heading and 1 table row; 1 section reads differently")
        self.assertEqual(json.loads(json.dumps(c.as_dict()))["sections_changed"], [["Shared", 2, 1]])


class LabelTests(unittest.TestCase):
    def test_every_shipped_template_has_a_label(self):
        shipped = sorted(p.name for p in mv.TEMPLATES.glob("*.md"))
        self.assertTrue(shipped)
        self.assertEqual([n for n in shipped if n not in mv.TEMPLATE_LABELS], [])
        self.assertEqual(sorted(mv.TEMPLATE_LABELS), shipped)   # no stale labels

    def test_labels_are_read_by_the_vaults_file_name(self):
        self.assertEqual(mv.template_label("_Template_NPC.md"), "NPC")
        self.assertEqual(mv.template_label("pc-coc-7e-regency.md"), "Regency sheet")
        self.assertEqual(mv.template_label("pc-gurps-4e.md"), "GURPS character sheet")
        self.assertEqual(mv.template_label("Mine.md"), "Mine.md")


class AskedTextTests(unittest.TestCase):
    """An answer names the text the GM was shown (`<id>@<hash>`): a
    template edited between the asking run and the answering run is asked
    again, never overwritten."""

    def setUp(self):
        import update
        self.update = update
        self.home = Path(tempfile.mkdtemp(prefix="updt-home-"))
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)

    def ask(self, vault, answers=None):
        return self.update.run(vault, answers or {}, False,
                               checks=[TEMPLATES_CHECK], home=self.home)

    def test_a_template_edited_after_it_was_asked_is_asked_again(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        [q] = self.ask(vault).questions
        self.assertRegex(q.id, rf"^template:{NPC}@[0-9a-f]{{8}}$")
        path.write_text(path.read_text(encoding="utf-8") + "\nLater edit\n",
                        encoding="utf-8")
        res = self.ask(vault, {q.id: "take"})
        self.assertIn("Later edit", path.read_text(encoding="utf-8"))
        self.assertEqual(res.exit, 3)
        [again] = res.questions
        self.assertTrue(again.id.startswith(f"template:{NPC}@"))
        self.assertNotEqual(again.id, q.id)
        self.assertTrue(any("changed since you were asked" in n
                            for n in res.notes), res.notes)

    def test_the_answer_for_the_text_shown_is_applied(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        [q] = self.ask(vault).questions
        res = self.ask(vault, {q.id: "take"})
        self.assertEqual(res.exit, 0, res)
        self.assertEqual(path.read_text(encoding="utf-8"),
                         mv.expected_templates(vault)[NPC])

    def test_a_bare_id_is_not_applied(self):
        vault = make_vault(self)
        path = edited_npc(vault)
        before = path.read_text(encoding="utf-8")
        res = self.ask(vault, {f"template:{NPC}": "take"})
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertEqual(res.exit, 3)
        self.assertTrue(any(f"template:{NPC}" in n for n in res.notes), res.notes)


if __name__ == "__main__":
    unittest.main()
