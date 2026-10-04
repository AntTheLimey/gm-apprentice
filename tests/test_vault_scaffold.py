"""vault_scaffold.py: a new vault's skeleton, whole or not at all."""

import contextlib
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
import migrate_vault as mv  # noqa: E402
import vault_check as vc  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from vaultlib import extract_frontmatter  # noqa: E402

SHARED = SCRIPTS.parent


def scratch(case):
    """An empty temporary folder; the vault goes at scratch/'V'."""
    root = Path(tempfile.mkdtemp(prefix="scaf-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    return root


class TextTests(unittest.TestCase):
    def test_entity_types_holds_every_plugin_type_entry(self):
        text = vs.entity_types_text()
        canonical = mv.type_entries(
            (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
        self.assertTrue(canonical)
        self.assertEqual(mv.type_entries(text), canonical)
        self.assertEqual(extract_frontmatter(text)["type"], "meta")
        for title in vs.ENTITY_SECTIONS:
            self.assertIn(f"\n## {title}\n", text)
        self.assertNotIn("## Relationship Types", text)

    def test_relationship_types_holds_the_full_vocabulary(self):
        text = vs.relationship_types_text()
        data = json.loads((SHARED / "gm-apprentice-ontology.json")
                          .read_text(encoding="utf-8"))
        for p in data["predicates"]:
            self.assertIn(p["type"], text)
        self.assertIn("| Sci-Fi |", text)
        self.assertIn("| Kinship |", text)
        self.assertIn("- `parent_of` / `child_of`", text)
        self.assertEqual(extract_frontmatter(text)["type"], "meta")

    def test_the_tree_comes_from_vault_structure(self):
        tree = vs.structure_tree()
        self.assertTrue(tree.startswith("{Campaign Name}/"))
        self.assertIn("Factions & Organizations/", tree)
        self.assertNotIn("```", tree)

    def test_config_text_with_and_without_a_system(self):
        text = vs.config_text("coc-7e", "Ashford", "1.10.29")
        fm = extract_frontmatter(text)
        self.assertEqual(fm["type"], "meta")
        self.assertEqual(fm["gm_apprentice_version"], "1.10.29")
        self.assertIn('  system: "coc-7e"\n', text)
        self.assertIn("  site: false\n", text)
        self.assertIn("Campaign: Ashford", text)
        self.assertIn("├── _meta/", text)
        bare = vs.config_text(None, "Ashford", "1.10.29")
        self.assertNotIn("system:", bare)
        self.assertIn("  site: false\n", bare)

    def test_a_missing_seed_is_a_refusal(self):
        with mock.patch.object(vs, "SEEDS", SHARED / "no-such-folder"):
            with self.assertRaises(vs.ScaffoldError):
                vs.seed("timeline.md", "X")


def plan(vault, system="coc-7e", **kw):
    kw.setdefault("campaign", "Ashford")
    kw.setdefault("version", "1.10.29")
    return vs.missing(vault, system, **kw)


def paths(pieces):
    return [vs.shown(p) for p in pieces]


def note(vault, rel, text):
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class PlanTests(unittest.TestCase):
    def test_a_new_vault_gets_the_whole_skeleton(self):
        got = paths(plan(scratch(self) / "V"))
        for wanted in ("_meta/", "_Campaign/", "_Templates/", "_World/",
                       "Chapters/", "Adventures/", "_attachments/",
                       "_attachments/characters/", "_attachments/documents/",
                       "Characters/PCs/", "Characters/NPCs/", "Locations/",
                       "Factions & Organizations/", "Items & Artifacts/",
                       "Creatures/", "Heritages/", "Events/", "Documents/",
                       "Clues/", "_Templates/_Template_NPC.md",
                       "_Templates/pc-coc-7e.md", "_World/world-index.md",
                       "_World/_flags.md", "_Campaign/Timeline.md",
                       "_Campaign/Player Characters.md",
                       "_meta/entity-types.md", "_meta/relationship-types.md",
                       "_meta/index.md", "_meta/vault-config.md"):
            self.assertIn(wanted, got)
        self.assertEqual(got[-2:], ["_meta/index.md", "_meta/vault-config.md"])
        self.assertEqual(len(got), len(set(got)))
        for unwanted in ("_inbox/", "_midwife/"):
            self.assertNotIn(unwanted, got)

    def test_templates_match_the_update_tools_set(self):
        for system in (*vs.SYSTEMS, None):
            pieces = plan(scratch(self) / "V", system)
            got = {p.rel[len("_Templates/"):]: p.text() for p in pieces
                   if p.rel.startswith("_Templates/") and p.text}
            self.assertEqual(got, mv.templates_for(system), system)

    def test_inbox_only_when_asked(self):
        got = paths(plan(scratch(self) / "V", inbox=True))
        self.assertIn("_inbox/", got)
        self.assertIn("_inbox/_processed/", got)

    def test_what_exists_is_not_planned(self):
        vault = scratch(self) / "V"
        note(vault, "_Campaign/Timeline.md", "mine")
        (vault / "Locations").mkdir()
        got = paths(plan(vault))
        self.assertNotIn("_Campaign/", got)
        self.assertNotIn("_Campaign/Timeline.md", got)
        self.assertNotIn("Locations/", got)
        self.assertIn("Clues/", got)

    def test_a_renamed_type_folder_counts_as_present(self):
        vault = scratch(self) / "V"
        note(vault, "NPCs/Ada.md", "---\ntype: npc\n---\n")
        note(vault, "Gear/Sword.md", "---\ntype: weapon\n---\n")
        got = paths(plan(vault))
        self.assertNotIn("Characters/NPCs/", got)
        self.assertNotIn("Items & Artifacts/", got)
        self.assertIn("Characters/PCs/", got)

    def test_a_timeline_under_another_name_counts(self):
        vault = scratch(self) / "V"
        note(vault, "Lore/When.md", "---\ntype: timeline\n---\n")
        note(vault, "Lore/Party.md", "---\ntype: player-characters\n---\n")
        got = paths(plan(vault))
        self.assertNotIn("_Campaign/Timeline.md", got)
        self.assertNotIn("_Campaign/Player Characters.md", got)

    def test_a_world_index_under_another_name_counts(self):
        vault = scratch(self) / "V"
        note(vault, "_World/index.md",
             "---\ntype: world_domain\ndomain: index\n---\n")
        self.assertNotIn("_World/world-index.md", paths(plan(vault)))
        other = scratch(self) / "W"
        note(other, "_World/geo.md",
             "---\ntype: world_domain\ndomain: geography\n---\n")
        self.assertIn("_World/world-index.md", paths(plan(other)))

    def test_world_flags_under_another_name_count(self):
        vault = scratch(self) / "V"
        note(vault, "Lore/flags.md", "---\ntype: world_flags\n---\n")
        self.assertNotIn("_World/_flags.md", paths(plan(vault)))

    def test_a_roster_of_either_type_counts(self):
        vault = scratch(self) / "V"
        note(vault, "Lore/Party.md", "---\ntype: pc_roster\n---\n")
        self.assertNotIn("_Campaign/Player Characters.md", paths(plan(vault)))

    def test_templates_do_not_count_as_notes(self):
        vault = scratch(self) / "V"
        note(vault, "_Templates/_Template_NPC.md", "---\ntype: npc\n---\n")
        self.assertIn("Characters/NPCs/", paths(plan(vault)))

    def test_the_vaults_own_attachments_folder_is_used(self):
        vault = scratch(self) / "V"
        note(vault, "_meta/vault-config.md",
             '---\ngm_apprentice_version: "1.10.29"\npublish:\n'
             '  attachments_dir: "_resources/images"\n---\n')
        got = paths(plan(vault))
        self.assertIn("_resources/images/characters/", got)
        self.assertNotIn("_attachments/", got)

    def test_templates_can_be_left_to_the_update_tool(self):
        got = paths(plan(scratch(self) / "V", templates=False))
        self.assertIn("_Templates/", got)
        self.assertFalse([p for p in got if p.startswith("_Templates/_")])

    def test_the_wrong_kind_in_the_way_is_a_refusal(self):
        vault = scratch(self) / "V"
        note(vault, "Locations", "a file")
        with self.assertRaisesRegex(vs.ScaffoldError, "Locations"):
            plan(vault)
        vault = scratch(self) / "V"
        (vault / "_Campaign" / "Timeline.md").mkdir(parents=True)
        with self.assertRaisesRegex(vs.ScaffoldError, "Timeline.md"):
            plan(vault)

    def test_an_awkward_campaign_name_stays_out_of_frontmatter(self):
        name = 'The "Last": Stand'
        pieces = {p.rel: p for p in plan(scratch(self) / "V", campaign=name)}
        for rel in ("_Campaign/Timeline.md", "_meta/vault-config.md"):
            text = pieces[rel].text()
            self.assertIn(name, text)
            front = text.split("\n---\n", 1)[0]
            self.assertNotIn("Last", front)
            self.assertIsNotNone(extract_frontmatter(text))

    def test_the_structure_doc_and_the_skeleton_agree(self):
        tops = set(re.findall(r"^[├└]── ([^/\n]+)/", vs.structure_tree(),
                              re.M))
        made = {rel.split("/")[0] for rel in
                (*vs.PLAIN_FOLDERS, *vs.TYPE_FOLDERS, vs.ATTACHMENTS)}
        self.assertEqual(tops, made | set(vs.NOT_CREATED))

    def test_the_structure_doc_and_the_attachment_folders_agree(self):
        inside = re.search(
            rf"^├── {vs.ATTACHMENTS}/[^\n]*\n((?:│   [^\n]*\n)+)",
            vs.structure_tree(), re.M)
        self.assertIsNotNone(inside)
        subs = re.findall(r"^│   [├└]── ([^/\n]+)/", inside.group(1), re.M)
        self.assertEqual(sorted(subs), sorted(vs.ATTACHMENT_SUBS))

    def test_the_schema_hierarchy_and_the_type_folders_agree(self):
        text = (SHARED / "entity-schema.md").read_text(encoding="utf-8")
        block = re.search(r"^## Entity Type Hierarchy\n+```text\n(.*?)\n```",
                          text, re.M | re.S).group(1)
        family: dict[str, set[str]] = {}
        at_depth: dict[int, str] = {}
        for line in block.split("\n"):
            found = re.match(r"^([│ ]*)[├└]── ([\w-]+)", line)
            if not found:
                continue
            depth = len(found.group(1)) // 4 + 1
            name = found.group(2)
            at_depth[depth] = name
            family.setdefault(name, {name})
            if depth > 1:
                family[at_depth[depth - 1]].add(name)
        for folder, heads in (("Creatures", ("creature",)),
                              ("Factions & Organizations",
                               ("faction", "organization")),
                              ("Items & Artifacts", ("item",)),
                              ("Documents", ("document",)),
                              ("Events", ("event",))):
            wanted = set().union(*(family[h] for h in heads))
            self.assertGreater(len(wanted), len(heads), folder)
            self.assertEqual(set(vs.TYPE_FOLDERS[folder]), wanted, folder)

    def test_pages_can_be_left_out(self):
        got = paths(plan(scratch(self) / "V", pages=False))
        for page in ("_World/world-index.md", "_World/_flags.md",
                     "_Campaign/Timeline.md",
                     "_Campaign/Player Characters.md"):
            self.assertNotIn(page, got)
        for kept in ("_World/", "_Campaign/", "Clues/",
                     "_Templates/_Template_NPC.md", "_meta/entity-types.md",
                     "_meta/relationship-types.md", "_meta/index.md"):
            self.assertIn(kept, got)

    def test_a_type_in_capitals_counts(self):
        vault = scratch(self) / "V"
        note(vault, "NPCs/Ada.md", "---\ntype: NPC\n---\n")
        note(vault, "Lore/When.md", "---\ntype: Timeline\n---\n")
        got = paths(plan(vault))
        self.assertNotIn("Characters/NPCs/", got)
        self.assertNotIn("_Campaign/Timeline.md", got)

    def test_an_attachments_folder_outside_the_vault_is_not_made(self):
        for named in ('"../shared-art"', '"art/../../shared"', '"/srv/art"',
                      '"C:/art"', r"..\shared-art"):
            vault = scratch(self) / "V"
            note(vault, "_meta/vault-config.md",
                 '---\ngm_apprentice_version: "1.10.29"\npublish:\n'
                 f'  attachments_dir: {named}\n---\n')
            got = paths(plan(vault))
            self.assertIn("Clues/", got)
            for rel in got:
                self.assertFalse(rel.startswith(".."), (named, rel))
                self.assertFalse(rel.startswith(vs.ATTACHMENTS), (named, rel))
                self.assertNotIn("art", rel, (named, rel))


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = vs.main([str(a) for a in argv])
    return code, out.getvalue()


def tree(root):
    """Every path under root with a file's bytes, for before/after checks."""
    return {p.relative_to(root).as_posix():
            (p.read_bytes() if p.is_file() else None)
            for p in sorted(root.rglob("*"))}


class BuildTests(unittest.TestCase):
    def test_a_preview_writes_nothing(self):
        root = scratch(self)
        code, out = run(root / "V", "--system", "coc")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE\t_meta/vault-config.md", out)
        self.assertIn("WOULD-CREATE\tClues/", out)
        self.assertRegex(out, r"# create: \d+\n$")
        self.assertEqual(tree(root), {})

    def test_write_then_a_second_run_finds_nothing(self):
        vault = scratch(self) / "V"
        code, out = run(vault, "--system", "coc", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("CREATED\tClues/", out)
        self.assertNotIn("WOULD-CREATE", out)
        code, out = run(vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(out, "OK\t(vault)\tnothing missing\n# create: 0\n")

    def test_a_fresh_vault_is_whole_for_every_system(self):
        for flags in (*(("--system", s) for s in vs.SYSTEMS),
                      ("--no-system",)):
            vault = scratch(self) / "V"
            code, out = run(vault, *flags, "--write")
            self.assertEqual(code, 0, out)
            rows, exit_code = vc.check_version(vault)
            self.assertTrue(rows[0].startswith("OK\t"), rows)
            self.assertEqual(exit_code, 0)
            shown = io.StringIO()
            with contextlib.redirect_stdout(shown):
                self.assertEqual(migrate.run_plan(vault), 0)
            self.assertIn("up to date", shown.getvalue(), flags)
            errors = [r for r in vc.check_frontmatter(vault, None)
                      if r.startswith("ERROR")]
            self.assertEqual(errors, [], flags)
            self.assertEqual([r for r in vc.check_index(vault)
                              if r.startswith(("ERROR", "WARNING"))], [],
                             flags)

    def test_what_the_midwife_made_is_kept_byte_for_byte(self):
        vault = scratch(self) / "V"
        note(vault, "_Campaign/Campaign Overview.md",
             "---\ntype: campaign_overview\ngame_system: gurps\n---\nMine\r\n")
        note(vault, "Adventures/Heist/Heist.md", "brief")
        note(vault, "_World/geography-climate.md", "hills")
        before = tree(vault)
        code, out = run(vault, "--write")
        self.assertEqual(code, 0, out)
        after = tree(vault)
        for rel, data in before.items():
            self.assertEqual(after[rel], data, rel)
        self.assertIn("pc-gurps-4e.md",
                      [p.name for p in (vault / "_Templates").iterdir()])
        self.assertIn('system: "gurps-4e"',
                      (vault / "_meta/vault-config.md").read_text("utf-8"))

    def test_no_system_and_no_flag_is_a_refusal(self):
        root = scratch(self)
        code, out = run(root / "V", "--write")
        self.assertEqual(code, 1)
        self.assertIn("ERROR\t", out)
        self.assertIn("--system", out)
        self.assertIn("# nothing written", out)
        self.assertEqual(tree(root), {})

    def test_an_unknown_system_is_a_refusal(self):
        code, out = run(scratch(self) / "V", "--system", "savage-worlds")
        self.assertEqual(code, 1)
        self.assertIn("coc-7e", out)

    def test_a_set_up_vault_with_no_system_needs_no_flag(self):
        vault = scratch(self) / "V"
        self.assertEqual(run(vault, "--no-system", "--write")[0], 0)
        code, out = run(vault)
        self.assertEqual(code, 0, out)
        self.assertTrue(out.startswith("OK\t"), out)

    def test_a_vault_ahead_of_the_plugin_is_a_refusal(self):
        vault = scratch(self) / "V"
        note(vault, "_meta/vault-config.md",
             '---\ngm_apprentice_version: "99.0.0"\n---\n')
        before = tree(vault)
        code, out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 1)
        self.assertIn("update the plugin", out)
        self.assertEqual(tree(vault), before)

    def test_a_config_with_no_version_is_a_refusal(self):
        for front in ("publish:\n  site: true\n",
                      "gm_apprentice_version:\n",
                      'gm_apprentice_version: "soon"\n'):
            vault = scratch(self) / "V"
            note(vault, "_meta/vault-config.md", f"---\n{front}---\n")
            before = tree(vault)
            code, out = run(vault, "--no-system", "--write")
            self.assertEqual(code, 1, front)
            self.assertIn("has no gm_apprentice_version", out)
            self.assertIn("# nothing written", out)
            self.assertEqual(tree(vault), before)

    def test_a_path_that_is_a_file_is_a_refusal(self):
        root = scratch(self)
        (root / "V").write_text("x", encoding="utf-8")
        code, out = run(root / "V", "--no-system", "--write")
        self.assertEqual(code, 1)
        self.assertIn("not a folder", out)

    def test_an_unreadable_plugin_version_is_a_refusal(self):
        with mock.patch.object(vs, "plugin_version", return_value=None):
            code, out = run(scratch(self) / "V", "--no-system")
        self.assertEqual(code, 1)
        self.assertIn("plugin version", out)

    def test_the_inbox_flag(self):
        vault = scratch(self) / "V"
        self.assertEqual(run(vault, "--no-system", "--inbox", "--write")[0], 0)
        self.assertTrue((vault / "_inbox" / "_processed").is_dir())

    def test_the_name_flag_titles_the_pages(self):
        vault = scratch(self) / "V"
        run(vault, "--no-system", "--name", "The  Ashford\nCase", "--write")
        self.assertIn("# The Ashford Case — Timeline",
                      (vault / "_Campaign/Timeline.md").read_text("utf-8"))

    def test_a_failed_write_removes_a_vault_folder_it_made(self):
        root = scratch(self)
        real = vs.write_text_atomic

        def fail_late(path, text):
            if path.name == "vault-config.md":
                raise vs.StepFailed("vault-config.md cannot be written")
            real(path, text)

        with mock.patch.object(vs, "write_text_atomic", fail_late):
            code, out = run(root / "V", "--no-system", "--write")
        self.assertEqual(code, 1)
        self.assertIn("cannot be written", out)
        self.assertIn("# nothing written", out)
        self.assertEqual(tree(root), {})

    def test_a_failed_write_leaves_an_existing_vault_as_it_was(self):
        vault = scratch(self) / "V"
        note(vault, "Locations/Inn.md", "---\ntype: location\n---\n")
        before = tree(vault)
        with mock.patch.object(vs, "write_text_atomic",
                               side_effect=vs.StepFailed("disk full")):
            code, _out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 1)
        self.assertEqual(tree(vault), before)

    def test_ctrl_c_part_way_removes_what_was_made(self):
        root = scratch(self)
        with mock.patch.object(vs, "write_text_atomic",
                               side_effect=KeyboardInterrupt):
            code, out = run(root / "V", "--no-system", "--write")
        self.assertEqual(code, 1)
        self.assertIn("# nothing written", out)
        self.assertEqual(tree(root), {})

    def test_any_failure_while_writing_is_a_refusal(self):
        root = scratch(self)
        with mock.patch.object(vs.index_build, "render",
                               side_effect=ValueError("boom")):
            code, out = run(root / "V", "--no-system", "--write")
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"ERROR\t.*boom")
        self.assertIn("# nothing written", out)
        self.assertEqual(tree(root), {})

    def unrecognised(self):
        vault = scratch(self) / "V"
        note(vault, "_Campaign/Campaign Overview.md",
             '---\ntype: campaign_overview\n'
             'game_system: "Call of Cthulhu 7e"\n---\n')
        return vault

    def test_an_unrecognised_recorded_system_is_a_refusal(self):
        vault = self.unrecognised()
        before = tree(vault)
        code, out = run(vault, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("the vault names its system 'call of cthulhu 7e'", out)
        self.assertIn("--system ID (one of coc-7e, ", out)
        self.assertIn("or --no-system", out)
        self.assertIn("# nothing written", out)
        self.assertEqual(tree(vault), before)

    def test_no_system_builds_generic_over_an_unrecognised_one(self):
        vault = self.unrecognised()
        code, out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("pc-generic.md",
                      [p.name for p in (vault / "_Templates").iterdir()])
        self.assertNotIn("system:",
                         (vault / "_meta/vault-config.md").read_text("utf-8"))

    def test_a_given_system_settles_an_unrecognised_one(self):
        vault = self.unrecognised()
        code, out = run(vault, "--system", "coc", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn('system: "coc-7e"',
                      (vault / "_meta/vault-config.md").read_text("utf-8"))

    def test_a_flag_that_disagrees_with_the_vault_is_a_refusal(self):
        vault = scratch(self) / "V"
        note(vault, "_Campaign/Campaign Overview.md",
             "---\ntype: campaign_overview\ngame_system: coc\n---\n")
        before = tree(vault)
        code, out = run(vault, "--system", "gurps", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("the vault records coc-7e; --system gurps-4e disagrees",
                      out)
        self.assertEqual(tree(vault), before)
        self.assertEqual(run(vault, "--system", "coc-7e", "--write")[0], 0)
        self.assertEqual(run(vault, "--no-system")[0], 0)

    def test_a_set_up_vault_naming_an_unsupported_system_needs_no_flag(self):
        vault = self.unrecognised()
        self.assertEqual(run(vault, "--no-system", "--write")[0], 0)
        code, out = run(vault)
        self.assertEqual(code, 0, out)
        self.assertTrue(out.startswith("OK\t"), out)

    def test_what_the_undo_cannot_remove_is_named(self):
        vault = scratch(self) / "V"
        note(vault, "Locations/Inn.md", "---\ntype: location\n---\n")
        real_rmdir = Path.rmdir

        def stuck(path):
            if path.name == "NPCs":
                raise OSError("in use")
            real_rmdir(path)

        with mock.patch.object(Path, "rmdir", stuck), \
                mock.patch.object(vs, "write_text_atomic",
                                  side_effect=vs.StepFailed("disk full")):
            code, out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 1, out)
        error = next(r for r in out.split("\n") if r.startswith("ERROR\t"))
        self.assertIn("disk full; could not remove: ", error)
        self.assertIn("Characters/NPCs/", error)
        self.assertNotIn("\\", error)
        self.assertNotIn("# nothing written", out)
        self.assertIn("# some of this run's files were left", out)
        self.assertTrue((vault / "Characters" / "NPCs").is_dir())
        self.assertFalse((vault / "Clues").exists())

    def test_the_closing_line_is_not_chosen_by_the_message(self):
        vault = scratch(self) / "V"
        with mock.patch.object(
                vs, "write_text_atomic",
                side_effect=vs.StepFailed("could not remove the lock")):
            code, out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("# nothing written", out)

    def test_rows_use_forward_slashes(self):
        _code, out = run(scratch(self) / "V", "--no-system")
        self.assertNotIn("\\", out)

    def test_a_parent_that_is_a_file_leaves_nothing_behind(self):
        vault = scratch(self) / "V"
        note(vault, "Characters", "not a folder")
        before = tree(vault)
        code, out = run(vault, "--no-system", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("ERROR\t", out)
        self.assertEqual(tree(vault), before)


if __name__ == "__main__":
    unittest.main()
