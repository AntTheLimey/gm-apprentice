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
import errno
import re
import socket
import ssl
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

    def __init__(self, kind: str, message: str,
                 usage: dict[str, int] | None = None,
                 billed: bool = False, maybe_billed: bool | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.usage = usage      # the reply's usage, when it had one
        self.billed = billed    # True when the service answered 200: it charged
        # True when the request may have reached the service and the reply was
        # lost, so it may have charged. False only for failures that can happen
        # before anything is sent (no address, refused, no route, a certificate
        # that did not check out). Not given: True for a network failure
        # (assume the reply was lost), False for any other kind.
        self.maybe_billed = kind == "network" if maybe_billed is None else maybe_billed


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


_NOT_SENT = (errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ENETDOWN,
             errno.EHOSTDOWN, errno.ECONNREFUSED)


def _before_sending(reason: object) -> bool:
    """Whether a URLError reason can only happen before the request is sent.
    Anything not recognised counts as possibly sent."""
    if isinstance(reason, (socket.gaierror, ConnectionRefusedError,
                           ssl.SSLCertVerificationError)):
        return True
    return (isinstance(reason, OSError) and not isinstance(reason, TimeoutError)
            and reason.errno in _NOT_SENT)


URLOPEN = urllib.request.urlopen   # tests replace this


def _send(url: str, hdrs: dict[str, str], body: bytes,
          timeout: int) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=hdrs, method="POST")
    try:
        with URLOPEN(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        try:
            return err.code, err.read()
        except (http.client.HTTPException, OSError) as bad:
            raise ServiceError(
                "network", f"the reply was cut short: {type(bad).__name__}",
                maybe_billed=True) from None
    except urllib.error.URLError as err:
        raise ServiceError("network", f"could not reach the service: {err.reason}",
                           maybe_billed=not _before_sending(err.reason)) from None
    except http.client.HTTPException as err:
        raise ServiceError("network", f"the reply was cut short: {type(err).__name__}",
                           maybe_billed=True) from None
    except (TimeoutError, OSError) as err:
        raise ServiceError("network", f"the connection failed: {type(err).__name__}",
                           maybe_billed=not isinstance(
                               err, ssl.SSLCertVerificationError)) from None


SEND = _send   # tests replace this


class Picture(NamedTuple):
    data: bytes
    ext: str
    usage: dict[str, int] | None   # None: the reply gave no usable usage


class Refused(Exception):
    """The service answered and gave no picture."""

    def __init__(self, reason: str, usage: dict[str, int] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.usage = usage


class NeedsThinking(Exception):
    """The service will not draw at the minimal thinking level. Nothing was
    billed. The caller decides whether the picture still fits with thinking on."""


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
# Output tokens beyond the picture: measured 171 to about 690 across 13 pictures
# on 2026-11-09 (rich style prompts use more); about 45% headroom.
OTHER_TOKENS = 1000
# Thought tokens with thinking on: with OTHER_TOKENS this allows 3500 against a
# measured other-plus-thought of 1170 to about 2830 on 2026-11-09; the model
# chooses them and nothing caps them, so this is a likely ceiling, not a
# guarantee.
THINK_TOKENS = 2500


def _check_count(name: str, x: float) -> None:
    if not math.isfinite(x) or x < 0:
        raise ValueError(f"{name} must be finite and not negative, got {x}")


def estimate(model: str, size: str, refs: int, prompt_bytes: int,
             thinking: bool = False) -> float | None:
    """Cost of one picture in US cents; None for an unknown model. With
    thinking off the figure is built to be at or above the real cost; with
    thinking on it is a likely ceiling. `prompt_bytes` is the UTF-8 length."""
    rate = RATES.get(model)
    if rate is None:
        return None
    if size not in rate.out_tokens:
        raise ValueError(f"no rate for size {size!r}")
    _check_count("refs", refs)
    _check_count("prompt_bytes", prompt_bytes)
    text_out = OTHER_TOKENS + (THINK_TOKENS if thinking else 0)
    dollars = (rate.out_tokens[size] * rate.image_out_per_m
               + (refs * REF_TOKENS + prompt_bytes / 3) * rate.input_per_m
               + text_out * rate.text_out_per_m) / 1_000_000
    return dollars * 100


def cost(model: str, usage: dict[str, int]) -> float | None:
    """Real cost in US cents of a reply's `usage`; None for an unknown model."""
    rate = RATES.get(model)
    if rate is None:
        return None
    for name in ("input", "image", "other", "thought"):
        x = usage.get(name)
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            raise ValueError(f"usage[{name!r}] must be a number, got {x!r}")
        _check_count(name, x)
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
        return err.strip()[:300]
    return raw.decode("utf-8", errors="replace")[:300]


def _count(x: Any) -> int:
    return x if isinstance(x, int) and not isinstance(x, bool) and x >= 0 else 0


def _usage(reply: dict[str, Any]) -> dict[str, int] | None:
    """The four counted figures, or None when the reply has no usage object."""
    use = reply.get("usage")
    if not isinstance(use, dict):
        return None
    image = 0
    modes = use.get("output_tokens_by_modality")
    for mode in modes if isinstance(modes, list) else []:
        if isinstance(mode, dict) and mode.get("modality") == "image":
            image += _count(mode.get("tokens"))
    counted = {"input": _count(use.get("total_input_tokens")),
               "image": image,
               "other": max(_count(use.get("total_output_tokens")) - image, 0)
               + _count(use.get("total_tool_use_tokens")),
               "thought": _count(use.get("total_thought_tokens"))}
    # A usage object holding none of the expected figures is not a report.
    return counted if any(counted.values()) else None


def _clean(text: str, key: str) -> str:
    return text.replace(key, "<key>") if key else text


def _read(reply: Any, raw: bytes, key: str) -> Picture:
    """A 200 reply: a Picture, or Refused / ServiceError carrying its usage
    (the service charged for it either way)."""
    usage = _usage(reply) if isinstance(reply, dict) else None

    def bad(message: str) -> ServiceError:
        return ServiceError("reply", _clean(message, key), usage, billed=True)
    steps = reply.get("steps") if isinstance(reply, dict) else None
    if not isinstance(steps, list):
        raise bad("the picture service's reply was not in the expected shape: "
                  + raw.decode("utf-8", errors="replace")[:300])
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
                     else "the service returned no picture"), key), usage)
    try:
        data = base64.b64decode(image["data"], validate=True)
    except ValueError:
        raise bad("the picture service sent a picture that could not be read") from None
    ext = dnd_ddb.image_type(data)
    if ext not in ("jpg", "png", "webp"):
        raise bad("the picture service sent something that is not a picture")
    # A usage with no image tokens beside a picture means the shape changed.
    return Picture(data, ext, usage if usage and usage["image"] > 0 else None)


def draw(model: str, key: str, prompt: str, refs: list[tuple[str, bytes]],
         shape: str, size: str, thinking: bool = False) -> Picture:
    """One picture, or `ServiceError` / `Refused` / `NeedsThinking`. It never
    changes what the picture costs: when the service will not take the minimal
    thinking level it raises `NeedsThinking` and the caller chooses."""
    body = request(model, prompt, refs, shape, size, thinking)
    status, raw = SEND(URL, headers(key), body, TIMEOUT)
    reply = _json(raw)
    if status in _MESSAGES:
        raise ServiceError(*_MESSAGES[status])
    if status != 200:
        message = _own_message(reply, raw)
        if status == 400 and not thinking and "thinking level" in message.lower():
            raise NeedsThinking(_clean(message, key))
        raise ServiceError("reply", _clean(message, key))
    pic = _read(reply, raw, key)
    return pic._replace(usage=_believed(model, size, pic.usage))


def _believed(model: str, size: str, usage: dict[str, int] | None
              ) -> dict[str, int] | None:
    """A report that prices a real picture at next to nothing is not believed:
    for a known model, fewer image tokens than the size always takes give None
    (the caller then counts its estimate instead)."""
    rate = RATES.get(model)
    if usage is None or rate is None:
        return usage
    return usage if usage["image"] >= rate.out_tokens.get(size, 0) else None
