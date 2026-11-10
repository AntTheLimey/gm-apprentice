"""Google Gemini picture drawing: the request half. Stdlib only.

The request shape is Google's "Interactions" image-generation page as read
on 2026-11-09. The key travels in the x-goog-api-key header only, never in
the URL, and no message built here contains it.
"""
from __future__ import annotations

import base64
import http.client
import json
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
