"""GFM markdown <-> HTML conversion for mobRPG content fidelity.

Replaces the old lossy `md_to_html` (headings + bold only; tables/lists dropped).
Stdlib-only (the CLI is stdlib-only). Handles the block + inline constructs that
appear in vault bodies:

  blocks:  headings (#..######), GFM tables, unordered lists (-/*/+),
           ordered lists (1.), blockquotes (>), paragraphs (blank-line separated)
  inline:  **bold**, *italic*/_italic_, `code`, [text](url), literal line breaks

`md_to_html(md)` -> HTML string (what a suggestion `description` should carry).
`html_to_md(html)` -> markdown (the inverse, for pulling content back to the vault).

Not a full CommonMark implementation — a pragmatic, round-trip-oriented subset
covering what the vault uses. Tables are the headline fix.
"""

from __future__ import annotations

import html as _html
import re
from html.parser import HTMLParser

# ---------------- markdown -> HTML ----------------

_INLINE_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)|_([^_]+)_")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _inline(text: str) -> str:
    """Escape HTML then apply inline markdown. Code spans are protected first."""
    spans: list[str] = []

    def stash(m):
        spans.append(_html.escape(m.group(1)))
        return f"\x00{len(spans) - 1}\x00"

    text = _INLINE_CODE.sub(stash, text)
    text = _html.escape(text)
    text = _LINK.sub(lambda m: f'<a href="{_html.escape(m.group(2), quote=True)}">{m.group(1)}</a>', text)
    text = _BOLD.sub(r"<strong>\1</strong>", text)
    text = _ITALIC.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", text)
    text = re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{spans[int(m.group(1))]}</code>", text)
    return text


def _is_table(block: list[str]) -> bool:
    return (len(block) >= 2 and block[0].lstrip().startswith("|")
            and re.match(r"^\s*\|?[\s:|-]+\|?\s*$", block[1]) is not None
            and "-" in block[1])


def _cells(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def _table_html(block: list[str]) -> str:
    head = _cells(block[0])
    body = [_cells(r) for r in block[2:] if r.strip()]
    out = ["<table><thead><tr>"]
    out += [f"<th>{_inline(c)}</th>" for c in head]
    out.append("</tr></thead><tbody>")
    for row in body:
        out.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in row) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def _list_html(block: list[str], ordered: bool) -> str:
    tag = "ol" if ordered else "ul"
    items = []
    for line in block:
        line = re.sub(r"^\s*(?:[-*+]|\d+\.)\s+", "", line)
        items.append(f"<li>{_inline(line)}</li>")
    return f"<{tag}>" + "".join(items) + f"</{tag}>"


def md_to_html(md: str | None) -> str:
    if not md:
        return ""
    lines = md.replace("\r\n", "\n").split("\n")
    blocks: list[list[str]] = []
    cur: list[str] = []
    for line in lines:
        if line.strip() == "":
            if cur:
                blocks.append(cur)
                cur = []
        else:
            cur.append(line)
    if cur:
        blocks.append(cur)

    html_parts: list[str] = []
    for block in blocks:
        first = block[0].lstrip()
        h = re.match(r"^(#{1,6})\s+(.*)$", first)
        if h and len(block) == 1:
            level = len(h.group(1))
            html_parts.append(f"<h{level}>{_inline(h.group(2))}</h{level}>")
        elif _is_table(block):
            html_parts.append(_table_html(block))
        elif re.match(r"^\s*[-*+]\s+", block[0]):
            html_parts.append(_list_html(block, ordered=False))
        elif re.match(r"^\s*\d+\.\s+", block[0]):
            html_parts.append(_list_html(block, ordered=True))
        elif all(re.match(r"^\s*>", ln) for ln in block):
            inner = " ".join(re.sub(r"^\s*>\s?", "", ln) for ln in block)
            html_parts.append(f"<blockquote>{_inline(inner)}</blockquote>")
        else:
            html_parts.append(f"<p>{'<br>'.join(_inline(ln) for ln in block)}</p>")
    return "".join(html_parts)


# ---------------- HTML -> markdown ----------------

class _ToMd(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.list_stack: list[str] = []
        self.in_table = False
        self.row: list[str] = []
        self.table_rows: list[list[str]] = []
        self.is_header_row = False
        self.header: list[str] = []
        self._cell: list[str] | None = None
        self._href: str | None = None

    def _emit(self, s: str):
        (self._cell if self._cell is not None else self.out).append(s)

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag == "code":
            self._emit("`")
        elif tag == "a":
            self._href = d.get("href", "")
            self._emit("[")
        elif tag == "br":
            self._emit("\n")
        elif tag in ("ul", "ol"):
            self.list_stack.append(tag)
        elif tag == "li":
            prefix = "1. " if (self.list_stack and self.list_stack[-1] == "ol") else "- "
            self.out.append("\n" + prefix)
        elif tag == "table":
            self.in_table = True
            self.table_rows = []
            self.header = []
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self._cell = []
            self.is_header_row = (tag == "th")

    def handle_endtag(self, tag):
        if tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag == "code":
            self._emit("`")
        elif tag == "a":
            self._emit(f"]({self._href or ''})")
            self._href = None
        elif tag in ("ul", "ol") and self.list_stack:
            self.list_stack.pop()
            self.out.append("\n")
        elif tag in ("td", "th"):
            cell = "".join(self._cell or []).strip()
            self.row.append(cell)
            self._cell = None
        elif tag == "tr":
            if self.is_header_row:
                self.header = self.row
            else:
                self.table_rows.append(self.row)
            self.row = []
            self.is_header_row = False
        elif tag == "table":
            self.out.append("\n" + self._render_table() + "\n")
            self.in_table = False
        elif tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"):
            self.out.append("\n\n")

    def handle_starttag_h(self, level):
        self.out.append("\n\n" + "#" * level + " ")

    def handle_data(self, data):
        if self.in_table or self._cell is not None:
            if self._cell is not None:
                self._cell.append(data)
            return
        self._emit(data)

    def _render_table(self) -> str:
        if not self.header and not self.table_rows:
            return ""
        cols = len(self.header) or (len(self.table_rows[0]) if self.table_rows else 0)
        head = self.header or ["" for _ in range(cols)]
        lines = ["| " + " | ".join(head) + " |",
                 "| " + " | ".join("---" for _ in range(cols)) + " |"]
        for r in self.table_rows:
            lines.append("| " + " | ".join(r) + " |")
        return "\n".join(lines)


# headings need the level; patch start handling for h1..h6
def _install_heading_hook():
    orig = _ToMd.handle_starttag

    def patched(self, tag, attrs):
        if len(tag) == 2 and tag[0] == "h" and tag[1] in "123456":
            self.handle_starttag_h(int(tag[1]))
            return
        orig(self, tag, attrs)

    _ToMd.handle_starttag = patched


_install_heading_hook()


def html_to_md(html_str: str | None) -> str:
    if not html_str:
        return ""
    p = _ToMd()
    p.feed(html_str)
    text = "".join(p.out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
