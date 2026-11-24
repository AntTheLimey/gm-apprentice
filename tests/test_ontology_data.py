import json, re, shutil, subprocess, sys, unittest
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent

ONT = json.loads((REPO / "skills/shared/gm-apprentice-ontology.json").read_text(encoding="utf-8"))

VOCAB = frozenset(p["type"] for p in ONT["predicates"])
INVERSES = frozenset(p["inverse"] for p in ONT["predicates"] if p.get("inverse"))


def type_key(raw):
    return re.sub(r"[\s-]+", "_", str(raw).strip().lower())


class OntologyData(unittest.TestCase):
    def test_the_file_is_its_own_source(self):
        self.assertEqual(ONT["source_of_truth"], "skills/shared/gm-apprentice-ontology.json")

    def test_every_verb_choice_is_a_real_predicate(self):
        vocab = VOCAB
        for verb, choices in ONT["verbs"].items():
            self.assertEqual(verb, type_key(verb), verb)
            self.assertNotIn(verb, vocab, f"{verb} is already a predicate")
            for c in choices:
                self.assertIn(c["use"], vocab, verb)
                self.assertIsInstance(c["flip"], bool)

    def test_no_verb_repeats_an_inverse_name(self):
        # Inverse names are already exact fixes as inverse names.
        self.assertFalse(set(ONT["verbs"]) & INVERSES)

    def test_same_fact_pairs_are_predicates(self):
        self.assertIn(["serves", "employs"], [list(p) for p in ONT["same_fact"]])
        for a, b in ONT["same_fact"]:
            self.assertIn(a, VOCAB)
            self.assertIn(b, VOCAB)

    def test_place_fields(self):
        self.assertEqual({p["field"] for p in ONT["place_fields"]}, {"parent_location", "current_holder"})

    # Task 20: each system the run sheet fights in has its Table Log columns.
    def test_every_system_with_fights_has_run_sheet_vitals(self):
        systems = {s["id"]: s for s in ONT["game_systems"]}
        fields = {"hp", "fp", "mp", "san", "luck", "conditions"}
        shapes = {"current/max", "current", "text"}
        for sid in ("dnd-5e-2024", "coc-7e", "coc-7e-regency", "gurps-4e"):
            vitals = systems[sid]["run_sheet"]["vitals"]
            self.assertEqual(vitals[0]["field"], "hp", sid)
            self.assertEqual(vitals[-1]["field"], "conditions", sid)
            for col in vitals:
                self.assertIn(col["field"], fields, sid)
                self.assertIn(col["shape"], shapes, sid)
                self.assertTrue(col["column"].strip(), sid)
        cols = lambda sid: [c["column"] for c in systems[sid]["run_sheet"]["vitals"]]
        self.assertEqual(cols("dnd-5e-2024"), ["HP", "Conditions"])
        self.assertEqual(cols("coc-7e"), ["HP", "MP", "SAN", "Luck", "Conditions"])
        # Regency is CoC's own list: SAN kept, no Reputation column (Ant, 2026-11-22)
        self.assertEqual(cols("coc-7e-regency"), cols("coc-7e"))
        self.assertEqual(cols("gurps-4e"), ["HP", "FP", "Conditions"])
        luck = [c for c in systems["coc-7e"]["run_sheet"]["vitals"] if c["field"] == "luck"]
        self.assertTrue(luck[0]["pcs_only"])
        # PF2e and FitD keep no Fight, so no columns of their own
        for sid in ("pf2e", "fitd"):
            self.assertNotIn("run_sheet", systems[sid])

    # Task 21: wrap-up writes each column onto the sheet by the key `sheet set` takes.
    def test_every_vitals_sheet_key_is_one_sheet_set_takes(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not installed")
        script = (
            "const p = require('path');"
            "const lib = p.join(process.argv[1], 'tools/publish/lib');"
            "const { writerFor } = require(p.join(lib, 'sheet-set.js'));"
            "const { systemFor } = require(p.join(lib, 'run-sheet/systems'));"
            "const out = {};"
            "for (const id of JSON.parse(process.argv[2])) out[id] = {"
            " keys: Object.keys(writerFor({ system: id }, '', '').keys),"
            " statuses: systemFor(id).describe().statuses || [] };"
            "console.log(JSON.stringify(out));"
        )
        sids = ["coc-7e", "coc-7e-regency", "gurps-4e", "dnd-5e-2024"]
        res = subprocess.run([node, "-e", script, str(REPO), json.dumps(sids)],
                             capture_output=True, text=True, check=True)
        node_says = json.loads(res.stdout)
        systems = {s["id"]: s for s in ONT["game_systems"]}
        for sid in sids:
            takes = node_says[sid]["keys"]
            checked = 0
            for col in systems[sid]["run_sheet"]["vitals"]:
                sheet = col.get("sheet")
                if sheet is None:
                    continue
                named = list(sheet.values()) if isinstance(sheet, dict) else [sheet]
                for key in named:
                    self.assertIn(key, takes, f"{sid} {col['column']}")
                    checked += 1
                if isinstance(sheet, dict):
                    for word in sheet:
                        self.assertIn(word, node_says[sid]["statuses"], f"{sid}: {word}")
            self.assertTrue(checked, f"{sid} maps no column onto the sheet")

    def test_vitals_sheet_map(self):
        systems = {s["id"]: s for s in ONT["game_systems"]}
        plain = lambda sid: {c["column"]: c.get("sheet") for c in systems[sid]["run_sheet"]["vitals"] if c["shape"] != "text"}
        for sid in ("coc-7e", "coc-7e-regency"):
            self.assertEqual(plain(sid), {"HP": "hp", "MP": "mp", "SAN": "san", "Luck": "luck"})
            cond = systems[sid]["run_sheet"]["vitals"][-1]
            self.assertIs(cond.get("both_ways"), True, sid)
            self.assertEqual(cond["sheet"], {
                "Major wound": "major-wound", "Unconscious": "unconscious", "Dying": "dying",
                "Temporary insanity": "temporary-insanity", "Indefinite insanity": "indefinite-insanity",
            })
        self.assertEqual(plain("gurps-4e"), {"HP": "hp", "FP": "fp"})
        self.assertEqual(plain("dnd-5e-2024"), {"HP": "hp"})
        # Only CoC's statuses go both ways; GURPS and D&D Conditions are not mapped.
        for sid in ("gurps-4e", "dnd-5e-2024"):
            cond = systems[sid]["run_sheet"]["vitals"][-1]
            self.assertNotIn("sheet", cond, sid)
            self.assertNotIn("both_ways", cond, sid)
