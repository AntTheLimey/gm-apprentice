"""1.11.3 update step `publish-row-pipe`: the stock `publish` row of
`_meta/entity-types.md` wrote its values as an escaped pipe, which the table
check reports as an ERROR. The cell is rewritten as `false` or `stub`."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
import vault_check  # noqa: E402
from migrate_core import WILL  # noqa: E402

REL = "_meta/entity-types.md"
OLD = "`false` \\| `stub`"
NEW = "`false` or `stub`"
HEAD = "# Entity types\n\n| Field | Values | Meaning |\n|---|---|---|\n"
STOCK_ROW = f"| `publish` | {OLD} | `false` — hidden; `stub` — a stub page. |\n"
OLDER_ROW = (f"| `publish` | {OLD} | `false` — no page is emitted in any mode; "
             "the file still parses, and links to it show as plain text. |\n")
OTHER = "| `status` | `active` | Whether it is live. |\n"
TAIL = "\nMy own notes, with `false` \\| `stub` in prose.\n"


def make_vault(case, text=None):
    vault = Path(tempfile.mkdtemp(prefix="mig-pubrow-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n",
                                                       encoding="utf-8")
    if text is not None:
        (vault / REL).write_bytes(text.encode("utf-8"))
    return vault


def raw(vault):
    return (vault / REL).read_bytes().decode("utf-8")


def run(vault):
    (item,) = mv.find_publish_row_pipe(vault)
    assert (item.id, item.group) == ("publish-row-pipe", WILL)
    item.apply(None)


class PublishRowPipeTests(unittest.TestCase):
    def test_stock_row_repaired(self):
        v = make_vault(self, HEAD + OTHER + STOCK_ROW + TAIL)
        run(v)
        self.assertEqual(raw(v), HEAD + OTHER
                         + STOCK_ROW.replace(OLD, NEW) + TAIL)

    def test_older_wording_repaired_rest_of_row_unchanged(self):
        v = make_vault(self, HEAD + OLDER_ROW + OTHER)
        run(v)
        self.assertEqual(raw(v), HEAD + OLDER_ROW.replace(OLD, NEW) + OTHER)

    def test_customised_row_left_alone(self):
        text = HEAD + f"| `publish` | `false` \\| `stub` \\| `full` | mine |\n"
        v = make_vault(self, text)
        self.assertEqual(mv.find_publish_row_pipe(v), [])
        self.assertEqual(raw(v), text)
        other = HEAD + "| `publish` | `true` | mine |\n"
        v = make_vault(self, other)
        self.assertEqual(mv.find_publish_row_pipe(v), [])

    def test_other_rows_and_prose_left_alone(self):
        text = HEAD + f"| `publishable` | {OLD} | x |\n" + TAIL
        v = make_vault(self, text)
        self.assertEqual(mv.find_publish_row_pipe(v), [])

    def test_crlf_kept(self):
        v = make_vault(self, (HEAD + STOCK_ROW + OTHER).replace("\n", "\r\n"))
        run(v)
        self.assertEqual(raw(v), (HEAD + STOCK_ROW.replace(OLD, NEW) + OTHER)
                         .replace("\n", "\r\n"))

    def test_no_file_no_item(self):
        self.assertEqual(mv.find_publish_row_pipe(make_vault(self)), [])

    def test_second_run_offers_nothing(self):
        v = make_vault(self, HEAD + STOCK_ROW)
        run(v)
        self.assertEqual(mv.find_publish_row_pipe(v), [])

    def test_table_check_clean_after_repair(self):
        v = make_vault(self, HEAD + OLDER_ROW)
        self.assertTrue(any("publish" in f or "\\|" in f or "pipe" in f.lower()
                            for f in vault_check.table_findings(REL, raw(v))))
        run(v)
        self.assertEqual(vault_check.table_findings(REL, raw(v)), [])

    def test_the_check_is_registered(self):
        (check,) = [c for c in mv.VAULT_CHECKS if c.name == "publish-row-pipe"]
        self.assertEqual((check.release, check.band, check.kind),
                         ("1.11.3", 3, "bookkeeping"))


if __name__ == "__main__":
    unittest.main()
