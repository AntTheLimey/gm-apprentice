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
        3.36 + image_gemini.THINK_TOKENS * 7.50 / 10_000)
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


def test_four_references_at_1k_fit_under_five_cents():
    assert image_gemini.estimate(MODEL, "1K", 4, 2000) < 5


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
