import subprocess, sys, unittest
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import gen_ontology_docs as gen  # noqa: E402

class Generated(unittest.TestCase):
    def test_every_copy_is_current(self):
        for path, text in gen.outputs().items():
            self.assertEqual(path.read_text(encoding="utf-8"), text, f"{path} is stale: run scripts/gen_ontology_docs.py")

    def test_check_mode_exits_zero_when_current(self):
        done = subprocess.run([sys.executable, str(REPO / "scripts/gen_ontology_docs.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_hand_edit_is_caught(self):
        text = (REPO / "skills/shared/entity-schema.md").read_text(encoding="utf-8")
        edited = text.replace("| Kinship |", "| Kin |", 1)
        self.assertNotEqual(gen.render(edited, gen.blocks(gen.ontology())), edited)

    def test_every_marker_pair_is_present(self):
        for path, text in gen.outputs().items():
            if path.suffix == ".md":
                for name in gen.MARKERS[path.name]:
                    self.assertIn(f"<!-- generated:{name} ", text)
                    self.assertIn(f"<!-- /generated:{name} -->", text)

    def test_mobrpg_copy_equals_the_source(self):
        src = (REPO / "skills/shared/gm-apprentice-ontology.json").read_text(encoding="utf-8")
        self.assertEqual((REPO / "tools/mobrpg/mobrpg/gm-apprentice-ontology.json").read_text(encoding="utf-8"), src)

    def test_a_new_vault_does_not_copy_the_markers(self):
        sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
        import vault_scaffold
        self.assertIn("**Tones.**", vault_scaffold.entity_types_text())
        self.assertNotIn("generated:", vault_scaffold.entity_types_text())


class MarkerForms(unittest.TestCase):
    def test_an_opener_in_another_form_is_an_error_not_a_pass(self):
        text = (REPO / "skills/shared/entity-schema.md").read_text(encoding="utf-8")
        odd = text.replace("<!-- generated:tones (scripts/gen_ontology_docs.py) -->",
                           "<!-- generated:tones -->")
        self.assertNotEqual(odd, text)
        with self.assertRaises(ValueError):
            gen.render(odd, gen.blocks(gen.ontology()))
        self.assertEqual(gen._missing("entity-schema.md", odd), ["tones"])
