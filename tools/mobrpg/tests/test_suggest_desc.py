import difflib

from mobrpg import client
from mobrpg.commands import pull_desc, suggest_desc

BODY = (
    "\n## Overview\n\nFederal Credits are the hard currency of the Combine, "
    "minted on Thideia and accepted across every port.\n\n"
    "## GM Notes\n\nSecretly debased since the blockade.\n"
)
CAND_HTML = suggest_desc.vault_html(BODY)


def _node(**over):
    nd = {
        "world_id": "w1", "external_ref": "space:_World/federal_credits",
        "element_id": "cur-9282", "element_kind": "Currency",
    }
    nd.update(over)
    return nd


# ---- emptiness ----

def test_is_empty_html_variants():
    for h in ("", "   ", "<p></p>", "<p/>", "<br>", "<br/>", "<p><br></p>"):
        assert suggest_desc._is_empty_html(h) is True
    assert suggest_desc._is_empty_html("<p>real prose</p>") is False


# ---- vault_html ----

def test_vault_html_extracts_canon_section_and_converts():
    html = suggest_desc.vault_html(BODY)
    assert "Federal Credits are the hard currency" in html
    assert html.startswith("<h2>Overview</h2>")
    # the GM-only tail is never suggested up
    assert "debased" not in html


def test_vault_html_empty_body_is_empty():
    assert suggest_desc.vault_html("\n## GM Notes\n\nonly gm tail\n") == ""


# ---- similarity (autojunk=False) ----

def test_similarity_identical_is_one():
    assert suggest_desc.similarity("<p>same</p>", "<p>same</p>") == 1.0


def test_similarity_uses_autojunk_false_on_long_prose():
    # A long, highly repetitive description is exactly what SequenceMatcher's
    # autojunk heuristic mishandles: the popular characters get dropped and the
    # ratio collapses toward zero on near-identical strings.
    a = "<p>" + "the archivist catalogued the relic and sealed it away. " * 30 + "</p>"
    b = a.replace("relic", "artifact", 1)
    junk_on = difflib.SequenceMatcher(None, a, b).ratio()
    ours = suggest_desc.similarity(a, b)
    assert ours >= 0.98            # near-identical prose reads as near-identical
    assert ours >= junk_on         # never worse than the buggy default


# ---- classify_candidate ----

def test_classify_empty_live_is_candidate():
    is_cand, reason = suggest_desc.classify_candidate(CAND_HTML, "")
    assert is_cand is True and reason == "empty"


def test_classify_stub_markup_live_is_candidate():
    is_cand, reason = suggest_desc.classify_candidate(CAND_HTML, "<p></p>")
    assert is_cand is True and reason == "empty"


def test_classify_no_authored_prose_is_skipped():
    is_cand, reason = suggest_desc.classify_candidate("", "<p>anything</p>")
    assert is_cand is False and reason == "no-prose"


def test_classify_identical_is_in_sync():
    is_cand, reason = suggest_desc.classify_candidate(CAND_HTML, CAND_HTML)
    assert is_cand is False and reason == "in-sync"


def test_classify_richer_prose_is_candidate():
    is_cand, reason = suggest_desc.classify_candidate(CAND_HTML, "<p>Federal Credits.</p>")
    assert is_cand is True and reason == "differs"


def test_classify_threshold_is_tunable():
    # a small edit is a candidate under a strict threshold, in-sync under a loose one
    live = CAND_HTML.replace("hard currency", "soft currency")
    assert suggest_desc.classify_candidate(CAND_HTML, live, threshold=0.999)[0] is True
    assert suggest_desc.classify_candidate(CAND_HTML, live, threshold=0.5)[0] is False


# ---- normalization: heading + span/entity formatting noise ----

def test_normalize_strips_heading_tags_spans_and_entities():
    n = suggest_desc.normalize_for_compare
    assert n('<h2>Overview</h2><p>Same prose.</p>') == "same prose."
    assert n('<p><span style="color:red">Same prose.</span></p>') == "same prose."
    assert n("<p>A &amp; B</p>") == "a & b"
    # both sides collapse to the identical comparison key
    assert n('<h2>Overview</h2><p>Same prose.</p>') == n('<p><span style="">Same prose.</span></p>')


def test_classify_ignores_heading_and_span_formatting_noise():
    # the exact G5-followup case: vault "## Overview\n\nSame prose." vs mobRPG
    # headingless <span>-wrapped prose must classify in-sync, NOT differs.
    cand = suggest_desc.vault_html("\n## Overview\n\nSame prose.\n")
    live = '<p><span style="">Same prose.</span></p>'
    # raw HTML would be well under threshold (the noise); normalized they match
    assert suggest_desc.similarity(cand, live) < 0.98
    is_cand, reason = suggest_desc.classify_candidate(cand, live)
    assert is_cand is False and reason == "in-sync"


def test_classify_still_flags_real_content_delta_after_normalization():
    cand = suggest_desc.vault_html("\n## Overview\n\nFull authored prose about the thing.\n")
    live = '<p><span style="">Stub.</span></p>'
    is_cand, reason = suggest_desc.classify_candidate(cand, live)
    assert is_cand is True and reason == "differs"


# ---- build_suggestion / payload shape ----

def test_build_suggestion_is_update_element_targeting_real_id():
    item = suggest_desc.build_suggestion(_node(), CAND_HTML, ref="e0")
    assert item["operation"] == "UpdateElement"
    assert item["payload"]["operation"] == "UpdateElement"
    # targetRef MUST be the real element id, never a suggestion: ref (backend rejects it)
    assert item["payload"]["targetRef"] == "cur-9282"
    assert not item["payload"]["targetRef"].startswith("suggestion:")
    assert item["payload"]["description"] == CAND_HTML
    assert item["dependsOn"] == []
    # a distinct desc/ externalRef, so re-runs dedupe and it never collides with
    # the element's own create externalRef (space:_World/federal_credits)
    assert item["externalRef"] == "space:desc/_World/federal_credits"


def test_build_suggestion_payload_has_no_data_block():
    # UpdateElement is a sparse edit; the typed data block is deliberately absent
    item = suggest_desc.build_suggestion(_node(), CAND_HTML)
    assert "data" not in item["payload"]
    assert "name" not in item["payload"]


def test_desc_external_ref_without_namespace_is_none():
    assert suggest_desc.desc_external_ref({"external_ref": ""}) is None
    assert suggest_desc.desc_external_ref({}) is None


def test_build_request_labels_and_numbers_refs():
    cands = [(_node(element_id="a"), "<p>1</p>"),
             (_node(element_id="b"), "<p>2</p>")]
    req = suggest_desc.build_request(cands, "My label")
    assert req["batchLabel"] == "My label"
    assert [s["ref"] for s in req["suggestions"]] == ["e0", "e1"]
    assert [s["payload"]["targetRef"] for s in req["suggestions"]] == ["a", "b"]


# ---- _plan orchestration (I/O monkeypatched) ----

def _patch_notes(monkeypatch, notes, live_by_id):
    monkeypatch.setattr(pull_desc, "_iter_notes", lambda vault: list(notes))

    def fake_fetch(world, nd, token):
        v = live_by_id.get(nd.get("element_id"))
        if v is None:
            return None, "deleted"
        return v, "ok"

    monkeypatch.setattr(pull_desc, "_fetch_description", fake_fetch)


def test_plan_collects_only_candidates(monkeypatch):
    stub = ("/v/_World/Federal Credits.md",
            "---\n---" + BODY, _node(element_id="cur-empty"))
    synced = ("/v/_World/Rich.md",
              "---\n---" + BODY, _node(element_id="cur-rich",
                                       external_ref="space:_World/rich"))
    gone = ("/v/_World/Gone.md",
            "---\n---" + BODY, _node(element_id="cur-gone",
                                     external_ref="space:_World/gone"))
    live = {"cur-empty": "", "cur-rich": CAND_HTML}   # cur-gone missing -> deleted
    _patch_notes(monkeypatch, [stub, synced, gone], live)

    cands, rows = suggest_desc._plan("w1", "/v", "tok", only=None, threshold=0.98)
    reasons = {r[0]: r[1] for r in rows}
    assert reasons["space:_World/federal_credits"] == "empty"
    assert reasons["space:_World/rich"] == "in-sync"
    assert reasons["space:_World/gone"] == "deleted"
    ids = [nd["element_id"] for nd, _ in cands]
    assert ids == ["cur-empty"]


def test_plan_only_targets_one_note(monkeypatch):
    a = ("/v/_World/A.md", "---\n---" + BODY, _node(element_id="a",
                                                    external_ref="space:_World/a"))
    b = ("/v/_World/B.md", "---\n---" + BODY, _node(element_id="b",
                                                    external_ref="space:_World/b"))
    _patch_notes(monkeypatch, [a, b], {"a": "", "b": ""})
    cands, rows = suggest_desc._plan("w1", "/v", "tok", only="space:_World/b", threshold=0.98)
    assert [nd["element_id"] for nd, _ in cands] == ["b"]
    assert len(rows) == 1


def test_plan_unknown_only_raises(monkeypatch):
    a = ("/v/_World/A.md", "---\n---" + BODY, _node(element_id="a",
                                                    external_ref="space:_World/a"))
    _patch_notes(monkeypatch, [a], {"a": ""})
    try:
        suggest_desc._plan("w1", "/v", "tok", only="nope", threshold=0.98)
        assert False, "expected LookupError"
    except LookupError:
        pass


# ---- run() end-to-end (dry-run default: no POST) ----

def test_run_dry_run_lists_candidates_and_never_posts(monkeypatch, capsys):
    a = ("/v/_World/A.md", "---\n---" + BODY, _node(element_id="a",
                                                    external_ref="space:_World/a"))
    _patch_notes(monkeypatch, [a], {"a": ""})
    monkeypatch.setattr(suggest_desc.client, "get_access_token", lambda: "tok")

    def boom(*x, **k):
        raise AssertionError("no API write in dry-run")

    monkeypatch.setattr(client, "_request", boom)

    rc = suggest_desc.run(["w1", "--vault", "/v"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "1 candidate" in out
    assert "DRY-RUN" in out


def test_run_no_candidates_returns_zero_without_submitting(monkeypatch, capsys):
    a = ("/v/_World/A.md", "---\n---" + BODY, _node(element_id="a",
                                                    external_ref="space:_World/a"))
    _patch_notes(monkeypatch, [a], {"a": CAND_HTML})   # in-sync
    monkeypatch.setattr(suggest_desc.client, "get_access_token", lambda: "tok")

    def boom(*x, **k):
        raise AssertionError("must not touch submit path with no candidates")

    monkeypatch.setattr(suggest_desc.submit_batch, "submit", boom)
    rc = suggest_desc.run(["w1", "--vault", "/v"])
    assert rc == 0
    assert "0 candidate" in capsys.readouterr().out


def test_run_execute_posts_update_element(monkeypatch, capsys):
    a = ("/v/_World/A.md", "---\n---" + BODY, _node(element_id="a",
                                                    external_ref="space:_World/a"))
    _patch_notes(monkeypatch, [a], {"a": ""})
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["path"], calls["body"] = path, body
        return {"suggestions": [{"id": "s1", "operation": "UpdateElement",
                                 "reviewState": "Pending", "payload": {}}],
                "resolvedRefs": {}}

    monkeypatch.setattr(suggest_desc.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)

    rc = suggest_desc.run(["w1", "--vault", "/v", "--execute"])
    assert rc == 0
    assert calls["path"].endswith("/world/w1/suggestion")
    body = calls["body"]["suggestions"][0]
    assert body["operation"] == "UpdateElement"
    assert body["payload"]["targetRef"] == "a"
