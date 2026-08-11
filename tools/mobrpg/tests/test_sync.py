import os

from mobrpg import client, node as _node
from mobrpg.commands import sync_cmd, submit_batch


NOTE = """---
name: Marsh Hag
mobrpg:
  world_id: "w1"
  external_ref: "ns:People/marsh-hag"
  element_id: "e-77"
  element_kind: "Creature"
  review_state: "accepted"
  last_synced: "2026-07-20T00:00:00Z"
---

Old vault prose.

## GM Notes

Secret plans.
"""


def _vault(tmp_path, text=NOTE, mtime=None):
    p = tmp_path / "Creatures" / "marsh-hag.md"
    p.parent.mkdir(parents=True)
    p.write_text(text, encoding="utf-8")
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return tmp_path


def _wire(monkeypatch, detail, submitted):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda m, p, **k: detail if m == "GET" else {})
    monkeypatch.setattr(submit_batch, "submit",
                        lambda world, req, execute, index=None: submitted.append(req))


def test_pull_overwrites_body_preserves_gm_notes_stamps(tmp_path, monkeypatch):
    v = _vault(tmp_path, mtime=1_700_000_000)  # older than server
    detail = {"description": "<p>New canon prose.</p>",
              "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    rc = sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert rc == 0
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "New canon prose." in txt and "Old vault prose." not in txt
    assert "## GM Notes" in txt and "Secret plans." in txt
    nd = _node.read_node(txt)
    assert nd["last_synced"] > "2026-07-24"        # stamped now


def test_push_files_update_suggestion_and_marks_pending(tmp_path, monkeypatch):
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)  # vault freshly edited (mtime = now)
    detail = {"description": "<p>Stale server text.</p>",
              "lastModified": "2026-07-21T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert len(submitted) == 1
    sug = submitted[0]["suggestions"][0]
    assert sug["payload"]["operation"] == "UpdateElement"
    assert sug["payload"]["targetRef"] == "e-77"
    assert "Old vault prose." in sug["payload"]["description"]
    assert "Secret plans." not in sug["payload"]["description"]   # GM Notes never pushed
    nd = _node.read_node(p.read_text(encoding="utf-8"))
    assert nd["review_state"] == "pending"
    assert nd["last_synced"] == "2026-07-20T00:00:00Z"             # NOT stamped


def test_identical_content_stamps_without_suggestion(tmp_path, monkeypatch):
    v = _vault(tmp_path)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Old vault prose.</p>",
              "lastModified": "2026-07-19T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert submitted == []
    nd = _node.read_node((v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8"))
    assert nd["last_synced"] > "2026-07-24"


def test_pending_note_is_held(tmp_path, monkeypatch):
    v = _vault(tmp_path, NOTE.replace('"accepted"', '"pending"'))
    calls = []
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", lambda *a, **k: calls.append(a) or {})
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert calls == []          # not even fetched


NOTE_LINKS = """---
name: Marsh Hag
mobrpg:
  world_id: "w1"
  external_ref: "ns:People/marsh-hag"
  element_id: "e-77"
  element_kind: "Creature"
  review_state: "accepted"
  last_synced: "2026-07-20T00:00:00Z"
---

The village fears [[Marsh Hag]] greatly.

## GM Notes

The twist about [[Marsh Hag]] is secret.
"""


def test_push_rewrites_body_wikilinks_not_gm_notes(tmp_path, monkeypatch):
    # A wikilink in the pushed body becomes a markdown element link; the GM Notes
    # tail (with its own wikilink) is never pushed and never rewritten. The
    # payload is raw Markdown (#150), not an HTML-converted anchor.
    v = _vault(tmp_path, NOTE_LINKS)
    os.utime(v / "Creatures" / "marsh-hag.md", None)  # vault freshly edited
    detail = {"description": "<p>Stale server text.</p>",
              "lastModified": "2026-07-21T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    payload = submitted[0]["suggestions"][0]["payload"]
    assert payload["descriptionType"] == "Markdown"
    desc = payload["description"]
    assert "[Marsh Hag](https://www.mobrpg.com/world/w1/link/e-77)" in desc
    assert "<a href" not in desc
    assert "[[" not in desc
    assert "GM Notes" not in desc and "is secret" not in desc


def test_pull_rewrites_element_url_to_wikilink(tmp_path, monkeypatch):
    # A known element URL in the server description comes back to the vault as a
    # wikilink (id-only redirect route resolved via the {element_id: name} map).
    v = _vault(tmp_path, mtime=1_700_000_000)  # older than server -> pull
    url = "https://www.mobrpg.com/world/w1/link/e-77"
    detail = {"description": f'<p>Beware <a href="{url}">Marsh Hag</a>.</p>',
              "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "[[Marsh Hag]]" in txt
    assert url not in txt


def test_sync_is_idempotent_after_stamp(tmp_path, monkeypatch):
    # After the in-sync path stamps last_synced, the file mtime is pinned to that
    # stamp, so a second sync with the same server detail decides skip — no second
    # write (mtime unchanged) and no suggestion filed.
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)  # vault freshly edited (mtime = now)
    detail = {"description": "<p>Old vault prose.</p>",
              "lastModified": "2026-07-19T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])   # in-sync: stamps + pins
    assert submitted == []
    mtime1 = os.path.getmtime(p)
    content1 = p.read_text(encoding="utf-8")

    sync_cmd.run(["w1", "--vault", str(v), "--execute"])   # must be skip
    assert submitted == []                                 # nothing filed
    assert os.path.getmtime(p) == mtime1                   # no second write
    assert p.read_text(encoding="utf-8") == content1


def test_dismissed_suggestion_not_refiled(tmp_path, monkeypatch):
    # A note pushed (pending) then GM-dismissed via pull-canon must NOT get its
    # suggestion re-filed on the next sync: the dismiss stamp pins the file mtime,
    # so decide sees skip, not push (design §2 guarantee).
    from mobrpg.commands import pull_canon
    note = NOTE.replace('external_ref: "ns:People/marsh-hag"',
                        'external_ref: "ns:Creatures/marsh-hag"')
    v = _vault(tmp_path, note)
    p = v / "Creatures" / "marsh-hag.md"

    # 1. push: server text differs -> suggestion filed, review_state=pending
    os.utime(p, None)  # freshly edited
    submitted = []
    _wire(monkeypatch, {"description": "<p>Stale server text.</p>",
                        "lastModified": "2026-07-21T00:00:00Z"}, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert len(submitted) == 1
    assert _node.read_node(p.read_text(encoding="utf-8"))["review_state"] == "pending"

    # 2. simulate GM adjudication: dismiss via pull-canon (stamps + pins mtime).
    #    The queue answers under the ref the push actually claimed — an `upd/`
    #    content-hashed one (#151) — which pull-canon maps back to this note.
    upd_ref = submitted[0]["suggestions"][0]["externalRef"]
    assert upd_ref.startswith("ns:upd/Creatures/marsh-hag#")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(
        pull_canon, "_fetch_live",
        lambda world, token, *, verify=True: {
            upd_ref: {"state": "dismissed", "element_id": None,
                      "review_note": "not canon", "determined": {},
                      "event_ids": {}}})
    # Keep the #153 liveness gate off the network — this fixture has no
    # element_id for the gate to consult.
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: set())
    pull_canon.run(["w1", "--vault", str(v), "--execute"])
    assert _node.read_node(p.read_text(encoding="utf-8"))["review_state"] == "dismissed"

    # 3. next sync: server still older than the dismiss stamp and still differing
    #    -> must be skip, not a re-filed suggestion.
    submitted2 = []
    _wire(monkeypatch, {"description": "<p>Stale server text.</p>",
                        "lastModified": "2026-07-21T00:00:00Z"}, submitted2)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert submitted2 == []                                        # NOT re-filed
    assert _node.read_node(p.read_text(encoding="utf-8"))["review_state"] == "dismissed"


def test_dry_run_writes_nothing(tmp_path, monkeypatch):
    v = _vault(tmp_path, mtime=1_700_000_000)
    before = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    _wire(monkeypatch, {"description": "<p>X</p>",
                        "lastModified": "2026-07-24T00:00:00Z"}, [])
    sync_cmd.run(["w1", "--vault", str(v)])
    assert (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8") == before


def test_push_suggestion_carries_markdown_descriptiontype(tmp_path, monkeypatch):
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)                                  # vault newer than server
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert submitted, "expected an UpdateElement batch"
    item = submitted[0]["suggestions"][0]
    pl = item["payload"]
    assert pl["descriptionType"] == "Markdown"
    assert "<p>" not in pl["description"]              # raw markdown, not HTML
    assert "Old vault prose." in pl["description"]


def test_update_ref_uses_upd_namespace_with_content_hash(tmp_path, monkeypatch):
    # #151: an update's externalRef is its own namespaced, content-hashed key —
    # NOT the note's `<ns>:<relpath>` create ref, which accept-once semantics
    # would burn on the first adjudication.
    v = _vault(tmp_path)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    ref = submitted[0]["suggestions"][0]["externalRef"]
    assert ref.startswith("ns:upd/People/marsh-hag#")
    assert len(ref.rsplit("#", 1)[1]) == 12            # sha256[:12]


def test_push_records_the_minted_ref_as_pending_ref(tmp_path, monkeypatch):
    # The node records exactly which update it is waiting on, so pull-canon can
    # tell this episode's verdict from a stale terminal row for the same note.
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    submitted = []
    _wire(monkeypatch, {"description": "<p>Server prose.</p>",
                        "lastModified": "2026-07-01T00:00:00Z"}, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    nd = _node.read_node(p.read_text(encoding="utf-8"))
    assert nd["review_state"] == "pending"
    assert nd["pending_ref"] == submitted[0]["suggestions"][0]["externalRef"]


def test_update_ref_is_stable_for_identical_content(tmp_path, monkeypatch):
    # Same markdown re-pushed -> same ref, so the server corrects the caller's own
    # Pending row in place instead of stacking duplicates.
    refs = []
    for i in range(2):
        v = _vault(tmp_path / f"run{i}")
        os.utime(v / "Creatures" / "marsh-hag.md", None)
        submitted = []
        _wire(monkeypatch, {"description": "<p>Server prose.</p>",
                            "lastModified": "2026-07-01T00:00:00Z"}, submitted)
        sync_cmd.run(["w1", "--vault", str(v), "--execute"])
        refs.append(submitted[0]["suggestions"][0]["externalRef"])
    assert refs[0] == refs[1]


def test_update_ref_changes_when_content_changes(tmp_path, monkeypatch):
    # New content -> new ref, so a terminal (Accepted/Dismissed) old row can never
    # swallow the new proposal.
    refs = []
    for i, prose in enumerate(("Old vault prose.", "Rewritten vault prose.")):
        v = _vault(tmp_path / f"run{i}", NOTE.replace("Old vault prose.", prose))
        os.utime(v / "Creatures" / "marsh-hag.md", None)
        submitted = []
        _wire(monkeypatch, {"description": "<p>Server prose.</p>",
                            "lastModified": "2026-07-01T00:00:00Z"}, submitted)
        sync_cmd.run(["w1", "--vault", str(v), "--execute"])
        refs.append(submitted[0]["suggestions"][0]["externalRef"])
    assert refs[0] != refs[1]


def test_pull_markdown_description_skips_html_conversion(tmp_path, monkeypatch):
    v = _vault(tmp_path, mtime=1_700_000_000)          # server newer
    detail = {"description": "New **canon** prose.",
              "descriptionType": "Markdown",
              "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "New **canon** prose." in txt               # verbatim, not round-tripped


def test_markdown_server_description_compares_in_html_space(tmp_path, monkeypatch):
    # Same content both sides, server stored as Markdown → in-sync, no suggestion.
    text = NOTE.replace("Old vault prose.", "Same prose.")
    v = _vault(tmp_path, text=text)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    detail = {"description": "Same prose.", "descriptionType": "Markdown",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert not submitted                               # in-sync, nothing filed
