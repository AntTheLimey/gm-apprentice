#!/usr/bin/env python3
"""A new campaign's secret places and groups stay off its first player site (#619).

The-midwife builds a vault with `gma vault-scaffold` and writes each promoted
entity from the vault's own template. A place or group that is itself the
secret (a cult lodge the players have not heard of, a sub-basement they have
not found) is marked `withheld: true`. A new vault has no publish list yet, so
before #619 the first build gave both a page. Here the same scaffold builds the
vault, the notes are written from its templates as the midwife writes them, and
the publish tool's own `init` and `build` make the site: no page and no word of
either secret reaches it, an ordinary place and group still publish, and the
site doctor reports no error for the public page's link to a secret. Then the
GM's own steps: the publish list made as publish-site's setup makes it, and
`gma reveal` after the session that uncovers both; the secrets publish and the
leak check passes.

Run: python3 tests/test_midwife_secrets.py
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
BIN = ROOT / "tools" / "publish" / "bin" / "gm-publish.js"
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs node")

# Words that appear only in the secret notes: their names and their bodies.
SECRET_WORDS = ("Library Sub-basement", "library-sub-basement", "Zanzibar Vault",
                "Silver Twilight", "silver-twilight", "Xylophone Rite")
PUBLIC_WORDS = ("Quixotic lamps", "Jubilee bake sale")


def run(args, cwd=None, ok=(0,)):
    r = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    if r.returncode not in ok:
        raise AssertionError(f"{args[:3]} exited {r.returncode}\n{r.stdout}\n{r.stderr}")
    return r.stdout


def from_template(vault: Path, template: str, name: str, secret: bool, body: str) -> str:
    """A note as the midwife writes one: the vault's template frontmatter with
    its name filled in and, for a secret, `withheld: true`; then the body."""
    text = (vault / "_Templates" / template).read_text(encoding="utf-8")
    fm = text.split("\n---\n", 1)[0].removeprefix("---\n")
    fm = fm.replace('name: ""', f'name: "{name}"', 1)
    lines = [ln for ln in fm.splitlines() if not ln.startswith("withheld:")]
    lines.append(f"withheld: {'true' if secret else 'false'}")
    return "---\n" + "\n".join(lines) + f"\n---\n\n{body}\n"


@NEEDS_NODE
class SecretPlacesAndGroups(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="midwife-secrets-"))
        vault = cls.root / "V"
        cls.vault = vault
        run([sys.executable, str(SCRIPTS / "vault_scaffold.py"), str(vault),
             "--system", "coc-7e", "--name", "The Sloane Collection", "--write"])
        notes = {
            "Locations/Library Sub-basement.md": from_template(
                vault, "_Template_Location.md", "Library Sub-basement", True,
                "## Description\n\nThe Zanzibar Vault, under the stacks.\n\n"
                "## Related\n\n- **Places:** [[Sloane Library]] — beneath it"),
            "Locations/Sloane Library.md": from_template(
                vault, "_Template_Location.md", "Sloane Library", False,
                "## Description\n\nQuiet reading rooms under Quixotic lamps.\n\n"
                "## Related\n\n- **Places:** [[Library Sub-basement]] — beneath it\n"
                "- **Groups:** [[Friends of the Library]] — they fund it"),
            "Factions & Organizations/Silver Twilight Boston.md": from_template(
                vault, "_Template_Faction.md", "Silver Twilight Boston", True,
                "## Overview\n\nThe lodge works the Xylophone Rite.\n\n"
                "## Related\n\n- **Places:** [[Sloane Library]] — they meet below it"),
            "Factions & Organizations/Friends of the Library.md": from_template(
                vault, "_Template_Faction.md", "Friends of the Library", False,
                "## Overview\n\nThey run the Jubilee bake sale.\n\n"
                "## Related\n\n- **Places:** [[Sloane Library]] — their cause"),
        }
        for rel, text in notes.items():
            (vault / rel).write_text(text, encoding="utf-8")
        cls.site = cls.root / "site"
        run(["node", str(BIN), "init", str(cls.site), "--vault", str(vault),
             "--title", "The Sloane Collection"])
        # init pins the site to this checkout (`file:`), a pin the vault scripts
        # cannot read; without one they ask the plugin's own tool, this checkout.
        (cls.site / "package.json").unlink()
        cls.log = run(["node", str(BIN), "build"], cwd=cls.site)
        cls.docs = cls.site / "docs"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def built(self):
        return sorted(p for p in self.docs.rglob("*") if p.is_file())

    def pages(self):
        return {p.relative_to(self.docs).as_posix() for p in self.built()
                if p.suffix == ".html"}

    def test_1_no_page_for_a_secret_place_or_group(self):
        pages = self.pages()
        self.assertNotIn("locations/library-sub-basement.html", pages)
        self.assertNotIn("factions/silver-twilight-boston.html", pages)
        self.assertIn("Kept off 2 note(s) marked withheld", self.log)

    def test_1_no_word_of_either_secret_anywhere_on_the_site(self):
        for path in self.built():
            text = path.read_text(encoding="utf-8", errors="replace").lower()
            leaked = [w for w in SECRET_WORDS if w.lower() in text]
            self.assertEqual(leaked, [], f"in {path.relative_to(self.docs)}")

    def test_1_an_ordinary_place_and_group_still_publish(self):
        pages = self.pages()
        self.assertIn("locations/sloane-library.html", pages)
        self.assertIn("factions/friends-of-the-library.html", pages)
        library = (self.docs / "locations" / "sloane-library.html").read_text(encoding="utf-8")
        friends = (self.docs / "factions" / "friends-of-the-library.html").read_text(encoding="utf-8")
        self.assertIn(PUBLIC_WORDS[0], library)
        self.assertIn(PUBLIC_WORDS[1], friends)

    def test_1_the_doctor_reports_no_error_for_a_link_to_a_secret(self):
        out = run(["node", str(BIN), "doctor", "--site", "--json"], cwd=self.site, ok=(0, 1))
        findings = json.loads(out)["findings"]
        self.assertEqual([f for f in findings if f["severity"] == "error"], [])
        named = [f for f in findings if f["code"] == "NAMED_NO_PAGE"]
        self.assertEqual([(f["path"], f["severity"], f["settled"]) for f in named],
                         [("Locations/Library Sub-basement.md", "info", True)])
        # No fix may suggest `manifest apply`: on a vault with no publish list it
        # would make a list of one entry and empty the site.
        self.assertNotIn("manifest apply", out)

    def test_2_the_gm_sets_up_the_list_then_reveals_both(self):
        config = str(self.site / "vault.config.json")
        # publish-site's setup: publish what diff says publishes, exclude the rest.
        diff = json.loads(run(["node", str(BIN), "manifest", "diff", "--config", config, "--json"]))
        args = ["node", str(BIN), "manifest", "apply", "--config", config]
        for row in diff["new"]:
            if row["bucket"] == "publish":
                args += ["--publish", row["path"]]
            else:
                args += ["--exclude", f"{row['path']}=stays hidden: {row['reason']}"]
        run(args)
        run(["node", str(BIN), "build"], cwd=self.site)
        self.assertNotIn("locations/library-sub-basement.html", self.pages())
        self.assertIn("locations/sloane-library.html", self.pages())

        secrets = ["Locations/Library Sub-basement.md",
                   "Factions & Organizations/Silver Twilight Boston.md"]
        reveal = [sys.executable, str(SCRIPTS / "reveal.py"), str(self.vault),
                  "--session", "Session 03 - Below the Stacks"]
        for rel in secrets:
            reveal += ["--publish", rel]
        said = run(reveal + ["--write"])
        self.assertIn("# publish: 2 clear: 2", said)
        for rel in secrets:
            self.assertIn("withheld: false", (self.vault / rel).read_text(encoding="utf-8"))
        run(["node", str(BIN), "build"], cwd=self.site)
        pages = self.pages()
        self.assertIn("locations/library-sub-basement.html", pages)
        self.assertIn("factions/silver-twilight-boston.html", pages)
        self.assertIn("locations/sloane-library.html", pages)
        leaks = run(["node", str(BIN), "leaks", "check", "--json"], cwd=self.site, ok=(0, 1))
        self.assertEqual(json.loads(leaks)["findings"], [], leaks)

if __name__ == "__main__":
    unittest.main()
