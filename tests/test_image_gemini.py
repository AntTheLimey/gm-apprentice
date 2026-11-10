"""image_gemini.py (the request half) and scripts/image_live_check.py."""

import base64
import http.client
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "scripts"))

import image_gemini  # noqa: E402
import image_keys  # noqa: E402
import image_live_check  # noqa: E402

FAKE_KEY = "AIza-FAKE-KEY-for-tests-0000"


def test_request_body_matches_googles_shape():
    body = json.loads(image_gemini.request(
        "m", "A dock.", [("image/png", b"\x89PNG")], "16:9", "1K"))
    assert body["model"] == "m"
    assert body["input"][0] == {"type": "text", "text": "A dock."}
    assert body["input"][1] == {
        "type": "image", "mime_type": "image/png",
        "data": base64.b64encode(b"\x89PNG").decode()}
    assert body["response_format"] == {
        "type": "image", "mime_type": "image/jpeg",
        "aspect_ratio": "16:9", "image_size": "1K"}


def test_no_references_sends_text_only():
    body = json.loads(image_gemini.request("m", "A dock.", [], "1:1", "2K"))
    assert len(body["input"]) == 1


def test_size_must_be_upper_case_k():
    with pytest.raises(ValueError):
        image_gemini.request("m", "p", [], "1:1", "1k")


def test_constants():
    assert image_gemini.URL == "https://generativelanguage.googleapis.com/v1beta/interactions"
    assert image_gemini.API_REVISION == "2026-05-20"
    assert image_gemini.TIMEOUT == 180
    assert tuple(image_gemini.ACCEPTS) == (
        14, 4, ("1K", "2K", "4K"), ("image/png", "image/jpeg"))


def _patch_urlopen(monkeypatch, fn):
    monkeypatch.setattr(image_gemini.urllib.request, "urlopen", fn)


def test_send_returns_status_and_body(monkeypatch):
    seen = {}

    class Resp:
        status = 200

        def read(self):
            return b"ok"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake(req, timeout):
        seen["url"] = req.full_url
        seen["headers"] = {k.lower(): v for k, v in req.header_items()}
        seen["timeout"] = timeout
        return Resp()
    _patch_urlopen(monkeypatch, fake)
    out = image_gemini.SEND(image_gemini.URL, {"x-goog-api-key": FAKE_KEY}, b"{}", 5)
    assert out == (200, b"ok")
    assert FAKE_KEY not in seen["url"]
    assert seen["headers"]["x-goog-api-key"] == FAKE_KEY
    assert seen["timeout"] == 5


def test_send_returns_http_error_replies(monkeypatch):
    def fake(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, io.BytesIO(b'{"e":1}'))
    _patch_urlopen(monkeypatch, fake)
    assert image_gemini.SEND(image_gemini.URL, {}, b"{}", 5) == (400, b'{"e":1}')


def test_send_network_failure_is_service_error(monkeypatch):
    def fake(req, timeout):
        raise urllib.error.URLError("no route")
    _patch_urlopen(monkeypatch, fake)
    with pytest.raises(image_gemini.ServiceError) as e:
        image_gemini.SEND(image_gemini.URL, {"x-goog-api-key": FAKE_KEY}, b"{}", 5)
    assert e.value.kind == "network"
    assert FAKE_KEY not in str(e.value)


def test_send_timeout_is_service_error(monkeypatch):
    def fake(req, timeout):
        raise TimeoutError("slow")
    _patch_urlopen(monkeypatch, fake)
    with pytest.raises(image_gemini.ServiceError):
        image_gemini.SEND(image_gemini.URL, {}, b"{}", 5)


# -- the live-check script ---------------------------------------------------

PICTURE = b"\xff\xd8\xff" + bytes(range(256)) * 3
PICTURE_B64 = base64.b64encode(PICTURE).decode()


def _stub_send(calls):
    def send(url, headers, body, timeout):
        calls.append((url, headers, body))
        reply = {"outputs": [{"type": "image", "data": PICTURE_B64}],
                 "usage": {"total_tokens": 1234}}
        return 200, json.dumps(reply).encode()
    return send


@pytest.fixture
def live(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(image_gemini, "SEND", _stub_send(calls))
    monkeypatch.setattr(image_keys, "find", lambda s: (FAKE_KEY, "environment"))
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx" / "image")
    return calls


def test_refuses_under_pytest():
    with pytest.raises(SystemExit):
        image_live_check.main(["--model", "m"])


def test_live_check_cuts_pictures_and_hides_key(live, tmp_path, capsys):
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"\x89PNGdata")
    out = tmp_path / "pic.jpg"
    code = image_live_check.main(
        ["--model", "m", "--reference", str(ref), "--save", str(out),
         "--refusal-prompt", "decline me"], allow_under_test=True)
    assert code == 0
    assert len(live) == 3
    assert all(FAKE_KEY not in u for u, _, _ in live)
    assert live[0][1]["x-goog-api-key"] == FAKE_KEY
    fixtures = sorted((tmp_path / "fx" / "image").glob("gemini-*.json"))
    assert len(fixtures) == 3
    for f in fixtures:
        text = f.read_text(encoding="utf-8")
        assert f"{PICTURE_B64[:64]}...<cut {len(PICTURE_B64)} chars>" in text
        assert PICTURE_B64 not in text
        assert FAKE_KEY not in text
        assert json.loads(text)["status"] == 200
    printed = capsys.readouterr()
    assert FAKE_KEY not in printed.out + printed.err
    assert "1234" in printed.out
    assert out.read_bytes() == PICTURE


def test_live_check_without_key_exits_plainly(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(image_keys, "find", lambda s: None)
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx")
    assert image_live_check.main(["--model", "m"], allow_under_test=True) != 0
    assert "key" in capsys.readouterr().err.lower()


def test_live_check_saves_unexpected_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(image_gemini, "SEND", lambda *a: (400, b'{"error": "no"}'))
    monkeypatch.setattr(image_keys, "find", lambda s: (FAKE_KEY, "environment"))
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx")
    image_live_check.main(["--model", "m"], allow_under_test=True)
    saved = json.loads((tmp_path / "fx" / "gemini-prompt-only.json").read_text())
    assert saved["status"] == 400 and saved["reply"] == {"error": "no"}


def test_send_incomplete_read_is_service_error(monkeypatch):
    def fake(req, timeout):
        raise http.client.IncompleteRead(b"x")
    _patch_urlopen(monkeypatch, fake)
    with pytest.raises(image_gemini.ServiceError) as e:
        image_gemini.SEND(image_gemini.URL, {"x-goog-api-key": FAKE_KEY}, b"{}", 5)
    assert e.value.kind == "network" and FAKE_KEY not in str(e.value)


def test_missing_save_folder_exits_before_any_call(live, tmp_path):
    code = image_live_check.main(
        ["--model", "m", "--save", str(tmp_path / "nope" / "p.jpg")],
        allow_under_test=True)
    assert code != 0 and live == []


def test_decode_failure_keeps_fixture_and_carries_on(monkeypatch, tmp_path):
    calls = []

    def send(url, headers, body, timeout):
        calls.append(1)
        return 200, json.dumps({"outputs": [{"type": "image", "data": "A" * 201}]}).encode()
    monkeypatch.setattr(image_gemini, "SEND", send)
    monkeypatch.setattr(image_keys, "find", lambda s: (FAKE_KEY, "environment"))
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx")
    code = image_live_check.main(
        ["--model", "m", "--save", str(tmp_path / "p.jpg"),
         "--refusal-prompt", "no"], allow_under_test=True)
    assert code == 0 and len(calls) == 2
    assert (tmp_path / "fx" / "gemini-prompt-only.json").exists()
    assert (tmp_path / "fx" / "gemini-refusal.json").exists()


def test_typed_image_node_preferred_over_heuristic():
    other = "B" * 300
    reply = {"signature": other, "steps": [{"content": [
        {"type": "image", "data": PICTURE_B64}]}]}
    assert image_live_check.pictures(reply) == [PICTURE_B64]
    assert image_live_check.image_nodes(reply)[0][0] == "steps[0].content[0]"
    assert "300 chars" in json.dumps(image_live_check.cut(reply))


def test_key_echoed_in_reply_is_redacted(monkeypatch, tmp_path):
    monkeypatch.setattr(image_gemini, "SEND",
                        lambda *a: (403, json.dumps({"error": f"bad {FAKE_KEY}"}).encode()))
    monkeypatch.setattr(image_keys, "find", lambda s: (FAKE_KEY, "environment"))
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx")
    image_live_check.main(["--model", "m"], allow_under_test=True)
    text = (tmp_path / "fx" / "gemini-prompt-only.json").read_text()
    assert FAKE_KEY not in text and "<key>" in text


def test_unaccepted_reference_type_refused_before_calls(live, tmp_path, capsys):
    ref = tmp_path / "r.gif"
    ref.write_bytes(b"GIF89a")
    code = image_live_check.main(["--model", "m", "--reference", str(ref)],
                                 allow_under_test=True)
    assert code != 0 and live == []
    assert "r.gif" in capsys.readouterr().err


MODEL = "gemini-nano-banana-2.1"


def test_estimate_for_the_known_model():
    assert image_gemini.estimate(MODEL, "1K", 0, 0) == pytest.approx(
        3.36 + image_gemini.OTHER_TOKENS * 7.50 / 10_000)
    assert image_gemini.estimate(MODEL, "1K", 0, 0, thinking=True) == pytest.approx(
        3.36 + (image_gemini.OTHER_TOKENS + image_gemini.THINK_TOKENS) * 7.50 / 10_000)
    assert image_gemini.estimate(MODEL, "2K", 0, 0) > 5


def test_estimate_unknown_model_is_none():
    assert image_gemini.estimate("anything-else", "1K", 0, 0) is None


def test_each_reference_adds_its_tokens():
    one = image_gemini.estimate(MODEL, "1K", 1, 0)
    none = image_gemini.estimate(MODEL, "1K", 0, 0)
    assert one - none == pytest.approx(image_gemini.REF_TOKENS * 1.50 / 10_000)


def test_prompt_length_adds_input_tokens():
    long = image_gemini.estimate(MODEL, "1K", 0, 3000)
    short = image_gemini.estimate(MODEL, "1K", 0, 0)
    assert long - short == pytest.approx(0.15)


def test_unknown_size_and_negative_counts_are_errors():
    with pytest.raises(ValueError):
        image_gemini.estimate(MODEL, "8K", 0, 0)
    with pytest.raises(ValueError):
        image_gemini.estimate(MODEL, "1K", -1, 0)
    with pytest.raises(ValueError):
        image_gemini.estimate(MODEL, "1K", 0, -1)
    with pytest.raises(ValueError):
        image_gemini.estimate(MODEL, "1K", 0, float("nan"))


def test_rates_entry_is_the_documented_one():
    assert list(image_gemini.RATES) == [MODEL]
    rate = image_gemini.RATES[MODEL]
    assert rate.input_per_m == 1.50
    assert rate.image_out_per_m == 30.00
    assert rate.text_out_per_m == 7.50
    assert rate.out_tokens == {"1K": 1120, "2K": 1680, "4K": 3780}
    assert rate.checked == "2026-11-09"
    assert rate.source == "https://aistudio.google.com/docs/pricing"


# -- reading real replies (fixtures captured from Google on 2026-11-09) -------

from image_replies import (  # noqa: E402
    FIXTURES, SECRET, TINY_JPEG, Sender, fixture)


@pytest.fixture
def fixture_send(monkeypatch):
    def use(*names):
        send = Sender(*[fixture(n) if isinstance(n, str) else n for n in names])
        monkeypatch.setattr(image_gemini, "SEND", send)
        return send
    return use


def draw(**kw):
    args = dict(model=MODEL, key=SECRET, prompt="A dock.", refs=[],
                shape="1:1", size="1K")
    args.update(kw)
    return image_gemini.draw(**args)


def test_draw_returns_the_picture_and_usage(fixture_send):
    fixture_send("gemini-prompt-only.json")
    pic = draw()
    assert pic.data == TINY_JPEG and pic.data.startswith(b"\xff\xd8\xff")
    assert pic.ext == "jpg"
    assert pic.usage == {"input": 17, "image": 1120, "other": 287, "thought": 715}


def test_usage_with_a_reference(fixture_send):
    fixture_send("gemini-with-references.json")
    pic = draw(refs=[("image/png", b"\x89PNG")])
    assert pic.usage == {"input": 1136, "image": 1120, "other": 421, "thought": 1088}


def test_thinking_off_asks_for_minimal_and_on_sends_no_config(fixture_send):
    send = fixture_send("gemini-prompt-only.json")
    draw()
    assert send.calls[0]["generation_config"] == {"thinking_level": "minimal"}
    draw(thinking=True)
    assert "generation_config" not in send.calls[1]
    body = json.loads(image_gemini.request("m", "p", [], "1:1", "1K", thinking=True))
    assert "generation_config" not in body


def test_an_unsupported_thinking_level_asks_the_caller_after_one_call(fixture_send):
    send = fixture_send("gemini-error-thinking-level.json")
    with pytest.raises(image_gemini.NeedsThinking):
        draw()
    assert len(send.calls) == 1


def test_the_same_400_with_thinking_on_is_a_plain_error(fixture_send):
    send = fixture_send("gemini-error-thinking-level.json")
    with pytest.raises(image_gemini.ServiceError) as e:
        draw(thinking=True)
    assert e.value.kind == "reply" and "Thinking level" in e.value.message
    assert e.value.billed is False and e.value.usage is None
    assert len(send.calls) == 1


def test_a_reply_with_no_picture_is_refused(fixture_send):
    # DERIVED, not captured: a real 200 reply with its image item removed.
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    reply["steps"][1]["content"] = []
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.Refused) as e:
        draw()
    assert e.value.reason == "the service returned no picture"
    assert e.value.usage == {"input": 17, "image": 1120, "other": 287, "thought": 715}
    reply["steps"][1]["content"] = [{"type": "text", "text": "I can't help with that"}]
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.Refused) as e:
        draw()
    assert e.value.reason == "I can't help with that"
    reply["steps"][1]["content"] = []
    reply["status"] = "incomplete"
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.Refused) as e:
        draw()
    assert e.value.reason == "incomplete"


ODD_REPLIES = [
    (401, b"{}", "auth"), (403, b"{}", "auth"), (402, b"{}", "quota"),
    (429, b"{}", "quota"), (500, b"oops", "reply"), (200, b"{}", "reply"),
    (200, b"not json", "reply"),
    (400, json.dumps({"error": {"message": f"bad {SECRET}"}}).encode(), "reply"),
    (500, f"echo {SECRET}".encode(), "reply"),
    (200, json.dumps({"steps": [{"type": "model_output", "content": [
        {"type": "image", "data": "!!!"}]}]}).encode(), "reply"),
]


def test_auth_credit_quota_and_odd_replies(fixture_send):
    seen = {}
    for status, body, kind in ODD_REPLIES:
        fixture_send((status, body))
        with pytest.raises(image_gemini.ServiceError) as e:
            draw()
        assert e.value.kind == kind, (status, body)
        seen[status] = e.value.message
    assert seen[401] == "The picture service did not accept the key."
    assert seen[402] == "The picture service says the account is out of credit."
    assert seen[429] == ("The picture service says the account's limit has been "
                         "reached; try again later.")


def test_a_400_carries_the_services_own_message(fixture_send):
    fixture_send((400, json.dumps({"error": {"message": "Bad aspect ratio"}}).encode()))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw(thinking=True)
    assert e.value.kind == "reply" and "Bad aspect ratio" in e.value.message


def test_no_error_message_holds_the_key(fixture_send):
    for status, body, _ in ODD_REPLIES:
        fixture_send((status, body))
        with pytest.raises(image_gemini.ServiceError) as e:
            draw()
        assert SECRET not in str(e.value) and SECRET not in e.value.message
    fixture_send((200, json.dumps({"steps": [{"type": "model_output", "content": [
        {"type": "text", "text": f"no {SECRET}"}]}]}).encode()))
    with pytest.raises(image_gemini.Refused) as e2:
        draw()
    assert SECRET not in e2.value.reason


def test_bytes_that_are_not_a_picture_are_an_error(fixture_send):
    data = base64.b64encode(b"GIF89a-not-allowed").decode()
    fixture_send((200, json.dumps({"steps": [{"type": "model_output", "content": [
        {"type": "image", "mime_type": "image/gif", "data": data}]}]}).encode()))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw()
    assert e.value.kind == "reply"


# (name, thinking as sent, references sent, expected cents)
REAL_COSTS = [
    ("gemini-prompt-only.json", True, 0, 4.11),
    ("gemini-with-references.json", True, 1, 4.66),
    ("gemini-thinking-minimal.json", False, 0, 3.59),
    ("gemini-scene-reference-default-thinking.json", True, 1, 4.14),
    ("gemini-scene-reference-minimal-thinking.json", False, 1, 3.86),
    ("gemini-gore-prompt-drawn.json", True, 0, None),
    ("gemini-told-not-to-draw-drew-anyway.json", True, 0, None),
]


def _usage_of(name, fixture_send):
    fixture_send(name)
    return draw().usage


def test_cost_from_the_real_usage(fixture_send):
    for name, _, _, cents in REAL_COSTS:
        if cents is None:
            continue
        got = image_gemini.cost(MODEL, _usage_of(name, fixture_send))
        assert got == pytest.approx(cents, abs=0.01), name
    assert image_gemini.cost("other", {"input": 1, "image": 1, "other": 1,
                                       "thought": 1}) is None


def test_cost_refuses_bad_numbers():
    ok = {"input": 1, "image": 1, "other": 1, "thought": 1}
    for field in ok:
        for bad in (-1, float("nan"), float("inf")):
            with pytest.raises(ValueError):
                image_gemini.cost(MODEL, {**ok, field: bad})


def test_estimate_is_never_under_the_real_cost(fixture_send):
    for name, thinking, refs, _ in REAL_COSTS:
        real = image_gemini.cost(MODEL, _usage_of(name, fixture_send))
        est = image_gemini.estimate(MODEL, "1K", refs, 400, thinking=thinking)
        assert est >= real, (name, est, real)


def test_four_references_fit_under_five_cents_with_thinking_off():
    assert image_gemini.estimate(MODEL, "1K", 4, 2000, thinking=False) < 5


def test_four_references_pass_five_cents_with_thinking_on():
    assert image_gemini.estimate(MODEL, "1K", 4, 2000, thinking=True) > 5


def test_send_error_body_read_failure_is_a_network_error(monkeypatch):
    class Broken(io.BytesIO):
        def read(self, *a):
            raise http.client.IncompleteRead(b"x")

    def fake(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 500, "bad", {}, Broken())
    _patch_urlopen(monkeypatch, fake)
    with pytest.raises(image_gemini.ServiceError) as e:
        image_gemini.SEND(image_gemini.URL, {"x-goog-api-key": FAKE_KEY}, b"{}", 5)
    assert e.value.kind == "network" and FAKE_KEY not in str(e.value)
    monkeypatch.setattr(Broken, "read", lambda self, *a: (_ for _ in ()).throw(TimeoutError()))
    with pytest.raises(image_gemini.ServiceError) as e:
        image_gemini.SEND(image_gemini.URL, {}, b"{}", 5)
    assert e.value.kind == "network"


# -- fix round 1: every billed reply is countable --------------------------------


def test_a_200_with_an_undecodable_picture_is_billed_and_counted(fixture_send):
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    reply["steps"][1]["content"][0]["data"] = "!!!"
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw()
    assert e.value.billed is True
    assert e.value.usage == {"input": 17, "image": 1120, "other": 287, "thought": 715}


def test_a_200_that_is_not_a_picture_or_not_the_shape_is_billed(fixture_send):
    fixture_send((200, b"{}"))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw()
    assert e.value.billed is True and e.value.usage is None
    fixture_send((200, b"not json"))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw()
    assert e.value.billed is True and e.value.usage is None


def test_failures_that_were_not_billed(fixture_send):
    for status in (401, 402, 429, 500):
        fixture_send((status, b"{}"))
        with pytest.raises(image_gemini.ServiceError) as e:
            draw()
        assert e.value.billed is False and e.value.usage is None


def test_a_picture_reply_without_usable_usage_has_no_usage(fixture_send):
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    del reply["usage"]
    fixture_send((200, json.dumps(reply).encode()))
    assert draw().usage is None
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    del reply["usage"]["output_tokens_by_modality"]
    fixture_send((200, json.dumps(reply).encode()))
    assert draw().usage is None


def test_tool_use_tokens_count_as_other(fixture_send):
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    reply["usage"]["total_tool_use_tokens"] = 40
    fixture_send((200, json.dumps(reply).encode()))
    assert draw().usage["other"] == 327


def test_cost_refuses_missing_non_numbers_and_bools():
    ok = {"input": 1, "image": 1, "other": 1, "thought": 1}
    for field in ok:
        for bad in ("1", None, True):
            with pytest.raises(ValueError):
                image_gemini.cost(MODEL, {**ok, field: bad})
        missing = {k: v for k, v in ok.items() if k != field}
        with pytest.raises(ValueError):
            image_gemini.cost(MODEL, missing)


def test_the_services_own_message_is_cut_to_300(fixture_send):
    fixture_send((500, json.dumps({"error": {"message": "x" * 900}}).encode()))
    with pytest.raises(image_gemini.ServiceError) as e:
        draw()
    assert len(e.value.message) == 300


def test_a_cjk_prompt_estimates_higher_than_a_latin_one():
    latin = image_gemini.estimate(MODEL, "1K", 0, len("a" * 2000))
    cjk = image_gemini.estimate(MODEL, "1K", 0, len(("画" * 2000).encode("utf-8")))
    assert cjk > latin


# -- R13: a usage that would price a picture at nothing is not believed -----------


def test_a_picture_reported_with_too_few_image_tokens_has_no_usage(fixture_send):
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    for mode in reply["usage"]["output_tokens_by_modality"]:
        if mode["modality"] == "image":
            mode["tokens"] = 1119
    fixture_send((200, json.dumps(reply).encode()))
    assert draw().usage is None
    fixture_send("gemini-prompt-only.json")
    assert draw().usage is not None
    assert draw(size="2K").usage is None    # 1120 tokens is under a 2K picture's 1680


def test_a_model_without_rates_keeps_whatever_usage_it_reports(fixture_send):
    fixture_send("gemini-prompt-only.json")
    assert draw(model="other").usage == {
        "input": 17, "image": 1120, "other": 287, "thought": 715}


def test_a_billed_refusal_or_error_with_an_empty_usage_has_no_usage(fixture_send):
    _, raw = fixture("gemini-prompt-only.json")
    reply = json.loads(raw)
    reply["steps"][1]["content"] = []
    reply["usage"] = {"unknown_field": 5}
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.Refused) as e:
        draw()
    assert e.value.usage is None
    reply["steps"][1]["content"] = [{"type": "image", "data": "!!!"}]
    fixture_send((200, json.dumps(reply).encode()))
    with pytest.raises(image_gemini.ServiceError) as e2:
        draw()
    assert e2.value.billed is True and e2.value.usage is None


# -- a lost reply may have been charged ----------------------------------------


def _send_failing_with(monkeypatch, exc):
    def fake(req, timeout):
        raise exc
    _patch_urlopen(monkeypatch, fake)
    with pytest.raises(image_gemini.ServiceError) as e:
        image_gemini.SEND(image_gemini.URL, {}, b"{}", 5)
    assert e.value.kind == "network" and e.value.billed is False
    return e.value.maybe_billed


def test_failures_before_anything_is_sent_cannot_have_been_charged(monkeypatch):
    import errno
    import socket
    for reason in (socket.gaierror(8, "no such host"), ConnectionRefusedError(),
                   OSError(errno.ENETUNREACH, "no route")):
        assert _send_failing_with(monkeypatch, urllib.error.URLError(reason)) is False


def test_failures_after_sending_or_unclear_may_have_been_charged(monkeypatch):
    assert _send_failing_with(monkeypatch, TimeoutError("slow")) is True
    assert _send_failing_with(monkeypatch, urllib.error.URLError(TimeoutError())) is True
    assert _send_failing_with(monkeypatch, http.client.IncompleteRead(b"x")) is True
    assert _send_failing_with(monkeypatch, http.client.RemoteDisconnected("gone")) is True
    assert _send_failing_with(monkeypatch, ConnectionResetError()) is True
    assert _send_failing_with(monkeypatch, urllib.error.URLError("who knows")) is True


# -- minor wave 2: G1, G2, L1 --------------------------------------------------


def test_a_certificate_failure_cannot_have_been_charged(monkeypatch):
    import ssl
    bad = ssl.SSLCertVerificationError(1, "certificate verify failed")
    assert _send_failing_with(monkeypatch, urllib.error.URLError(bad)) is False
    assert _send_failing_with(monkeypatch, bad) is False


def test_other_tls_failures_may_have_been_charged(monkeypatch):
    import ssl
    assert _send_failing_with(
        monkeypatch, urllib.error.URLError(ssl.SSLError("bad record mac"))) is True
    assert _send_failing_with(monkeypatch, ssl.SSLError("bad record mac")) is True


def test_maybe_billed_defaults_by_kind():
    make = image_gemini.ServiceError
    assert make("network", "x").maybe_billed is True
    assert make("reply", "x").maybe_billed is False
    assert make("auth", "x").maybe_billed is False
    assert make("network", "x", maybe_billed=False).maybe_billed is False
    assert make("reply", "x", maybe_billed=True).maybe_billed is True


def test_live_check_with_an_unavailable_key_store_exits_plainly(
        monkeypatch, tmp_path, capsys, live):
    def silent(service):
        raise image_keys.StoreUnavailable("The keychain did not answer. "
                                          "Unlock it and try again.")
    monkeypatch.setattr(image_keys, "find", silent)
    monkeypatch.setattr(image_live_check, "FIXTURES", tmp_path / "fx")
    assert image_live_check.main(["--model", "m"], allow_under_test=True) != 0
    assert capsys.readouterr().err == (
        "The keychain did not answer. Unlock it and try again.\n")
    assert live == []


# (thinking, likenesses, prompt bytes, real cents): twelve pictures drawn on
# 2026-11-09. The likeness counts are read back from the old estimates.
REAL_PICTURES = [
    (False, 0, 1400, 3.81), (False, 2, 1400, 4.27), (False, 4, 1400, 4.50),
    (False, 0, 1400, 3.59), (False, 0, 1400, 3.65), (False, 2, 1400, 4.13),
    (True, 0, 1400, 5.53), (True, 2, 1400, 5.66), (True, 4, 1400, 5.82),
    (True, 0, 1400, 4.30), (True, 0, 1400, 4.72), (True, 2, 1400, 4.62),
]


@pytest.mark.parametrize("thinking,likenesses,prompt_bytes,real", REAL_PICTURES)
def test_the_estimate_is_never_under_what_twelve_real_pictures_cost(
        thinking, likenesses, prompt_bytes, real):
    est = image_gemini.estimate("gemini-nano-banana-2.1", "1K", likenesses,
                                prompt_bytes, thinking)
    assert est is not None and est >= real


def test_four_likenesses_with_thinking_off_still_fit_five_cents():
    est = image_gemini.estimate("gemini-nano-banana-2.1", "1K", 4, 2000, False)
    assert est is not None and est < 5
