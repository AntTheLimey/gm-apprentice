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
    """A copy of `node` with every long base64 string cut short, its
    original length kept in the marker."""
    if isinstance(node, str):
        if _is_picture(node):
            return f"{node[:CUT]}...<cut {len(node)} chars>"
        return node
    if isinstance(node, list):
        return [cut(x) for x in node]
    if isinstance(node, dict):
        return {k: cut(v) for k, v in node.items()}
    return node


def _walk(node: Any, path: str = ""):
    """Yield (path, node) for every JSON node, in document order."""
    yield path, node
    if isinstance(node, list):
        for i, x in enumerate(node):
            yield from _walk(x, f"{path}[{i}]")
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _walk(v, f"{path}.{k}" if path else str(k))


def image_nodes(reply: Any) -> list[tuple[str, dict[str, Any]]]:
    """Nodes shaped like {"type": "image", ..., "data": ...}, with paths."""
    return [(p, n) for p, n in _walk(reply)
            if isinstance(n, dict) and n.get("type") == "image"]


def pictures(reply: Any) -> list[str]:
    """Picture data: from type:image nodes if there are any with data,
    else every long base64 string in the reply, in document order."""
    typed = [n["data"] for _, n in image_nodes(reply)
             if isinstance(n.get("data"), str) and n["data"]]
    if typed:
        return typed
    return [n for _, n in _walk(reply) if isinstance(n, str) and _is_picture(n)]


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

    try:
        found = image_keys.find("gemini")
    except image_keys.StoreUnavailable as err:
        print(str(err), file=sys.stderr)
        return 1
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
        if mime not in image_gemini.ACCEPTS.mime:
            print(f"{name}: type {mime} is not accepted; use "
                  f"{' or '.join(image_gemini.ACCEPTS.mime)}.", file=sys.stderr)
            return 1
        refs.append((mime, path.read_bytes()))

    runs: list[tuple[str, str, list[tuple[str, bytes]]]] = [
        ("prompt-only", PROMPT, [])]
    if refs:
        runs.append(("with-references",
                     "The same dock, drawn in the style of the reference picture(s).",
                     refs))
    if args.refusal_prompt:
        runs.append(("refusal", args.refusal_prompt, []))

    try:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        if not os.access(FIXTURES, os.W_OK):
            raise OSError("not writable")
    except OSError as err:
        print(f"Cannot write fixtures to {FIXTURES}: {err}. Nothing was spent.",
              file=sys.stderr)
        return 1
    if args.save:
        parent = Path(args.save).resolve().parent
        if not parent.is_dir() or not os.access(parent, os.W_OK):
            print(f"Cannot write to {parent}: no such writable folder. "
                  "Nothing was spent.", file=sys.stderr)
            return 1
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
        text = json.dumps({"status": status, "reply": cut(reply)}, indent=2)
        out.write_text(text.replace(key, "<key>") + "\n", encoding="utf-8")
        pics = pictures(reply)
        nodes = image_nodes(reply)
        fields = sorted(reply) if isinstance(reply, dict) else type(reply).__name__
        print(f"{name}: HTTP {status}, {len(pics)} picture(s), saved {out}")
        print(f"{name}: top-level fields = {fields}")
        print(f"{name}: image node at = {nodes[0][0] if nodes else None}")
        print(f"{name}: usage = {json.dumps(find_usage(reply)).replace(key, '<key>')}")
        if args.save and pics and not saved:
            try:
                Path(args.save).write_bytes(_decode(pics[0]))
            except (OSError, ValueError) as err:
                print(f"{name}: could not save the picture: {err}", file=sys.stderr)
            else:
                saved = True
                print(f"{name}: first picture written to {args.save}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
