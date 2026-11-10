"""Google Gemini picture drawing: the request half. Stdlib only.

The request shape is Google's "Interactions" image-generation page as read
on 2026-11-09. The key travels in the x-goog-api-key header only, never in
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
from typing import NamedTuple

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
            shape: str, size: str) -> bytes:
    """The JSON body for one picture. `refs` are (mime_type, data) pairs."""
    if not _SIZE.fullmatch(size):
        raise ValueError(f"size must look like 1K, 2K or 4K, not {size!r}")
    parts: list[dict[str, str]] = [{"type": "text", "text": prompt}]
    for mime, data in refs:
        parts.append({"type": "image", "mime_type": mime,
                      "data": base64.b64encode(data).decode("ascii")})
    return json.dumps({
        "model": model,
        "input": parts,
        "response_format": {"type": "image", "mime_type": "image/jpeg",
                            "aspect_ratio": shape, "image_size": size},
    }).encode("utf-8")


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
        return err.code, err.read()
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

# Deliberately high provisional guesses; the live check's measured figure,
# rounded up to the next hundred, will replace each.
REF_TOKENS = 1200
THINK_TOKENS = 500


def estimate(model: str, size: str, refs: int, prompt_chars: int) -> float | None:
    """Worst-case cost of one picture in US cents; None for an unknown model."""
    rate = RATES.get(model)
    if rate is None:
        return None
    if size not in rate.out_tokens:
        raise ValueError(f"no rate for size {size!r}")
    if (not math.isfinite(refs) or not math.isfinite(prompt_chars)
            or refs < 0 or prompt_chars < 0):
        raise ValueError("refs and prompt_chars must be finite and not negative")
    dollars = (rate.out_tokens[size] * rate.image_out_per_m
               + (refs * REF_TOKENS + prompt_chars / 3) * rate.input_per_m
               + THINK_TOKENS * rate.text_out_per_m) / 1_000_000
    return dollars * 100
