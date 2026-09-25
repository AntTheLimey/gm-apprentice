import json
import os

from mobrpg import client, lww, node as _node, section
from mobrpg.commands import sync_cmd, submit_batch
from mobrpg.vault import body_of, vault_only_sections


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


def test_fenced_heading_in_gm_notes_never_leaks_into_the_push(tmp_path, monkeypatch):
    # A ``` block under ## GM Notes whose first line starts with "## " used to
    # end the vault-only section early, so every GM line below it was pushed to
    # the shared world as canon.
    text = NOTE.replace(
        "Secret plans.\n",
        "The hag's real numbers:\n\n"
        "```\n## Stat block\nSTR 14, HP 22\n```\n\n"
        "She betrays the party in act three.\n")
    v = _vault(tmp_path, text=text)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    submitted = []
    _wire(monkeypatch, {"description": "<p>Stale server text.</p>",
                        "lastModified": "2026-07-21T00:00:00Z"}, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    desc = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "Old vault prose." in desc
    for secret in ("GM Notes", "real numbers", "Stat block", "STR 14",
                   "betrays the party"):
        assert secret not in desc


def test_unclosed_fence_in_canon_never_leaks_gm_notes_into_the_push(tmp_path, monkeypatch):
    # The other half of the fence rule: an unbalanced ``` marker ABOVE the
    # vault-only section must not turn the rest of the note into "code" and
    # hand ## GM Notes to the push candidate.
    text = NOTE.replace(
        "Old vault prose.",
        "Old vault prose.\n\n```\nan opener nobody closed")
    v = _vault(tmp_path, text=text)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    submitted = []
    _wire(monkeypatch, {"description": "<p>Stale server text.</p>",
                        "lastModified": "2026-07-21T00:00:00Z"}, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    desc = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "Old vault prose." in desc
    assert "GM Notes" not in desc and "Secret plans." not in desc


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


def test_pull_preserves_vault_only_sections(tmp_path, monkeypatch):
    text = NOTE.replace(
        "Old vault prose.",
        "Old vault prose.\n\n## Appearances\n\nSession 3 block.\n\n"
        "## Source References\n\n- wrapup 03")
    v = _vault(tmp_path, text=text, mtime=1_700_000_000)
    detail = {"description": "<p>New canon prose.</p>",
              "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "New canon prose." in txt
    assert "Session 3 block." in txt                 # #146: no longer destroyed
    assert "wrapup 03" in txt
    assert "Secret plans." in txt                    # GM Notes still preserved


def test_push_candidate_excludes_vault_only_sections(tmp_path, monkeypatch):
    text = NOTE.replace(
        "Old vault prose.",
        "Old vault prose.\n\n## Appearances\n\nSession 3 block.")
    v = _vault(tmp_path, text=text)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    desc = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "Session 3 block" not in desc             # #147: bookkeeping stays home
    assert "Old vault prose." in desc


def test_vault_superset_of_only_bookkeeping_is_in_sync(tmp_path, monkeypatch):
    # Server desc == vault canon prose; vault also has Appearances. No suggestion.
    text = NOTE.replace(
        "Old vault prose.",
        "Same prose.\n\n## Appearances\n\nSession 3 block.")
    v = _vault(tmp_path, text=text)
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Same prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert not submitted                             # the #147 storm case, killed


def test_vault_only_sections_config_replaces_default(tmp_path, monkeypatch):
    # A map file listing vaultOnlySections REPLACES the default list: "Lore" is
    # now vault-only and "GM Notes" is not (so it pushes).
    text = NOTE.replace(
        "Old vault prose.",
        "Old vault prose.\n\n## Lore\n\nLocal lore block.")
    v = _vault(tmp_path, text=text)
    (v / "_meta").mkdir()
    (v / "_meta" / "mobrpg-map.json").write_text(
        json.dumps({"vaultOnlySections": ["Lore"]}), encoding="utf-8")
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    desc = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "Local lore block" not in desc            # configured vault-only
    assert "Secret plans." in desc                   # default list no longer applies


def test_vault_only_config_without_gm_notes_warns(tmp_path, monkeypatch, capsys):
    # Replace semantics let a partial list opt GM secrets into the push. Sync
    # obeys the config, but says so loudly on stderr.
    v = _vault(tmp_path)
    (v / "_meta").mkdir()
    (v / "_meta" / "mobrpg-map.json").write_text(
        json.dumps({"vaultOnlySections": ["Lore"]}), encoding="utf-8")
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    _wire(monkeypatch, {"description": "<p>Server prose.</p>",
                        "lastModified": "2026-07-01T00:00:00Z"}, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    err = capsys.readouterr().err
    assert "vaultOnlySections" in err and "GM Notes" in err and "PUSHED" in err


def test_vault_only_config_with_gm_notes_does_not_warn(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    (v / "_meta").mkdir()
    (v / "_meta" / "mobrpg-map.json").write_text(
        json.dumps({"vaultOnlySections": ["GM Notes", "Lore"]}), encoding="utf-8")
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    _wire(monkeypatch, {"description": "<p>Server prose.</p>",
                        "lastModified": "2026-07-01T00:00:00Z"}, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert "WARNING" not in capsys.readouterr().err


def test_vault_only_sections_falls_back_on_bad_map(tmp_path):
    # Unreadable, malformed and non-dict maps all fall back to the default list.
    # The loader itself now lives in mobrpg.vault (both push paths need it); sync
    # keeps its own coverage that it is the list sync actually acts on.
    assert vault_only_sections(str(tmp_path)) == section.DEFAULT_VAULT_ONLY
    meta = tmp_path / "_meta"
    meta.mkdir()
    (meta / "mobrpg-map.json").write_text("{ not json", encoding="utf-8")
    assert vault_only_sections(str(tmp_path)) == section.DEFAULT_VAULT_ONLY
    (meta / "mobrpg-map.json").write_text("[1, 2]", encoding="utf-8")
    assert vault_only_sections(str(tmp_path)) == section.DEFAULT_VAULT_ONLY
    (meta / "mobrpg-map.json").write_text(
        json.dumps({"vaultOnlySections": []}), encoding="utf-8")
    assert vault_only_sections(str(tmp_path)) == section.DEFAULT_VAULT_ONLY


def test_pull_row_prints_canon_line_delta(tmp_path, monkeypatch, capsys):
    # #146 guardrail: a pull replaces the canon region wholesale, so the operator
    # sees what it costs — including a canon H2 that sat after a vault-only
    # section — in the dry-run table, before --execute.
    text = NOTE.replace(
        "Old vault prose.",
        "Old vault prose.\n\nMore prose.\n\n## Timeline\n\n- day one\n- day two")
    v = _vault(tmp_path, text=text, mtime=1_700_000_000)
    detail = {"description": "<p>Short.</p>", "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v)])                # dry-run
    out = capsys.readouterr().out
    assert "pull" in out
    assert "canon -" in out and "/+1 lines" in out
    assert "SHRINKS" in out                                # visibly a losing trade


def test_pull_keeps_empty_vault_only_heading(tmp_path, monkeypatch):
    # drop_empty_sections is a PUSH-candidate filter only: the vault's own empty
    # scaffold heading is a writing prompt and must survive a pull untouched.
    text = NOTE.replace("Old vault prose.", "Old vault prose.\n\n## Appearances\n")
    v = _vault(tmp_path, text=text, mtime=1_700_000_000)
    detail = {"description": "<p>New canon prose.</p>",
              "lastModified": "2026-07-24T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "## Appearances" in txt and "New canon prose." in txt


def test_baseline_keeps_empty_headings_in_vault_body(tmp_path, monkeypatch):
    # The baseline stamp writes the body back verbatim — empty scaffold headings
    # included — even though they are stripped from the push candidate.
    text = NOTE.replace('last_synced: "2026-07-20T00:00:00Z"', 'last_synced: ""')
    text = text.replace("Old vault prose.", "Old vault prose.\n\n## Properties\n")
    v = _vault(tmp_path, text=text)
    detail = {"description": "<p>Different server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "## Properties" in txt and "Old vault prose." in txt


def test_never_synced_divergent_note_baselines_not_pushes(tmp_path, monkeypatch):
    text = NOTE.replace('last_synced: "2026-07-20T00:00:00Z"', 'last_synced: ""')
    v = _vault(tmp_path, text=text)
    detail = {"description": "<p>Different server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert not submitted                             # no storm
    nd = _node.read_node((v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8"))
    assert nd["last_synced"]                         # stamped
    assert nd.get("review_state") != "pending"       # not queued for adjudication
    assert not nd.get("pending_ref")                 # no suggestion to wait on
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "Old vault prose." in txt                 # body untouched


def test_never_synced_matching_note_is_in_sync(tmp_path, monkeypatch):
    # Never synced but content already agrees: stamp, no suggestion, no pending_ref.
    text = NOTE.replace('last_synced: "2026-07-20T00:00:00Z"', 'last_synced: ""')
    v = _vault(tmp_path, text=text)
    detail = {"description": "<p>Old vault prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert not submitted
    nd = _node.read_node((v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8"))
    assert nd["last_synced"]
    assert not nd.get("pending_ref")


def test_never_synced_empty_stub_pulls_server_prose(tmp_path, monkeypatch):
    text = NOTE.replace('last_synced: "2026-07-20T00:00:00Z"', 'last_synced: ""')
    text = text.replace("Old vault prose.\n\n## GM Notes\n\nSecret plans.\n", "")
    v = _vault(tmp_path, text=text)
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    txt = (v / "Creatures" / "marsh-hag.md").read_text(encoding="utf-8")
    assert "Server prose." in txt                    # scaffold stub filled


def test_baseline_stamp_is_idempotent(tmp_path, monkeypatch):
    # The baseline stamp pins the mtime, so the next run decides skip rather than
    # re-reading as a dirty vault and pushing.
    text = NOTE.replace('last_synced: "2026-07-20T00:00:00Z"', 'last_synced: ""')
    v = _vault(tmp_path, text=text)
    p = v / "Creatures" / "marsh-hag.md"
    detail = {"description": "<p>Different server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    mtime1 = os.path.getmtime(p)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert not submitted                             # still no suggestion
    assert os.path.getmtime(p) == mtime1             # no second write


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


# ---------------------------------------------------------------------------
# #190 — an accepted push must not read back as a degrading pull. A `pull`
# verdict fires the instant the GM accepts THIS note's own earlier push (the
# element's lastModified jumps to accept time, zero new content); comparing
# first — same as the push/tie branch — is what tells that apart from a real
# upstream edit, and the compare has to be insensitive to how a wikilink got
# rendered on push (alias, PC/non-element plain text, bold split around a
# link, an empty template heading) or it never recognises the match.
# ---------------------------------------------------------------------------

_190_BODY = (
    "The [[Electromagnetic Diffuser|EM diffusers]] hum near the "
    "[[Royale Hotel|Room 2002]].\n\n"
    "[[Marlo Petrak|technician]] fixed it.\n\n"
    "[[Six]] and [[Shackleton Magellan]] were there, along with "
    "[[Section 102]] and [[Mysterious Relay]].\n\n"
    "**He is one of [[Daniela Akkermans]]'s people.**\n\n"
    "## Motivations & Secrets\n"
)


def _linked_stub(vault, folder, name, eid):
    nd = {"element_id": eid}
    p = vault / folder / f"{name}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("---\n" + _node.emit_node(nd) + f"---\n# {name}\n", encoding="utf-8")


def _190_vault(vault, *, last_synced="2026-07-20T00:00:00Z", body=_190_BODY):
    """A note using every link-degradation class from #190, plus the linked
    target notes its wikilinks resolve against (so the push rewrite actually
    produces element links, not just flattened text)."""
    nd = {"world_id": "w1", "external_ref": "ns:Creatures/marsh-hag",
          "element_id": "e-77", "element_kind": "Creature",
          "review_state": "accepted", "last_synced": last_synced}
    text = ("---\n" + _node.emit_node(nd) + "---\n\n" + body +
            "\n## GM Notes\n\nSecret plans.\n")
    p = vault / "Creatures" / "marsh-hag.md"
    p.parent.mkdir(parents=True)
    p.write_text(text, encoding="utf-8")
    ls = lww.parse_ts(last_synced)
    os.utime(p, (ls, ls))
    _linked_stub(vault, "Items & Artifacts", "Electromagnetic Diffuser", "e-diffuser")
    _linked_stub(vault, "Locations", "Royale Hotel", "e-hotel")
    _linked_stub(vault, "Characters/NPCs", "Marlo Petrak", "e-marlo")
    _linked_stub(vault, "Characters/NPCs", "Daniela Akkermans", "e-daniela")
    return p


def test_accepted_push_reads_in_sync_not_a_degrading_pull(tmp_path, monkeypatch, capsys):
    v = tmp_path / "vault"
    p = _190_vault(v)
    os.utime(p, None)                          # vault-dirty relative to the pre-push baseline
    stale_detail = {"description": "<p>irrelevant — before last_synced</p>",
                    "lastModified": "2026-07-01T00:00:00Z"}
    submitted: list = []
    _wire(monkeypatch, stale_detail, submitted)
    rc = sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    assert rc == 0 and len(submitted) == 1
    # The exact markdown sync itself built and filed for review — this IS what
    # an acceptance stores upstream, covering every degradation class in one
    # push: aliased links, a PC link (plain text), links to vault entities with
    # no upstream element (plain text), bold split around a link, and the
    # empty `## Motivations & Secrets` heading (dropped before push).
    pushed_md = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "EM diffusers" in pushed_md
    assert "Six" in pushed_md and "[[Six]]" not in pushed_md

    # Simulate the GM accepting that suggestion in mobRPG WITHOUT anyone
    # running pull-canon: review_state back to accepted, last_synced back to
    # the pre-push baseline (nothing has stamped it to the accept time), the
    # note pinned not-vault-dirty, body untouched — and the server now holds
    # exactly the pushed markdown, with `lastModified` at accept time, well
    # past last_synced.
    nd = _node.read_node(p.read_text(encoding="utf-8"))
    nd["review_state"] = "accepted"
    nd["pending_ref"] = ""
    nd["last_synced"] = "2026-07-20T00:00:00Z"
    p.write_text(_node.write_node(p.read_text(encoding="utf-8"), nd), encoding="utf-8")
    ls = lww.parse_ts("2026-07-20T00:00:00Z")
    os.utime(p, (ls, ls))
    before = p.read_text(encoding="utf-8")

    accepted_detail = {"description": pushed_md, "descriptionType": "Markdown",
                       "lastModified": "2026-08-01T00:00:00Z"}
    submitted2: list = []
    _wire(monkeypatch, accepted_detail, submitted2)
    rc = sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    out = capsys.readouterr().out
    assert rc == 0
    assert not submitted2                      # no new suggestion — nothing to review
    assert "  pull " not in out and "in-sync" in out
    after = p.read_text(encoding="utf-8")
    # Untouched BODY — no lossy round-trip through _pull_body. (last_synced is
    # expected to move; only the body is asserted byte-identical.)
    assert body_of(after) == body_of(before)
    assert "EM diffusers" in after and "Room 2002" in after and "technician" in after
    assert "[[Six]]" in after and "[[Section 102]]" in after
    assert "**He is one of [[Daniela Akkermans]]'s people.**" in after
    nd_after = _node.read_node(after)
    assert nd_after["last_synced"] not in ("", "2026-07-20T00:00:00Z")   # re-stamped


# ---------------------------------------------------------------------------
# #193 — the pull branch's compare must be STRICT, not the push/tie branch's
# deliberately loose one. A false 'differs' in push/tie just files an extra
# suggestion; a false 'matches' in pull silently discards a real owner edit
# forever. Each of these simulates one such edit landing on the server side
# of an otherwise-already-accepted push and asserts it is NOT swallowed as
# 'in-sync'.
# ---------------------------------------------------------------------------

def _accept_pushed_note(v, monkeypatch, *, last_synced="2026-07-20T00:00:00Z"):
    """Push the note once (capturing the exact markdown sync files), then
    simulate the GM accepting it in mobRPG without anyone running
    pull-canon: review_state back to accepted, last_synced back to the
    pre-push baseline, the note pinned not-vault-dirty. Returns (path,
    pushed_md) so the caller can build a server `detail` that's the pushed
    markdown plus exactly one perturbation."""
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)                          # vault-dirty relative to the pre-push baseline
    stale_detail = {"description": "<p>irrelevant</p>", "lastModified": "2026-07-01T00:00:00Z"}
    submitted: list = []
    _wire(monkeypatch, stale_detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    pushed_md = submitted[0]["suggestions"][0]["payload"]["description"]

    nd = _node.read_node(p.read_text(encoding="utf-8"))
    nd["review_state"] = "accepted"
    nd["pending_ref"] = ""
    nd["last_synced"] = last_synced
    p.write_text(_node.write_node(p.read_text(encoding="utf-8"), nd), encoding="utf-8")
    ls = lww.parse_ts(last_synced)
    os.utime(p, (ls, ls))
    return p, pushed_md


def _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited_md, capsys):
    """Run sync against a server description of exactly `edited_md`
    (Markdown) and assert the edit was NOT silently read as in-sync: either
    it pulls (the body changes) or, at minimum, no suggestion is filed
    claiming false agreement while last_synced quietly advances over lost
    content."""
    detail = {"description": edited_md, "descriptionType": "Markdown",
              "lastModified": "2026-08-01T00:00:00Z"}
    submitted: list = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    out = capsys.readouterr().out
    after = p.read_text(encoding="utf-8")
    assert "in-sync" not in out, "owner edit was silently swallowed as in-sync"
    assert body_of(after) != body_of(before), "owner edit did not reach the vault"


def test_owner_link_display_text_change_is_not_swallowed(tmp_path, monkeypatch, capsys):
    # "the traitor" -> "the hero" on the SAME element (E1) — same target,
    # different caption. The loose compare (id-keyed link markers) can't see
    # this at all; it must not read in-sync.
    v = tmp_path / "vault"
    _190_vault(v)
    p, pushed_md = _accept_pushed_note(v, monkeypatch)
    before = p.read_text(encoding="utf-8")
    assert "EM diffusers" in pushed_md
    edited = pushed_md.replace(
        "[EM diffusers](https://www.mobrpg.com/world/w1/link/e-diffuser)",
        "[the hero](https://www.mobrpg.com/world/w1/link/e-diffuser)")
    assert edited != pushed_md                            # sanity: a real edit
    _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited, capsys)


def test_owner_case_fix_is_not_swallowed(tmp_path, monkeypatch, capsys):
    # A pure case correction — the loose compare lowercases both sides.
    v = tmp_path / "vault"
    _190_vault(v)
    p, pushed_md = _accept_pushed_note(v, monkeypatch)
    before = p.read_text(encoding="utf-8")
    assert "Six and Shackleton Magellan" in pushed_md
    edited = pushed_md.replace(
        "Six and Shackleton Magellan", "six and shackleton magellan")
    assert edited != pushed_md
    _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited, capsys)


def test_owner_added_heading_is_not_swallowed(tmp_path, monkeypatch, capsys):
    # A genuinely NEW heading with real content — the loose compare drops
    # every heading's text entirely (not just the vault's own leading
    # "## Overview"), so a new section is invisible to it.
    v = tmp_path / "vault"
    _190_vault(v)
    p, pushed_md = _accept_pushed_note(v, monkeypatch)
    before = p.read_text(encoding="utf-8")
    edited = pushed_md + "\n\n## Secretly a cultist\n\nHe answers to the Choir."
    _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited, capsys)


def test_owner_heading_rename_is_not_swallowed(tmp_path, monkeypatch, capsys):
    # Same body text, renamed heading — "Allies" -> "Enemies" flips the
    # meaning entirely, but the loose compare drops heading text, so a
    # rename with identical body prose would read unchanged.
    v = tmp_path / "vault"
    body = ("The [[Electromagnetic Diffuser|EM diffusers]] hum quietly.\n\n"
            "## Allies\n\nThe Concord backs them.\n")
    _190_vault(v, body=body)
    p, pushed_md = _accept_pushed_note(v, monkeypatch)
    before = p.read_text(encoding="utf-8")
    assert "## Allies" in pushed_md
    edited = pushed_md.replace("## Allies", "## Enemies")
    assert edited != pushed_md
    _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited, capsys)


def test_owner_removed_bold_is_not_swallowed(tmp_path, monkeypatch, capsys):
    # Bold stripped from a single word — a pure tag-strip compare (unlike
    # one that reduces to markdown-ish text) can't see this: the visible
    # WORD "not" is identical either way, only its emphasis changed.
    v = tmp_path / "vault"
    body = "This is **not** a trap. Six agrees.\n"
    _190_vault(v, body=body)
    p, pushed_md = _accept_pushed_note(v, monkeypatch)
    before = p.read_text(encoding="utf-8")
    assert "**not**" in pushed_md
    edited = pushed_md.replace("**not**", "not")
    assert edited != pushed_md
    _assert_not_swallowed_in_sync(v, monkeypatch, p, before, edited, capsys)


def test_pull_still_overwrites_when_upstream_has_a_genuinely_new_sentence(
        tmp_path, monkeypatch):
    v = tmp_path / "vault"
    p = _190_vault(v)
    os.utime(p, None)
    stale_detail = {"description": "<p>irrelevant</p>", "lastModified": "2026-07-01T00:00:00Z"}
    submitted: list = []
    _wire(monkeypatch, stale_detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    pushed_md = submitted[0]["suggestions"][0]["payload"]["description"]

    nd = _node.read_node(p.read_text(encoding="utf-8"))
    nd["review_state"] = "accepted"
    nd["pending_ref"] = ""
    nd["last_synced"] = "2026-07-20T00:00:00Z"
    p.write_text(_node.write_node(p.read_text(encoding="utf-8"), nd), encoding="utf-8")
    ls = lww.parse_ts("2026-07-20T00:00:00Z")
    os.utime(p, (ls, ls))

    edited_md = pushed_md + "\n\nThe Keeper added a hidden panel behind the console."
    detail = {"description": edited_md, "descriptionType": "Markdown",
              "lastModified": "2026-08-01T00:00:00Z"}
    submitted2: list = []
    _wire(monkeypatch, detail, submitted2)
    sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    after = p.read_text(encoding="utf-8")
    assert "hidden panel" in after              # a real edit still pulls


def test_accepted_push_reads_in_sync_against_html_stored_server_anchors(
        tmp_path, monkeypatch):
    """The server side isn't guaranteed to store `descriptionType: Markdown`
    (legacy Html-typed elements, or a description created directly in
    mobRPG's own editor) — and isn't guaranteed to put `href` first the way
    our own `md_to_html` does. An HTML description whose anchors carry
    `rel`/`target` before `href` must still read in-sync against the
    candidate's aliased markdown."""
    v = tmp_path / "vault"
    p = _190_vault(v)
    ls = lww.parse_ts("2026-07-20T00:00:00Z")
    os.utime(p, (ls, ls))
    html = (
        '<p>The <a rel="noopener" target="_blank" '
        'href="https://www.mobrpg.com/world/w1/link/e-diffuser">EM diffusers</a> '
        'hum near the <a href="https://www.mobrpg.com/world/w1/link/e-hotel">'
        'Room 2002</a>.</p>'
        '<p><a href="https://www.mobrpg.com/world/w1/link/e-marlo">technician</a>'
        ' fixed it.</p>'
        '<p>Six and Shackleton Magellan were there, along with Section 102 and '
        'Mysterious Relay.</p>'
        '<p><strong>He is one of <a '
        'href="https://www.mobrpg.com/world/w1/link/e-daniela">Daniela '
        "Akkermans</a>'s people.</strong></p>"
    )
    detail = {"description": html, "descriptionType": "Html",
              "lastModified": "2026-08-01T00:00:00Z"}
    submitted: list = []
    _wire(monkeypatch, detail, submitted)
    before = p.read_text(encoding="utf-8")
    sync_cmd.run(["w1", "--vault", str(v), "--only", "marsh-hag", "--execute"])
    assert not submitted
    after = p.read_text(encoding="utf-8")
    assert body_of(after) == body_of(before)


def test_failed_submit_leaves_the_note_unmarked(tmp_path, monkeypatch):
    # The note used to be written `pending` with a `pending_ref` BEFORE the
    # submit. If the submit then failed, no upd/ row existed upstream while the
    # note claimed one — and nothing could clear it: plan holds it every run and
    # pull-canon only adjudicates a row matching pending_ref.
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    before = p.read_text(encoding="utf-8")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda m, path, **k: {"description": "<p>Server prose.</p>",
                                              "lastModified": "2026-07-01T00:00:00Z"}
                        if m == "GET" else {})

    def boom(world, req, execute, index=None):
        raise client.ApiError(500, "boom", "/suggestion")

    monkeypatch.setattr(submit_batch, "submit", boom)
    rc = sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert rc == 1
    assert p.read_text(encoding="utf-8") == before      # not marked pending


def test_claimed_ref_does_not_mark_the_note_pending(tmp_path, monkeypatch):
    # A row bounced as "already claimed (NOT submitted)" never reaches the review
    # queue, so the note must not claim it either.
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    before = p.read_text(encoding="utf-8")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda m, path, **k: {"description": "<p>Server prose.</p>",
                                              "lastModified": "2026-07-01T00:00:00Z"}
                        if m == "GET" else {})

    captured = {}

    def fake_submit(world, req, execute, index=None):
        ref = req["suggestions"][0]["externalRef"]
        captured["ref"] = ref
        return {"suggestions": [{"id": "s1", "externalRef": ref,
                                 "reviewState": "Accepted"}]}

    monkeypatch.setattr(submit_batch, "submit", fake_submit)
    rc = sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    assert rc == 0
    assert captured["ref"]
    assert p.read_text(encoding="utf-8") == before      # not marked pending


def test_stored_ref_still_marks_the_note_pending(tmp_path, monkeypatch):
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda m, path, **k: {"description": "<p>Server prose.</p>",
                                              "lastModified": "2026-07-01T00:00:00Z"}
                        if m == "GET" else {})

    def fake_submit(world, req, execute, index=None):
        ref = req["suggestions"][0]["externalRef"]
        return {"suggestions": [{"id": "s1", "externalRef": ref,
                                 "reviewState": "Pending"}]}

    monkeypatch.setattr(submit_batch, "submit", fake_submit)
    assert sync_cmd.run(["w1", "--vault", str(v), "--execute"]) == 0
    nd = _node.read_node(p.read_text(encoding="utf-8"))
    assert nd["review_state"] == "pending"


def test_show_body_prints_the_push_payload(tmp_path, monkeypatch, capsys):
    # (#184) nothing in the dry-run showed the description body being pushed
    # into someone else's review queue; --show-body prints exactly what would
    # be sent, vault-only tail already stripped.
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)  # vault freshly edited -> push decision
    detail = {"description": "<p>Stale server text.</p>",
              "lastModified": "2026-07-21T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    rc = sync_cmd.run(["w1", "--vault", str(v), "--show-body"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Old vault prose." in out
    assert "Secret plans." not in out       # GM Notes never shown as push body


def test_without_show_body_the_payload_stays_out_of_the_table(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    p = v / "Creatures" / "marsh-hag.md"
    os.utime(p, None)
    detail = {"description": "<p>Stale server text.</p>",
              "lastModified": "2026-07-21T00:00:00Z"}
    _wire(monkeypatch, detail, [])
    sync_cmd.run(["w1", "--vault", str(v)])
    assert "Old vault prose." not in capsys.readouterr().out


def test_push_never_carries_a_gm_alias(tmp_path, monkeypatch):
    # #212: a GM alias in the body is pushed as its owner's name, not the secret.
    v = _vault(tmp_path, text=NOTE.replace("Old vault prose.", "Old vault prose about [[Elias Crowe]]."))
    npc = v / "Characters" / "NPCs" / "Lord_Vane.md"
    npc.parent.mkdir(parents=True)
    npc.write_text('---\ntype: npc\ngm_aliases: ["Elias Crowe"]\n---\nA patron.\n', encoding="utf-8")
    os.utime(v / "Creatures" / "marsh-hag.md", None)
    detail = {"description": "<p>Server prose.</p>",
              "lastModified": "2026-07-01T00:00:00Z"}
    submitted = []
    _wire(monkeypatch, detail, submitted)
    sync_cmd.run(["w1", "--vault", str(v), "--execute"])
    desc = submitted[0]["suggestions"][0]["payload"]["description"]
    assert "Crowe" not in desc
    assert "Lord Vane" in desc


def test_pull_does_not_duplicate_a_campaign_log_the_server_still_holds():
    from mobrpg.commands.sync_cmd import _pull_body
    old = "Canon.\n\n## Campaign Log\n\n- S1 met\n- S2 fought\n\n## GM Notes\n\nsecret\n"
    server = "Canon edited.\n\n## Campaign Log\n\n- S1 met\n\n## Traits\n\nTall.\n"
    out = _pull_body(old, server, "Markdown", {})
    assert out.count("## Campaign Log") == 1
    assert "- S2 fought" in out and "## Traits" in out and "Canon edited." in out
