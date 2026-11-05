"""Every CLI script builds its parser in one place and takes argv."""

import argparse
import importlib
import inspect
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

CLI_SCRIPTS = [
    "dnd_ddb", "dnd_sheet", "graph_check", "gurps_check",
    "gurps_skill_default", "index_build", "ingest_images", "ingest_survey",
    "links", "migrate", "moments", "plan_check", "plans_index", "prop_move",
    "reconcile_scan", "relink", "reveal", "reveal_scan", "rules_lookup",
    "scene_queue", "schema_rules", "session_context", "stamp_entities",
    "tones", "vault_check", "vault_scaffold", "vault_search", "vault_write",
]


class EntryPointTests(unittest.TestCase):
    def test_every_cli_script_builds_its_parser_without_side_effects(self):
        for name in CLI_SCRIPTS:
            with self.subTest(script=name):
                mod = importlib.import_module(name)
                parser = mod.build_parser()
                self.assertIsInstance(parser, argparse.ArgumentParser)
                self.assertTrue(parser.format_help().strip())

    def test_main_takes_argv(self):
        for name in CLI_SCRIPTS:
            with self.subTest(script=name):
                mod = importlib.import_module(name)
                params = list(inspect.signature(mod.main).parameters.values())
                self.assertTrue(params, f"{name}.main takes no argv")
                self.assertIsNone(params[0].default)
                self.assertEqual(params[0].name, "argv")

    def test_cli_list_matches_the_scripts_that_have_a_main(self):
        found = sorted(
            p.stem for p in SCRIPTS.glob("*.py")
            if "\ndef main(" in p.read_text(encoding="utf-8"))
        self.assertEqual(found, sorted(CLI_SCRIPTS))


if __name__ == "__main__":
    unittest.main()
