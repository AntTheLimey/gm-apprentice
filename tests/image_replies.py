"""Real captured Gemini replies as a `image_gemini.SEND` stub, shared by the
picture tests. The captured replies are in tests/fixtures/image."""

import base64
import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "image"
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/9oADAMB"
    "AAIRAxEAPwDkKKKK8U/TD//Z")
SECRET = "SECRET-KEY-123"


def fixture(name):
    """(status, body bytes) of a captured reply, its cut picture data replaced
    by a real tiny JPEG (the captured data was cut to 64 characters)."""
    saved = json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    def fill(node):
        if isinstance(node, dict):
            return {k: fill(v) for k, v in node.items()}
        if isinstance(node, list):
            return [fill(v) for v in node]
        if isinstance(node, str) and "...<cut " in node and node.startswith("/9j/"):
            return base64.b64encode(TINY_JPEG).decode()
        return node
    return saved["status"], json.dumps(fill(saved["reply"])).encode()


class Sender:
    """Replies in order (the last repeats). A reply that is an exception is
    raised, as `image_gemini.SEND` raises a network failure. Every request
    body is recorded in `calls`."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, url, hdrs, body, timeout):
        self.calls.append(json.loads(body))
        reply = self.replies[min(len(self.calls), len(self.replies)) - 1]
        if isinstance(reply, BaseException):
            raise reply
        return reply
