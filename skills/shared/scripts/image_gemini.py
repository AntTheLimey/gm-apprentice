"""Google Gemini picture drawing: request, reply reading and cost. Stdlib only.

The request shape is Google's "Interactions" image-generation page as read
on 2026-11-09; the reply shape is read from replies captured the same day
(tests/fixtures/image). The key travels in the x-goog-api-key header only, never in
the URL, and no message built here contains it.
"""
from __future__ import annotations

import base64
import http.client
import json
import math
import re
import urllib.error
import urllib.request
from typing import Any, NamedTuple

import dnd_ddb

URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
API_REVISION = "2026-05-20"
TIMEOUT = 180


class Accepts(NamedTuple):
    references: int
    characters: int
    sizes: tuple[str, ...]
    mime: tuple[str, ...]


ACCEPTS = Accepts(14, 4, ("1K", "2K", "4K"), ("image/png", "image/jpeg"))

_SIZE = re.compile(r"[0-9]+K")


class ServiceError(Exception):
    """The service could not be reached or refused. `kind` says which."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def request(model: str, prompt: str, refs: list[tuple[str, bytes]],
            shape: str, size: str, thinking: bool = False) -> bytes:
    """The JSON body for one picture. `refs` are (mime_type, data) pairs."""
    if not _SIZE.fullmatch(size):
        raise ValueError(f"size must look like 1K, 2K or 4K, not {size!r}")
    parts: list[dict[str, str]] = [{"type": "text", "text": prompt}]
    for mime, data in refs:
        parts.append({"type": "image", "mime_type": mime,
                      "data": base64.b64encode(data).decode("ascii")})
    body: dict[str, Any] = {
        "model": model,
        "input": parts,
        "response_format": {"type": "image", "mime_type": "image/jpeg",
                            "aspect_ratio": shape, "image_size": size},
    }
    if not thinking:
        body["generation_config"] = {"thinking_level": "minimal"}
    return json.dumps(body).encode("utf-8")


def headers(key: str) -> dict[str, str]:
    return {"x-goog-api-key": key, "Content-Type": "application/json",
            "Api-Revision": API_REVISION}


def _send(url: str, hdrs: dict[str, str], body: bytes,
          timeout: int) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        try:
            return err.code, err.read()
        except (http.client.HTTPException, OSError) as bad:
            raise ServiceError(
                "network", f"the reply was cut short: {type(bad).__name__}") from None
    except urllib.error.URLError as err:
        raise ServiceError("network", f"could not reach the service: {err.reason}") from None
    except http.client.HTTPException as err:
        raise ServiceError("network", f"the reply was cut short: {type(err).__name__}") from None
    except (TimeoutError, OSError) as err:
        raise ServiceError("network", f"the connection failed: {type(err).__name__}") from None


SEND = _send   # tests replace this


class Picture(NamedTuple):
    data: bytes
    ext: str
    usage: dict[str, int]


class Refused(Exception):
    """The service answered and gave no picture."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Rate(NamedTuple):
    """US dollars per million tokens, and where the figures came from."""
    input_per_m: float
    image_out_per_m: float
    text_out_per_m: float
    out_tokens: dict[str, int]
    checked: str
    source: str


RATES: dict[str, Rate] = {
    "gemini-nano-banana-2.1": Rate(
        input_per_m=1.50, image_out_per_m=30.00, text_out_per_m=7.50,
        out_tokens={"1K": 1120, "2K": 1680, "4K": 3780},
        checked="2026-11-09",
        source="https://aistudio.google.com/docs/pricing"),
}

# Measured on 2026-11-09 from real replies (tests/fixtures/image), rounded up.
REF_TOKENS = 1200     # input tokens per reference picture; measured 1120
OTHER_TOKENS = 500    # output tokens beyond the picture; measured 171 to 425
THINK_TOKENS = 1100   # thought tokens with thinking on; measured 326 to 1088


def _check_count(name: str, x: float) -> None:
    if not math.isfinite(x) or x < 0:
        raise ValueError(f"{name} must be finite and not negative, got {x}")


def estimate(model: str, size: str, refs: int, prompt_chars: int,
             thinking: bool = False) -> float | None:
    """Worst-case cost of one picture in US cents; None for an unknown model."""
    rate = RATES.get(model)
    if rate is None:
        return None
    if size not in rate.out_tokens:
        raise ValueError(f"no rate for size {size!r}")
    _check_count("refs", refs)
    _check_count("prompt_chars", prompt_chars)
    text_out = OTHER_TOKENS + (THINK_TOKENS if thinking else 0)
    dollars = (rate.out_tokens[size] * rate.image_out_per_m
               + (refs * REF_TOKENS + prompt_chars / 3) * rate.input_per_m
               + text_out * rate.text_out_per_m) / 1_000_000
    return dollars * 100


def cost(model: str, usage: dict[str, int]) -> float | None:
    """Real cost in US cents of a reply's `usage`; None for an unknown model."""
    rate = RATES.get(model)
    if rate is None:
        return None
    for name in ("input", "image", "other", "thought"):
        _check_count(name, usage[name])
    dollars = (usage["input"] * rate.input_per_m
               + usage["image"] * rate.image_out_per_m
               + (usage["other"] + usage["thought"]) * rate.text_out_per_m
               ) / 1_000_000
    return dollars * 100


# -- reading replies ---------------------------------------------------------

_MESSAGES = {
    401: ("auth", "The picture service did not accept the key."),
    403: ("auth", "The picture service did not accept the key."),
    402: ("quota", "The picture service says the account is out of credit."),
    429: ("quota", "The picture service says the account's limit has been "
                   "reached; try again later."),
}


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _own_message(reply: Any, raw: bytes) -> str:
    """The service's error message, else the first 300 characters of the body."""
    err = reply.get("error") if isinstance(reply, dict) else None
    if isinstance(err, dict):
        err = err.get("message")
    if isinstance(err, str) and err.strip():
        return err.strip()
    return raw.decode("utf-8", errors="replace")[:300]


def _count(x: Any) -> int:
    return x if isinstance(x, int) and not isinstance(x, bool) and x >= 0 else 0


def _usage(reply: dict[str, Any]) -> dict[str, int]:
    use = reply.get("usage")
    use = use if isinstance(use, dict) else {}
    image = 0
    modes = use.get("output_tokens_by_modality")
    for mode in modes if isinstance(modes, list) else []:
        if isinstance(mode, dict) and mode.get("modality") == "image":
            image += _count(mode.get("tokens"))
    return {"input": _count(use.get("total_input_tokens")),
            "image": image,
            "other": max(_count(use.get("total_output_tokens")) - image, 0),
            "thought": _count(use.get("total_thought_tokens"))}


def _read(reply: Any, raw: bytes, key: str) -> Picture:
    steps = reply.get("steps") if isinstance(reply, dict) else None
    if not isinstance(steps, list):
        raise ServiceError("reply", _clean(
            "the picture service's reply was not in the expected shape: "
            + raw.decode("utf-8", errors="replace")[:300], key))
    items: list[dict[str, Any]] = []
    for step in steps:
        if isinstance(step, dict) and step.get("type") == "model_output":
            content = step.get("content")
            items += [c for c in content if isinstance(c, dict)] \
                if isinstance(content, list) else []
    image = next((c for c in items if c.get("type") == "image"
                  and isinstance(c.get("data"), str)), None)
    if image is None:
        said = " ".join(c["text"] for c in items
                        if c.get("type") == "text" and isinstance(c.get("text"), str))
        status = reply.get("status")
        raise Refused(_clean(
            said or (status if isinstance(status, str) and status != "completed"
                     else "the service returned no picture"), key))
    try:
        data = base64.b64decode(image["data"], validate=True)
    except ValueError:
        raise ServiceError(
            "reply", "the picture service sent a picture that could not be read") from None
    ext = dnd_ddb.image_type(data)
    if ext not in ("jpg", "png", "webp"):
        raise ServiceError("reply", "the picture service sent something that is not a picture")
    return Picture(data, ext, _usage(reply))


def _clean(text: str, key: str) -> str:
    return text.replace(key, "<key>") if key else text


def draw(model: str, key: str, prompt: str, refs: list[tuple[str, bytes]],
         shape: str, size: str, thinking: bool = False) -> Picture:
    """One picture, or `ServiceError` / `Refused`. When the service will not
    take the minimal thinking level, the call is made once more without it."""
    hdrs = headers(key)
    body = request(model, prompt, refs, shape, size, thinking)
    status, raw = SEND(URL, hdrs, body, TIMEOUT)
    reply = _json(raw)
    if (status == 400 and not thinking
            and "thinking level" in _own_message(reply, raw).lower()):
        body = request(model, prompt, refs, shape, size, True)
        status, raw = SEND(URL, hdrs, body, TIMEOUT)
        reply = _json(raw)
    if status in _MESSAGES:
        raise ServiceError(*_MESSAGES[status])
    if status != 200:
        raise ServiceError("reply", _clean(_own_message(reply, raw), key))
    return _read(reply, raw, key)
