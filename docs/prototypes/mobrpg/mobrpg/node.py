"""The mobrpg: frontmatter node — read / merge / emit + content_hash.

Machine-managed projection of a vault entity into mobRPG (identity anchors,
determined classifiers, reified-relationship ids, sync state). Scalar values
are JSON-encoded so the block is valid YAML AND round-trips via json.loads.
Text-surgery only: we isolate and replace the single top-level `mobrpg:` block
and NEVER reparse or reformat the GM's hand-authored frontmatter. Stdlib only.
"""
from __future__ import annotations

import hashlib
import json

_SCALARS = ["world_id", "external_ref", "previous_ref", "element_id", "element_kind",
            "review_state", "content_hash", "last_synced", "review_note",
            # Description-merge base (Plan 2): raw-HTML hash for canon-change
            # detection, the frozen canon-section markdown ancestor, the sync
            # timestamp, and the maintain-separately policy flag.
            "canon_html_hash", "canon_base_md", "canon_synced_at", "description_policy"]
_REL_KEYS = ["predicate", "target", "event_type", "event_id", "review_state"]
_LANG_KEYS = ["language", "language_id", "type", "mastery", "review_state"]


def _j(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def emit_node(node: dict) -> str:
    lines = ["mobrpg:"]
    for k in _SCALARS:
        if k in node:
            lines.append(f"  {k}: {_j(node[k])}")
    det = node.get("determined")
    if det is not None:
        lines.append("  determined:")
        for k, v in det.items():
            lines.append(f"    {k}: {_j(v)}")
    for listkey, keys in (("relationships", _REL_KEYS), ("languages", _LANG_KEYS)):
        items = node.get(listkey)
        if not items:
            lines.append(f"  {listkey}: []")
            continue
        lines.append(f"  {listkey}:")
        for it in items:
            first = True
            for k in keys:
                if k not in it:
                    continue
                prefix = "    - " if first else "      "
                lines.append(f"{prefix}{k}: {_j(it[k])}")
                first = False
    return "\n".join(lines) + "\n"


def _split_frontmatter(md_text: str):
    """Return (pre, fm_body, post) where fm_body is the text between the two
    `---` fences, or (None, None, None) if there is no frontmatter."""
    if not md_text.startswith("---"):
        return None, None, None
    end = md_text.find("\n---", 3)
    if end == -1:
        return None, None, None
    nl = md_text.find("\n", 3)                # end of the real opening fence line
    pre = md_text[:nl + 1]                     # opening fence bytes, verbatim
    fm_body = md_text[nl + 1:end + 1]          # includes trailing \n
    post = md_text[end + 1:]                   # starts at "---"
    return pre, fm_body, post


def _find_node_block(fm_body: str):
    """Return (start, end) char offsets of the top-level `mobrpg:` block within
    fm_body, or None. The block runs from the `mobrpg:` line to the next
    top-level (column-0) key or end of fm_body."""
    lines = fm_body.splitlines(keepends=True)
    start_line = None
    pos = 0
    offsets = []
    for ln in lines:
        offsets.append(pos)
        pos += len(ln)
    for i, ln in enumerate(lines):
        if ln.startswith("mobrpg:"):
            start_line = i
            break
    if start_line is None:
        return None
    for j in range(start_line + 1, len(lines)):
        ln = lines[j]
        # The mobrpg: block contains no blank lines, so it ends at the first
        # following line that is blank OR a column-0 key — whichever is first.
        # Any separating blank line(s) stay in the preserved region.
        if ln.strip() == "" or not ln[0].isspace():
            return offsets[start_line], offsets[j]
    return offsets[start_line], len(fm_body)


def read_node(md_text: str) -> dict | None:
    _, fm_body, _ = _split_frontmatter(md_text)
    if fm_body is None:
        return None
    span = _find_node_block(fm_body)
    if span is None:
        return None
    block = fm_body[span[0]:span[1]]
    return _parse_block(block)


def _parse_block(block: str) -> dict:
    node: dict = {}
    cur_list = None
    cur_item = None
    for raw in block.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0:                      # "mobrpg:"
            continue
        if indent == 2:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            cur_list = None
            cur_item = None
            if key == "determined":
                node["determined"] = {}
                cur_list = "determined"
            elif key in ("relationships", "languages"):
                node[key] = [] if val == "[]" else []
                cur_list = key if val != "[]" else None
            else:
                node[key] = json.loads(val)
        elif indent == 4 and cur_list == "determined":
            key, _, val = line.partition(":")
            node["determined"][key.strip()] = json.loads(val.strip())
        elif cur_list in ("relationships", "languages"):
            if line.startswith("- "):
                cur_item = {}
                node[cur_list].append(cur_item)
                line = line[2:]
            key, _, val = line.partition(":")
            if cur_item is not None:
                cur_item[key.strip()] = json.loads(val.strip())
    return node


def write_node(md_text: str, node: dict) -> str:
    block = emit_node(node)
    pre, fm_body, post = _split_frontmatter(md_text)
    if fm_body is None:                       # no frontmatter — create one
        return f"---\n{block}---\n{md_text}"
    span = _find_node_block(fm_body)
    if span is None:
        new_fm = fm_body + block              # append before closing fence
    else:
        new_fm = fm_body[:span[0]] + block + fm_body[span[1]:]
    return pre + new_fm + post


def content_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False,
                           separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
