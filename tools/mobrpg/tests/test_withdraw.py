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


def _row(sid, op="CreateElement", state="Pending", name="Kate", ref=None, batch="b1",
         local=None):
    r = {"id": sid, "operation": op, "reviewState": state, "batchId": batch,
         "externalRef": ref, "payload": {"name": name}}
    if local:
        r["ref"] = local
    return r


def _rel(sid, target, state="Pending", batch="b1"):
    r = _row(sid, op="AddRelation", name="", state=state, batch=batch)
    r["payload"].update(sourceRef="some-race-id", targetRef=f"suggestion:{target}")
    return r


class Fake:
    """An in-memory suggestion queue behind client._request."""

    def __init__(self, rows, delete_works=True, flip_to=None, page_size=None, lie_total=None):
        self.rows = list(rows)
        self.calls = []
        self.delete_works = delete_works
        self.flip_to = flip_to          # on DELETE, the row turns this state instead
        self.page_size = page_size
        self.lie_total = lie_total

    def __call__(self, method, path, *, token=None, body=None, query=None):
        self.calls.append((method, path))
        if method == "GET":
            state = path.split("reviewState=")[1]
            rows = [r for r in self.rows if r["reviewState"] == state]
            if self.page_size:
                pg = (query or {}).get("page", 0)
                n = self.page_size
                total = (len(rows) + n - 1) // n
                return {"content": rows[pg * n:(pg + 1) * n],
                        "page": {"totalPages": total,
                                 "totalElements": self.lie_total or len(rows)}}
            return rows
        if method == "DELETE":
            sid = path.rsplit("/", 1)[1]
            if self.flip_to:
                for r in self.rows:
                    if r["id"] == sid:
                        r["reviewState"] = self.flip_to
            elif self.delete_works:
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
    (tmp_path / "_meta").mkdir()
    (tmp_path / "_meta" / "mobrpg-map.json").write_text('{"vaultNamespace": "canticle"}')
    return tmp_path, f


KATE = "canticle:Characters/NPCs/Kate"


def rows():
    return [
        _row("c1", ref=KATE, local="e1"),
        _rel("r1", "e1"),
        _row("a1", state="Accepted", ref="canticle:Characters/NPCs/Done", name="Done"),
        _row("x1", ref="someoneelse:Notes/Theirs", name="Theirs", batch="b9"),
    ]


def test_verb_is_registered():
    assert "withdraw" in cli.NATIVE
    assert "withdraw" in dict(cli.VERB_HELP)


def test_needs_a_selection(monkeypatch):
    _wire(monkeypatch, Fake(rows()))
    assert withdraw.run(["w1", "--namespace", "canticle"]) == 2


def test_dry_run_lists_prints_id_line_and_deletes_nothing(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Pending suggestions to withdraw: 2 (1 linked relation(s) included)" in out
    assert f"mobrpg withdraw w1 --batch b1 --vault {v} --execute" in out
    assert fake.deletes() == []
    assert node.read_node(f.read_text())["review_state"] == "pending"


def test_only_with_execute_is_refused(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    assert withdraw.run(["w1", "--only", "Kate", "--vault", str(v), "--execute"]) == 2
    assert fake.calls == []


def test_only_dry_run_pulls_in_relations_the_name_did_not_match(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    _wire(monkeypatch, Fake(rows()))
    withdraw.run(["w1", "--only", "Kate", "--vault", str(v)])
    out = capsys.readouterr().out
    assert "r1" in out and "--id r1 c1" in out


def test_execute_deletes_relations_first(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    assert withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"]) == 0
    assert fake.deletes() == ["r1", "c1"]            # r1 came in by link, not by --id


def test_relation_linked_by_externalref_form_is_found(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    rel = _rel("r2", "x")
    rel["payload"]["targetRef"] = KATE
    fake = Fake([_row("c1", ref=KATE), rel])
    _wire(monkeypatch, fake)
    withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    assert fake.deletes() == ["r2", "c1"]


def test_never_deletes_someone_elses_suggestion(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--id", "x1", "--vault", str(v), "--execute"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Not ours, left alone: 1" in out and "x1" in out
    assert fake.deletes() == []


def test_batch_selector_skips_foreign_rows_in_same_batch(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert "x1" not in fake.deletes()


def test_execute_restamps_vault_node_dismissed_with_dated_note(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    _wire(monkeypatch, Fake(rows()))
    withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    nd = node.read_node(f.read_text())
    assert nd["review_state"] == "dismissed"
    assert nd["review_note"].startswith("withdrawn 20")
    assert "re-stamped dismissed: 1" in capsys.readouterr().out


def test_read_back_distrusts_the_delete_response(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    _wire(monkeypatch, Fake(rows(), delete_works=False))
    rc = withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    cap = capsys.readouterr()
    assert rc == 1
    assert "STILL PENDING after delete: 2" in cap.err
    assert "0 of 2" in cap.out
    assert node.read_node(f.read_text())["review_state"] == "pending"


def test_turned_accepted_meanwhile_is_not_stamped_withdrawn(monkeypatch, tmp_path, capsys):
    v, f = _vault(tmp_path)
    _wire(monkeypatch, Fake(rows(), flip_to="Accepted"))
    rc = withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    cap = capsys.readouterr()
    assert rc == 1
    assert "c1 became Accepted meanwhile" in cap.err
    assert node.read_node(f.read_text())["review_state"] == "pending"


def test_read_back_reports_what_is_left(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    _wire(monkeypatch, Fake(rows() + [_row("o1", name="Other", ref="canticle:Other", batch="b2")]))
    withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    assert "Pending queue now holds 2 suggestion(s)" in capsys.readouterr().out


def test_non_pending_is_never_deleted(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--id", "a1", "--vault", str(v), "--execute"])
    assert rc == 0
    assert "Not withdrawn: 1 Accepted" in capsys.readouterr().out
    assert fake.deletes() == []


def test_accepted_vault_node_is_left_alone(monkeypatch, tmp_path):
    v, f = _vault(tmp_path)
    f.write_text(NOTE.replace('"pending"', '"accepted"'))
    _wire(monkeypatch, Fake(rows()))
    withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    assert node.read_node(f.read_text())["review_state"] == "accepted"


def _mint_rows():
    mint = _row("m1", name="Unknown")                      # classifier type, no externalRef
    return rows()[:2] + [mint, _rel("r3", "m1")]


def test_batch_withdraws_its_classifier_mints_last(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    fake = Fake(_mint_rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert rc == 0
    d = fake.deletes()
    assert d[-1] == "m1" and set(d[:-1]) == {"r1", "r3", "c1"}
    assert d.index("r3") < d.index("c1")


def test_batch_dry_run_shows_mints_under_own_heading(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    _wire(monkeypatch, Fake(_mint_rows()))
    withdraw.run(["w1", "--batch", "b1", "--vault", str(v)])
    out = capsys.readouterr().out
    assert "Classifier types minted in this batch (deleted last): 1" in out
    assert "--batch b1 --vault" in out and "--execute" in out


def test_batch_with_a_foreign_externalref_is_refused_whole(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    fake = Fake(_mint_rows() + [_row("x9", ref="someoneelse:Y", name="Y")])
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert rc == 2 and "refusing the whole batch" in capsys.readouterr().err
    assert fake.deletes() == []


def test_id_and_only_leave_mints_alone(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    fake = Fake(_mint_rows())
    _wire(monkeypatch, fake)
    withdraw.run(["w1", "--id", "c1", "--vault", str(v), "--execute"])
    assert "m1" not in fake.deletes()


def test_every_page_is_read(monkeypatch, tmp_path):
    v, _ = _vault(tmp_path)
    many = [_row(f"c{i}", ref=f"canticle:N/{i}", name=f"N{i}") for i in range(5)]
    fake = Fake(many, page_size=2)
    _wire(monkeypatch, fake)
    withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert sorted(fake.deletes()) == [f"c{i}" for i in range(5)]


def test_short_read_fails_loudly(monkeypatch, tmp_path, capsys):
    v, _ = _vault(tmp_path)
    fake = Fake(rows(), page_size=2, lie_total=9)
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--execute"])
    assert rc == 1 and "queue read" in capsys.readouterr().err
    assert fake.deletes() == []


def test_execute_without_vault_refuses(monkeypatch, capsys):
    monkeypatch.delenv("MOBRPG_VAULT", raising=False)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--namespace", "canticle", "--execute"])
    assert rc == 2
    assert "--no-restamp" in capsys.readouterr().err
    assert fake.calls == []


def test_no_restamp_deletes_and_leaves_notes(monkeypatch, tmp_path):
    monkeypatch.delenv("MOBRPG_VAULT", raising=False)
    v, f = _vault(tmp_path)
    fake = Fake(rows())
    _wire(monkeypatch, fake)
    rc = withdraw.run(["w1", "--batch", "b1", "--vault", str(v), "--no-restamp", "--execute"])
    assert rc == 0
    assert fake.deletes() == ["r1", "c1"]
    assert node.read_node(f.read_text())["review_state"] == "pending"


def test_dry_run_without_vault_allowed_and_says_so(monkeypatch, capsys):
    monkeypatch.delenv("MOBRPG_VAULT", raising=False)
    _wire(monkeypatch, Fake(rows()))
    rc = withdraw.run(["w1", "--batch", "b1", "--namespace", "canticle"])
    cap = capsys.readouterr()
    assert rc == 0 and "no vault notes would be re-stamped" in cap.err


def test_no_vault_and_no_namespace_refuses(monkeypatch):
    monkeypatch.delenv("MOBRPG_VAULT", raising=False)
    _wire(monkeypatch, Fake(rows()))
    assert withdraw.run(["w1", "--batch", "b1"]) == 2


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
