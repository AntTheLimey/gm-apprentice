"""1.12.71 update step `pc-roster-retired` (#729): the PC roster note
(`type: pc_roster`, or the older `player-characters`) goes.

- One holding nothing but its heading (as the scaffold seeded it) is
  deleted as bookkeeping, with any `_Templates/` copy.
- One holding writing is a `removes` question.
- One naming a PC that has no note waits, holding the stamp.
- Every link to a deleted note becomes plain words; a frontmatter value
  linking it is taken out; it comes off the publish list.
- A line of the vault's own agent files that sends the agent to the roster
  is said, never rewritten.
- A record copy (`_archive/`, `_QA/`) is neither deleted nor rewritten.
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import agent_block  # noqa: E402
import migrate_vault as mv  # noqa: E402
from migrate_core import CHOICE, PERSON, WILL  # noqa: E402
from vault_check import ToolAnswer  # noqa: E402
import site_fixture  # noqa: E402

EMPTY = "---\ntype: pc_roster\n---\n\n# Player Characters\n"
WRITTEN = ("---\ntype: pc_roster\n---\n\n# Player Characters\n\n"
           "The party met in Arkham.\n\n- [[Ann]], played by Sam\n")
TABLED = ("---\ntype: pc_roster\n---\n\n# Player Characters\n\n"
          "| Character | Player |\n|---|---|\n| Ann | Sam |\n| Bo Reyes | Kit |\n")
OLDER = "---\ntype: player-characters\n---\n\n# Party\n"
PC = "---\ntype: pc\nplayer_name: Sam\nstatus: alive\n---\n\n# Ann\n"
BO = "---\ntype: pc\nplayer_name: Kit\nstatus: alive\n---\n\n# Bo\n"
NOTE = "---\ntype: npc\n---\n\n# A roster of the Watch\n"
TEMPLATE = "---\ntype: pc_roster\n---\n\n# {{title}}\n"
ROSTER = "_Campaign/Player Characters.md"

node_missing = shutil.which("node") is None


def make_vault(case, notes):
    vault = Path(tempfile.mkdtemp(prefix="mig-roster-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n",
                                                       encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def read(vault, rel):
    return (vault / rel).read_text(encoding="utf-8")


NO_LIST = (None, ToolAnswer())


def run(item):
    with mock.patch.object(mv, "publish_list_sets", return_value=NO_LIST), \
            mock.patch.object(mv, "ask_publish_tool") as ask:
        done = item.apply(None)
    ask.assert_not_called()
    return done


class DeclaredTests(unittest.TestCase):
    def test_the_check_is_declared_for_1_12_71_after_the_repin(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "pc-roster-retired")
        self.assertEqual((check.release, check.band, check.asks_site,
                          check.kind, check.choices),
                         ("1.12.71", 4, True, "bookkeeping", ("pc-roster-written",)))
        self.assertIn("text you wrote", check.ask)
        self.assertIn("Kept your PC roster note", check.left)

    def test_a_vault_with_no_roster_is_offered_nothing(self):
        v = make_vault(self, {"Characters/PCs/Ann.md": PC, "NPCs/Watch.md": NOTE})
        self.assertEqual(mv.find_pc_roster_retired(v), [])


class EmptyRosterTests(unittest.TestCase):
    def test_an_empty_roster_and_its_template_go_as_bookkeeping(self):
        v = make_vault(self, {
            ROSTER: EMPTY,
            "Lore/Party.md": OLDER,
            "_Templates/_Template_Player_Characters.md": TEMPLATE,
            "_inbox/old roster.md": WRITTEN,      # staging: not the vault's note
            "_archive/Player Characters (2025).md": WRITTEN,   # a record
            "_QA/report.md": "Read [[Player Characters]] first.\n",
            "Characters/PCs/Ann.md": PC,
            "NPCs/Watch.md": NOTE})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual((item.id, item.group, item.kind),
                         ("pc-roster-retired", WILL, None))
        self.assertEqual([line.split(" (")[0] for line in item.lines], [
            "delete Lore/Party.md", f"delete {ROSTER}",
            "delete _Templates/_Template_Player_Characters.md"])
        done = run(item)
        self.assertEqual(done, [
            "deleted Lore/Party.md", f"deleted {ROSTER}",
            "deleted _Templates/_Template_Player_Characters.md"])
        for rel in (ROSTER, "Lore/Party.md",
                    "_Templates/_Template_Player_Characters.md"):
            self.assertFalse((v / rel).exists(), rel)
        # Records are kept as they were: the archived roster and the QA
        # report's link.
        for rel, text in (("_inbox/old roster.md", WRITTEN),
                          ("_archive/Player Characters (2025).md", WRITTEN),
                          ("_QA/report.md", "Read [[Player Characters]] first.\n"),
                          ("Characters/PCs/Ann.md", PC), ("NPCs/Watch.md", NOTE)):
            self.assertEqual(read(v, rel), text, rel)
        self.assertEqual(mv.find_pc_roster_retired(v), [])

    def test_a_comment_is_not_writing(self):
        v = make_vault(self, {ROSTER: EMPTY + "\n<!-- filled by the skills -->\n"})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.group, WILL)


class WrittenRosterTests(unittest.TestCase):
    def test_a_roster_with_writing_is_a_removes_question(self):
        v = make_vault(self, {ROSTER: WRITTEN, "Characters/PCs/Ann.md": PC})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual((item.id, item.group, item.kind),
                         ("pc-roster-written", CHOICE, "removes"))
        self.assertIn("the text in it", item.lines[0])
        self.assertTrue((v / ROSTER).exists(), "nothing goes before the answer")
        self.assertEqual(run(item), [f"deleted {ROSTER}"])
        self.assertFalse((v / ROSTER).exists())
        self.assertEqual(mv.find_pc_roster_retired(v), [])

    def test_a_roster_naming_a_pc_with_no_note_holds_the_stamp(self):
        v = make_vault(self, {ROSTER: TABLED, "Characters/PCs/Ann.md": PC})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual((item.id, item.group, item.holds_stamp),
                         ("pc-roster-pcs-missing", PERSON, True))
        self.assertEqual(len(item.lines), 1, item.lines)
        self.assertIn("names Bo Reyes, who has no PC note", item.lines[0])
        # A link that leads nowhere is a PC with no note too.
        linked = make_vault(self, {ROSTER: WRITTEN})
        (item,) = mv.find_pc_roster_retired(linked)
        self.assertIn("names Ann, who has no PC note", item.lines[0])
        # Once the PC notes are made, it is the question.
        (v / "Characters" / "PCs" / "Bo.md").write_text(
            BO.replace("# Bo", "# Bo Reyes").replace(
                "status: alive\n", "status: alive\naliases: [Bo Reyes]\n"),
            encoding="utf-8")
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")

    def test_only_the_character_column_and_pc_shapes_name_pcs(self):
        # Dead End and Special Forces put the player first; Canticle links
        # former PCs in a Replaced column; a roster's prose links NPCs.
        roster = ("---\ntype: pc_roster\n---\n\n# Player Characters\n\n"
                  "| Player | Character | Replaced |\n|---|---|---|\n"
                  "| Ant | [[Ann\\|Annie]] | [[Old Hand]] |\n"
                  "| Jay S. | Bo Reyes | — |\n\n"
                  "### [[Cy]]\n\n- [[Dee]], played by Kit\n\n"
                  "Ann knows [[Inspector Crane]] from the docks.\n\n"
                  "| Ship | Crew |\n|---|---|\n| Gull | four |\n")
        self.assertEqual(mv._named_pcs(roster), ["Ann", "Bo Reyes", "Cy", "Dee"])
        v = make_vault(self, {ROSTER: roster, "Characters/PCs/Ann.md": PC,
                              "Characters/PCs/Bo Reyes.md": BO})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-pcs-missing")
        self.assertEqual([line.split("\t")[1].split(",")[0] for line in item.lines],
                         ["names Cy", "names Dee"])

    def test_a_placeholder_cell_or_an_archived_pc_is_not_missing(self):
        roster = ("---\ntype: pc_roster\n---\n\n# Player Characters\n\n"
                  "| Character | Player |\n|---|---|\n| [[Ann]] | Sam |\n"
                  "| TBD | Kit |\n| — | Lee |\n| *(none yet)* | Jo |\n\n"
                  "## Fallen\n\n- [[Bo]] (died S4)\n")
        v = make_vault(self, {ROSTER: roster, "Characters/PCs/Ann.md": PC,
                              "_archive/Bo.md": BO})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")

    def test_a_pc_named_with_more_words_than_its_note_counts(self):
        v = make_vault(self, {ROSTER: TABLED.replace("| Bo Reyes |", '| Bo "Kid" Reyes |'),
                              "Characters/PCs/Ann.md": PC,
                              "Characters/PCs/Bo Reyes.md": BO})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")


class LinkTests(unittest.TestCase):
    def test_links_to_the_roster_become_plain_words(self):
        overview = ("---\ntype: campaign_overview\n"
                    "related: ['[[Player Characters]]', '[[Ann]]']\n"
                    "party: \"[[_Campaign/Player Characters]]\"\n"
                    "relationships:\n"
                    "  - target: \"[[Player Characters]]\"\n"
                    "    type: related_to\n"
                    "  - target: \"[[Ann]]\"\n"
                    "    type: related_to\n"
                    "---\n\n"
                    "See [[Player Characters]], [[_Campaign/Player Characters|the party]] "
                    "and [[Player Characters#Ann|Ann's line]].\n"
                    "Met [[Ann]] at the [[Docks|harbour]].\n"
                    "`[[Player Characters]]` in code stays.\n")
        v = make_vault(self, {ROSTER: EMPTY,
                              "_Campaign/Campaign Overview.md": overview,
                              "Characters/PCs/Ann.md": PC,
                              "Locations/Docks.md": "---\ntype: location\n---\n"})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertIn("turn 3 links to the PC roster into plain words in "
                      "_Campaign/Campaign Overview.md", item.lines)
        # The preview names the frontmatter edits too, not only the body.
        self.assertIn("take '[[Player Characters]]' out of related in "
                      "_Campaign/Campaign Overview.md", item.lines)
        self.assertIn("empty party in _Campaign/Campaign Overview.md "
                      "(it linked the PC roster)", item.lines)
        self.assertIn('take the relationship target: "[[Player Characters]]" '
                      "type: related_to out of relationships in "
                      "_Campaign/Campaign Overview.md", item.lines)
        done = run(item)
        self.assertEqual(done, [
            "turned 3 links to the PC roster into plain words in "
            "_Campaign/Campaign Overview.md",
            "took '[[Player Characters]]' out of related in "
            "_Campaign/Campaign Overview.md",
            "emptied party in _Campaign/Campaign Overview.md (it linked the PC roster)",
            'took the relationship target: "[[Player Characters]]" type: related_to '
            "out of relationships in _Campaign/Campaign Overview.md",
            f"deleted {ROSTER}"])
        self.assertEqual(read(v, "_Campaign/Campaign Overview.md"), (
            "---\ntype: campaign_overview\n"
            "related: ['[[Ann]]']\n"
            "party: \"\"\n"
            "relationships:\n"
            "  - target: \"[[Ann]]\"\n"
            "    type: related_to\n"
            "---\n\n"
            "See Player Characters, the party and Ann's line.\n"
            "Met [[Ann]] at the [[Docks|harbour]].\n"
            "`[[Player Characters]]` in code stays.\n"))
        self.assertEqual(mv.find_pc_roster_retired(v), [])

    def test_prose_around_a_frontmatter_link_is_said_never_emptied(self):
        note = ("---\ntype: npc\nnotes: \"With [[Player Characters]] and [[Ann]]\"\n"
                "party: [[Player Characters]]\n"
                "meta:\n  roster: \"[[Player Characters]]\"\n---\n\nHi.\n")
        v = make_vault(self, {ROSTER: EMPTY, "NPCs/A.md": note})
        (item,) = mv.find_pc_roster_retired(v)
        done = run(item)
        self.assertEqual(read(v, "NPCs/A.md"), (
            "---\ntype: npc\nnotes: \"With [[Player Characters]] and [[Ann]]\"\n"
            "party: \"\"\n"
            "meta:\n  roster: \"[[Player Characters]]\"\n---\n\nHi.\n"))
        self.assertIn("emptied party in NPCs/A.md (it linked the PC roster)", done)
        for key in ("notes", "meta"):
            self.assertIn(f"left the link to the PC roster in {key} of NPCs/A.md: "
                          f"the update does not edit that form; take it out by hand",
                          done)
            self.assertIn(f"leave the link to the PC roster in {key} of NPCs/A.md: "
                          f"the update does not edit that form; take it out by hand",
                          item.lines)

    def test_an_archived_roster_copy_does_not_keep_bare_links(self):
        v = make_vault(self, {ROSTER: EMPTY,
                              "_archive/Player Characters.md": WRITTEN,
                              "Notes/A.md": "Read [[Player Characters]].\n"})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "Notes/A.md"), "Read Player Characters.\n")
        self.assertEqual(read(v, "_archive/Player Characters.md"), WRITTEN)

    def test_a_list_left_empty_reads_empty(self):
        note = "---\ntype: npc\nrelated:\n  - \"[[Player Characters]]\"\n---\n\nHi.\n"
        v = make_vault(self, {ROSTER: EMPTY, "NPCs/A.md": note})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "NPCs/A.md"), "---\ntype: npc\nrelated: []\n---\n\nHi.\n")

    def test_a_bare_link_another_note_shares_is_left_to_it(self):
        other = "---\ntype: reference\n---\n\n# Player Characters\n"
        v = make_vault(self, {ROSTER: EMPTY,
                              "Rules/Player Characters.md": other,
                              "Notes/A.md": "[[Player Characters]] and "
                                            "[[_Campaign/Player Characters|them]]\n"})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "Notes/A.md"), "[[Player Characters]] and them\n")
        self.assertTrue((v / "Rules" / "Player Characters.md").exists())

    def test_a_bare_link_is_taken_when_every_note_of_the_name_goes(self):
        v = make_vault(self, {ROSTER: EMPTY,
                              "Old/Player Characters.md": EMPTY,
                              "Notes/A.md": "[[Player Characters]] and "
                                            "[[Old/Player Characters|the old one]]\n"})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "Notes/A.md"), "Player Characters and the old one\n")

    def test_links_by_an_alias_become_plain_words(self):
        roster = EMPTY.replace("type: pc_roster\n",
                               "type: pc_roster\naliases: [Party, Watch]\n")
        v = make_vault(self, {ROSTER: roster,
                              "NPCs/Watch.md": NOTE,   # another note's name
                              "Notes/A.md": "[[Party]], [[Party|the gang]] and [[Watch]]\n"})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "Notes/A.md"), "Party, the gang and [[Watch]]\n")


class AgentFileTests(unittest.TestCase):
    def test_agent_lines_naming_the_roster_are_said_never_rewritten(self):
        claude = ("# Dead End\n\nAlways read [[Player Characters]] at the start "
                  "of every session.\nKeep notes short.\n\n"
                  + agent_block.block() + "\n")
        agents = "Check `_Campaign/Player Characters.md` for who plays whom.\n"
        v = make_vault(self, {ROSTER: EMPTY, "CLAUDE.md": claude, "AGENTS.md": agents})
        items = mv.find_pc_roster_retired(v)
        self.assertEqual([i.id for i in items], ["pc-roster-retired", "pc-roster-agent-files"])
        said = items[1]
        self.assertEqual((said.group, said.notice), (PERSON, True))
        self.assertEqual([row.split("\t")[0] for row in said.lines],
                         ["AGENTS.md:1", "CLAUDE.md:3"])
        self.assertIn("gma vault-check <vault> active-pcs --all", said.lines[1])
        run(items[0])
        self.assertEqual(read(v, "CLAUDE.md"), claude)
        self.assertEqual(read(v, "AGENTS.md"), agents)

    def test_the_bare_words_alone_are_not_the_roster(self):
        claude = ("The Player Characters folder is Characters/PCs.\n"
                  "## Essential Reference: Player Characters\n")
        v = make_vault(self, {ROSTER: EMPTY, "CLAUDE.md": claude})
        self.assertEqual([i.id for i in mv.find_pc_roster_retired(v)],
                         ["pc-roster-retired"])

    def test_the_managed_block_is_not_read(self):
        claude = agent_block.block().replace(
            agent_block.LINES[0], agent_block.LINES[0] + " [[Player Characters]]") + "\n"
        v = make_vault(self, {ROSTER: EMPTY, "CLAUDE.md": claude})
        self.assertEqual([i.id for i in mv.find_pc_roster_retired(v)],
                         ["pc-roster-retired"])


class PublishListTests(unittest.TestCase):
    def test_a_listed_roster_comes_off_the_publish_list(self):
        v = make_vault(self, {ROSTER: EMPTY})
        (item,) = mv.find_pc_roster_retired(v)
        listed = ({"publishing": {ROSTER}, "excluded": set(), "needs_decision": set()},
                  ToolAnswer())
        with mock.patch.object(mv, "publish_list_sets", return_value=listed), \
                mock.patch.object(mv, "ask_publish_tool",
                                  return_value=ToolAnswer(data={"pruned": 1})) as ask:
            done = item.apply(None)
        # Only the roster's own entry: a note away for now keeps its decision.
        ask.assert_called_once_with(
            v, ["manifest", "apply", "--prune-path", ROSTER], site_optional=True)
        self.assertEqual(done, [f"deleted {ROSTER}", f"took {ROSTER} off the publish list"])

    def test_a_list_the_tool_cannot_prune_is_said(self):
        v = make_vault(self, {ROSTER: EMPTY})
        (item,) = mv.find_pc_roster_retired(v)
        listed = ({"publishing": {ROSTER}, "excluded": set(), "needs_decision": set()},
                  ToolAnswer())
        with mock.patch.object(mv, "publish_list_sets", return_value=listed), \
                mock.patch.object(mv, "ask_publish_tool",
                                  return_value=ToolAnswer(why="node is not on PATH")):
            done = item.apply(None)
        self.assertFalse((v / ROSTER).exists())
        self.assertEqual(done[0], f"deleted {ROSTER}")
        self.assertIn(f"left {ROSTER} on the publish list (node is not on PATH)", done[1])


class ReviewTests(unittest.TestCase):
    """PR #732's review: nothing the GM wrote that the PC notes do not hold
    goes without the GM seeing it first."""

    def roster(self, body):
        return f"---\ntype: pc_roster\n---\n\n{body}\n"

    def test_a_lone_heading_that_links_a_pc_is_writing(self):
        v = make_vault(self, {ROSTER: self.roster("## [[Ann]]")})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual((item.id, item.holds_stamp), ("pc-roster-pcs-missing", True))
        self.assertIn("names Ann, who has no PC note", item.lines[0])

    def test_a_lone_heading_saying_more_than_the_seed_is_writing(self):
        v = make_vault(self, {ROSTER: self.roster("# The party: Ann (Sam), Bo (Kit)")})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")

    def test_names_in_any_script_are_checked(self):
        self.assertEqual(mv._fold("李华"), frozenset({"李华"}))
        self.assertEqual(mv._fold("José Ruiz"), mv._fold("jose ruiz"))
        tabled = self.roster("| Character | Player |\n|---|---|\n| 李华 | Sam |\n"
                             "| José Ruiz | Kit |")
        v = make_vault(self, {ROSTER: tabled, "Characters/PCs/Jose Ruiz.md": PC})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-pcs-missing")
        self.assertEqual(len(item.lines), 1, item.lines)
        self.assertIn("names 李华, who has no PC note", item.lines[0])
        (v / "Characters" / "PCs" / "李华.md").write_text(PC, encoding="utf-8")
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")

    def test_a_name_only_an_npc_note_answers_to_is_said_first(self):
        v = make_vault(self, {ROSTER: WRITTEN, "NPCs/Ann.md": NOTE})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")
        self.assertIn('names "Ann", whose note is not a PC note', item.lines[0])
        self.assertNotIn("are on the PC's own note", item.lines[1])

    def test_a_qa_or_midwife_copy_of_a_pc_is_no_pc_note(self):
        for folder in ("_QA", "_midwife"):
            v = make_vault(self, {ROSTER: WRITTEN, f"{folder}/Ann.md": PC})
            (item,) = mv.find_pc_roster_retired(v)
            self.assertEqual(item.id, "pc-roster-pcs-missing", folder)

    def test_a_name_that_only_partly_matches_a_pc_is_said_first(self):
        tabled = self.roster("| Character | Player |\n|---|---|\n| Ann Smith | Sam |")
        v = make_vault(self, {ROSTER: tabled,
                              "Characters/PCs/Mary Ann Smith.md": PC})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.id, "pc-roster-written")
        self.assertIn('takes "Ann Smith" to be the PC '
                      'Characters/PCs/Mary Ann Smith.md', item.lines[0])
        self.assertIn("answer leave", item.lines[0])
        self.assertNotIn("are on the PC's own note", item.lines[1])
        # A name several PCs share part of names them all.
        (v / "Characters" / "PCs" / "Ann Smith-Jones.md").write_text(PC, encoding="utf-8")
        (v / ROSTER).write_text(tabled.replace("Ann Smith |", "Smith |"),
                                encoding="utf-8")
        (item,) = mv.find_pc_roster_retired(v)
        self.assertIn('takes "Smith" to be one of the PCs', item.lines[0])

    def test_a_pc_note_with_no_player_or_status_is_said_first(self):
        bare = "---\ntype: pc\n---\n\n# Ann\n"
        v = make_vault(self, {ROSTER: WRITTEN, "Characters/PCs/Ann.md": bare})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.lines[0],
                         f"Characters/PCs/Ann.md has no player_name or status: "
                         f"copy what {ROSTER} says of Ann there first, or it "
                         f"goes with it")
        self.assertEqual(item.lines[1], f"delete {ROSTER} (the PC roster note "
                                        f"and the text in it)")

    def test_a_text_block_with_dashes_is_not_a_list(self):
        note = ("---\ntype: npc\nnotes: |\n  - See [[Player Characters]]\n"
                "  Keep: my campaign notes\n---\n\nHi.\n")
        v = make_vault(self, {ROSTER: EMPTY, "NPCs/A.md": note})
        done = run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "NPCs/A.md"), note)
        self.assertIn("left the link to the PC roster in notes of NPCs/A.md: "
                      "the update does not edit that form; take it out by hand", done)

    def test_an_item_with_more_than_the_link_is_said_never_cut(self):
        note = ("---\ntype: npc\nrelated:\n  - \"See [[Player Characters]] first\"\n"
                "  - \"[[Player Characters]]\"\n"
                "relationships:\n  - target: \"[[Ann]]\"\n"
                "    description: \"Patron of [[Player Characters]]\"\n"
                "---\n\nHi.\n")
        v = make_vault(self, {ROSTER: EMPTY, "NPCs/A.md": note,
                              "Characters/PCs/Ann.md": PC})
        done = run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "NPCs/A.md"), note.replace(
            "  - \"[[Player Characters]]\"\n", ""))
        for key in ("related", "relationships"):
            self.assertIn(f"left the link to the PC roster in {key} of NPCs/A.md: "
                          f"the update does not edit that form; take it out by hand",
                          done)

    def test_a_template_holding_writing_is_asked_about(self):
        custom = TEMPLATE + "\n| Character | Player |\n|---|---|\n| {{pc}} | {{player}} |\n"
        v = make_vault(self, {ROSTER: EMPTY,
                              "_Templates/_Template_Player_Characters.md": custom})
        items = mv.find_pc_roster_retired(v)
        self.assertEqual([i.id for i in items], ["pc-roster-retired", "pc-roster-written"])
        self.assertEqual(items[0].lines[0].split(" (")[0], f"delete {ROSTER}")
        self.assertEqual(len(items[0].lines), 1, items[0].lines)
        run(items[0])
        self.assertTrue((v / "_Templates" / "_Template_Player_Characters.md").exists())
        (item,) = mv.find_pc_roster_retired(v)
        self.assertEqual(item.lines, [
            "delete _Templates/_Template_Player_Characters.md (the PC roster's "
            "template and the text in it)"])
        self.assertEqual(run(item), ["deleted _Templates/_Template_Player_Characters.md"])

    def test_the_question_holds_the_stamp_and_names_the_roster_text(self):
        v = make_vault(self, {ROSTER: WRITTEN, "Characters/PCs/Ann.md": PC})
        (item,) = mv.find_pc_roster_retired(v)
        self.assertTrue(item.holds_stamp)
        before = item.detail["texts_sha"]
        # The same lines over other text are another question.
        (v / ROSTER).write_text(WRITTEN + "\nSam owes Kit five dollars.\n",
                                encoding="utf-8")
        (again,) = mv.find_pc_roster_retired(v)
        self.assertEqual(again.lines, item.lines)
        self.assertNotEqual(again.detail["texts_sha"], before)
        # A yes to the text as it was deletes nothing once it has changed.
        with self.assertRaises(mv.StepFailed) as e:
            run(item)
        self.assertIn("changed since you were asked", str(e.exception))
        self.assertTrue((v / ROSTER).exists())

    def test_a_root_roster_with_an_archived_copy_does_not_stop_the_update(self):
        v = make_vault(self, {"Player Characters.md": EMPTY,
                              "_archive/Player Characters.md": WRITTEN,
                              "Notes/A.md": "Read [[Player Characters]].\n"})
        run(mv.find_pc_roster_retired(v)[0])
        self.assertEqual(read(v, "Notes/A.md"), "Read Player Characters.\n")
        self.assertFalse((v / "Player Characters.md").exists())

    def test_a_publish_list_that_cannot_be_read_is_said(self):
        v = make_vault(self, {ROSTER: EMPTY})
        (item,) = mv.find_pc_roster_retired(v)
        with mock.patch.object(mv, "publish_list_sets",
                               return_value=(None, ToolAnswer(why="node is not on PATH"))), \
                mock.patch.object(mv, "ask_publish_tool") as ask:
            done = item.apply(None)
        ask.assert_not_called()
        self.assertEqual(done[0], f"deleted {ROSTER}")
        self.assertTrue(done[1].startswith(f"left {ROSTER} on the publish list, if it "
                                           f"is there: the list could not be read "
                                           f"(node is not on PATH)"), done[1])


@unittest.skipIf(node_missing, "the publish tool needs node")
class RealToolTests(unittest.TestCase):
    def test_the_real_tool_prunes_the_listed_roster(self):
        v = make_vault(self, {ROSTER: EMPTY, "Characters/PCs/Ann.md": PC,
                              "_meta/publish-list.yaml":
                              f"publishing:\n  - {ROSTER}\n  - Characters/PCs/Ann.md\n"
                              f"excluded: []\nneeds_decision: []\n"})
        # The list is pruned through the site's own tool, so the vault has a site.
        site_fixture.give_site(v, lambda p: self.addCleanup(
            shutil.rmtree, p, ignore_errors=True), private=True)
        (item,) = mv.find_pc_roster_retired(v)
        done = item.apply(None)
        self.assertEqual(done, [f"deleted {ROSTER}", f"took {ROSTER} off the publish list"])
        listed = (v / "_meta" / "publish-list.yaml").read_text(encoding="utf-8")
        self.assertNotIn("Player Characters", listed)
        self.assertIn("Characters/PCs/Ann.md", listed)


if __name__ == "__main__":
    unittest.main()
