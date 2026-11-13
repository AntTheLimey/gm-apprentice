import pytest

from mobrpg import client, cli, node
from mobrpg.commands import suggest, withdraw

NOTE = """---
mobrpg:
  world_id: "w1"
  external_ref: "canticle:Characters/NPCs/Kate"
  element_id: null
  element_kind: "Person"
  review_state: "pending"
  last_synced: ""
  review_note: ""
  determined: {}
  relationships: []
  languages: []
---
# Kate
"""


def _row(sid, op="CreateElement", state="Pending", name="Kate", ref=None, batch="b1"):
    return {"id": sid, "operation": op, "reviewState": state, "batchId": batch,
            "externalRef": ref, "payload": {"name": name}}


class Fake:
    """An in-memory suggestion queue behind client._request."""

    def __init__(self, rows, delete_works=True):
        self.rows = list(rows)
        self.calls = []
        self.delete_works = delete_works

    def __call__(self, method, path, *, token=None, body=None, query=None):
        self.calls.append((method, path))
        if method == "GET":
            state = path.split("reviewState=")[1]
            return [r for r in self.rows if r["reviewState"] == state]
        if method == "DELETE":
            sid = path.rsplit("/", 1)[1]
            if self.delete_works:
                self.rows = [r for r in self.rows if r["id"] != sid]
            return {"removedIds": [sid]}  # claims success either way
        raise AssertionError(method)

    def deletes(self):
        return [p.rsplit("/", 1)[1] for m, p in self.calls if m == "DELETE"]


def _wire(monkeypatch, fake):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)


def _vault(tmp_path):
    f = tmp_path / "Characters" / "NPCs" / "Kate.md"
    f.parent.mkdir(parents=True)
    f.write_text(NOTE)
    return tmp_path, f


ROWS = [
    _row("c1", ref="canticle:Characters/NPCs/Kate"),
    _row("t1", name="Human"),
    _row("r1", op="AddRelation", name=""),
    _row("a1", state="Accepted", ref="canticle:Characters/NPCs/Done", name="Done"),
]


def test_verb_is_registered():
    assert "withdraw" in cli.NATIVE
    assert "withdraw" in dict(cli.VERB_HELP)


def test_needs_a_selection(monkeypatch):
    _wire(monkeypatch, Fake(ROWS))
    assert withdraw.run(["w1"]) == 2


def test_dry_run_lists_and_deletes_nothing(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    fake = Fake(ROWS)
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "DRY-RUN" in out and "Pending suggestions matched: 3" in out
    assert fake.deletes() == []
    assert node.read_node(f.read_text())["review_state"] == "pending"


def test_execute_deletes_relations_first(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    fake = Fake(ROWS)
    _wire(monkeypatch, fake)
    assert withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"]) == 0
    assert fake.deletes() == ["r1", "c1", "t1"]


def test_execute_restamps_vault_node_dismissed_with_dated_note(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    _wire(monkeypatch, Fake(ROWS))
    withdraw.run(["w1", "--only", "Kate", "--vault", str(v), "--execute"])
    nd = node.read_node(f.read_text())
    assert nd["review_state"] == "dismissed"
    assert nd["review_note"].startswith("withdrawn 20")
    assert "re-stamped dismissed: 1" in capsys.readouterr().out


def test_read_back_distrusts_the_delete_response(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    fake = Fake(ROWS, delete_works=False)       # DELETE says removed; queue disagrees
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    cap = capsys.readouterr()
    assert rc == 1
    assert "STILL PENDING after delete: 3" in cap.err
    assert "Withdrawn (confirmed gone on read-back): 0 of 3" in cap.out
    assert node.read_node(f.read_text())["review_state"] == "pending"   # not stamped


def test_read_back_reports_what_is_left(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    _wire(monkeypatch, Fake(ROWS + [_row("o1", name="Other", batch="b2")]))
    withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert "Pending queue now holds 1 suggestion(s)" in capsys.readouterr().out


def test_non_pending_is_never_deleted(monkeypatch, tmp_path, capsys):
    fake = Fake(ROWS)
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--id", "a1", "--execute"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Not withdrawn: 1 Accepted" in out
    assert fake.deletes() == []


def test_accepted_vault_node_is_left_alone(monkeypatch, tmp_path):
    v, f = _vault(tmp_path)
    f.write_text(NOTE.replace('"pending"', '"accepted"'))
    _wire(monkeypatch, Fake(ROWS))
    withdraw.run(["w1", "--only", "Kate", "--vault", str(v), "--execute"])
    assert node.read_node(f.read_text())["review_state"] == "accepted"


# --- suggest guard -------------------------------------------------------

def _guard_vault(tmp_path):
    (tmp_path / "_meta").mkdir()
    (tmp_path / "_meta" / "mobrpg-map.json").write_text("{}")
    return tmp_path


def test_bare_suggest_execute_refuses(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(client, "_request", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("must refuse before any API call")))
    rc = suggest.run(["w1", "--vault", str(_guard_vault(tmp_path)), "--execute"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "--only, --chapter or --kind" in err and "--all" in err


@pytest.mark.parametrize("scope", [["--only", "x"], ["--chapter", "c"], ["--kind", "npc"], ["--all"]])
def test_suggest_execute_passes_guard_with_scope_or_all(tmp_path, scope, capsys):
    suggest.run(["w1", "--vault", str(_guard_vault(tmp_path)), "--execute", *scope])
    assert "would file the whole vault" not in capsys.readouterr().err


def test_bare_suggest_dry_run_is_not_refused(tmp_path, capsys):
    suggest.run(["w1", "--vault", str(_guard_vault(tmp_path))])
    assert "would file the whole vault" not in capsys.readouterr().err
