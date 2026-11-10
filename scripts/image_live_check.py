#!/usr/bin/env python3
"""Hand-run check that captures real Gemini replies for the adapter tests.

    image_live_check.py --model MODEL [--reference PICTURE ...]
                        [--refusal-prompt TEXT] [--save PATH]

Makes up to three real calls (about 10 cents) at size 1K: prompt only,
prompt with the references, and a prompt the service should decline. Each
reply goes to tests/fixtures/image/gemini-<name>.json with every long
base64 string cut to its first 64 characters plus "...<cut>". The key is
never printed or written. Never run under pytest.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
import image_gemini  # noqa: E402
import image_keys  # noqa: E402

FIXTURES = REPO / "tests" / "fixtures" / "image"
CUT = 64
MIN_PICTURE = 200   # a base64 string this long is treated as a picture
_B64 = re.compile(r"[A-Za-z0-9+/_-]+={0,2}")
PROMPT = "A weathered wooden dock at dusk, fishing boats moored, soft lamplight."


def _is_picture(s: str) -> bool:
    return len(s) >= MIN_PICTURE and _B64.fullmatch(s) is not None


def cut(node: Any) -> Any:
    """A copy of `node` with every base64 picture cut short."""
    if isinstance(node, str):
        return node[:CUT] + "...<cut>" if _is_picture(node) else node
    if isinstance(node, list):
        return [cut(x) for x in node]
    if isinstance(node, dict):
        return {k: cut(v) for k, v in node.items()}
    return node


def pictures(node: Any) -> list[str]:
    """Every base64 picture string in the reply, in document order."""
    if isinstance(node, str):
        return [node] if _is_picture(node) else []
    if isinstance(node, list):
        return [p for x in node for p in pictures(x)]
    if isinstance(node, dict):
        return [p for v in node.values() for p in pictures(v)]
    return []


def find_usage(node: Any) -> Any:
    if isinstance(node, dict):
        if "usage" in node:
            return node["usage"]
        for v in node.values():
            found = find_usage(v)
            if found is not None:
                return found
    elif isinstance(node, list):
        for x in node:
            found = find_usage(x)
            if found is not None:
                return found
    return None


def _decode(data: str) -> bytes:
    data = data.replace("-", "+").replace("_", "/")
    return base64.b64decode(data + "=" * (-len(data) % 4))


def main(argv: list[str] | None = None, *, allow_under_test: bool = False) -> int:
    if "PYTEST_CURRENT_TEST" in os.environ and not allow_under_test:
        sys.exit("image_live_check.py spends real money: it does not run under pytest.")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model", required=True)
    ap.add_argument("--reference", action="append", default=[], metavar="PICTURE")
    ap.add_argument("--refusal-prompt")
    ap.add_argument("--save", metavar="PATH",
                    help="write the first picture received, uncut")
    args = ap.parse_args(argv)

    found = image_keys.find("gemini")
    if found is None:
        print("No Gemini key found. Run `gma image key gemini` or set "
              "GEMINI_API_KEY.", file=sys.stderr)
        return 1
    key, source = found
    print(f"Using the Gemini key from the {source}.")

    refs: list[tuple[str, bytes]] = []
    for name in args.reference:
        path = Path(name)
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        refs.append((mime, path.read_bytes()))

    runs: list[tuple[str, str, list[tuple[str, bytes]]]] = [
        ("prompt-only", PROMPT, [])]
    if refs:
        runs.append(("with-references",
                     "The same dock, drawn in the style of the reference picture(s).",
                     refs))
    if args.refusal_prompt:
        runs.append(("refusal", args.refusal_prompt, []))

    FIXTURES.mkdir(parents=True, exist_ok=True)
    saved = False
    for name, prompt, run_refs in runs:
        body = image_gemini.request(args.model, prompt, run_refs, "1:1", "1K")
        try:
            status, raw = image_gemini.SEND(
                image_gemini.URL, image_gemini.headers(key), body,
                image_gemini.TIMEOUT)
        except image_gemini.ServiceError as err:
            print(f"{name}: {err.kind}: {err.message}", file=sys.stderr)
            continue
        try:
            reply: Any = json.loads(raw)
        except ValueError:
            reply = {"unparsed_text": raw.decode("utf-8", "replace")}
        out = FIXTURES / f"gemini-{name}.json"
        out.write_text(json.dumps({"status": status, "reply": cut(reply)},
                                  indent=2) + "\n", encoding="utf-8")
        pics = pictures(reply)
        print(f"{name}: HTTP {status}, {len(pics)} picture(s), saved {out}")
        print(f"{name}: usage = {json.dumps(find_usage(reply))}")
        if args.save and pics and not saved:
            Path(args.save).write_bytes(_decode(pics[0]))
            saved = True
            print(f"{name}: first picture written to {args.save}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
