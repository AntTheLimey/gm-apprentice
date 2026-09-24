"""Rewrite vault links to mobRPG element links on push, and back on pull.

The vault authors cross-references as Obsidian wikilinks (`[[Name]]` /
`[[Name|Alias]]`); mobRPG descriptions carry plain HTML anchors to an element's
id-only redirect route. This module bridges the two, always operating on the
`main` (canon-prose) slice — never the GM Notes tail:

  push  — `![[embeds]]` are dropped first (an image embed references a vault
          attachment with no upstream counterpart); then `[[Name]]` /
          `[[Name|Alias]]` -> `[display](element-url)` when the name
          resolves in the node index; unresolvable wikilinks and `.md` relative
          links collapse to bare display text; `http(s)` links are left alone.
          Runs BEFORE `md.md_to_html`.
  pull  — an element URL (matched against `URL_FMT`) whose id is a known vault
          note -> `[[Name]]`; every other link is left untouched. Runs AFTER
          `md.html_to_md`.

Element URL — Task 1 verdict: the id-only redirect is the correct rewrite target
because a vault node knows the element id without needing its type.

Limitation: these are regex passes, not a Markdown parser (matching the rest of
md.py). A wikilink or element URL that appears inside an inline-code span or a
fenced code block WILL be rewritten. The vault does not put links in code, so
this is acceptable; a full CommonMark parser is out of scope for the CLI.
"""
from __future__ import annotations

import re

from mobrpg.commands import suggest

# Task 1 Step 3 verdict — the id-only redirect route. Vault nodes carry the
# element id, so this is the resolvable rewrite target (the type-full route
# would need a type the node need not know).
URL_FMT = "https://www.mobrpg.com/world/{world}/link/{eid}"

# `![[...]]` is an EMBED (image attachment or note transclusion), not a link:
# it has no upstream counterpart (there is no attachment-push path), so a push
# drops it entirely. Left to the wikilink pass, the `!` was stranded while the
# target collapsed — `![[map.png]]` -> `!map.png`, and `![[map.svg|697]]` ->
# `!697` (an embed's pipe is a display width, not an alias). See #184.
# An embed alone on its line vanishes with the line; an inline embed vanishes
# with the spaces immediately before it, so surrounding words never weld
# together. (Like the wikilink pass this is a regex, not a parser: an embed
# inside a code span is dropped too — the same documented trade-off.)
_EMBED_LINE = re.compile(r"^[ \t]*!\[\[[^\]\r\n]+\]\][ \t]*\r?\n?", re.M)
_EMBED_INLINE = re.compile(r"(?P<lead>[ \t]*)!\[\[[^\]\r\n]+\]\](?P<trail>[ \t]*)")


def _drop_inline_embed(m: re.Match) -> str:
    """Leave at most one separating space where whitespace flanked the embed,
    so `before ![[m.png]]after` reads `before after`, never `beforeafter`."""
    return " " if (m.group("lead") or m.group("trail")) else ""
# `[[Name]]` or `[[Name|Alias]]` — group 1 is the resolution Name, group 2 the
# optional display Alias.
_WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
# A standard inline markdown link `[text](href)`.
_MDLINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
# A relative link into another vault note (optionally with an anchor).
_DOTMD = re.compile(r"\.md(#[^)]*)?$", re.I)
_HTTP = re.compile(r"https?://", re.I)


def _element_url_re(url_fmt: str) -> re.Pattern:
    """Compile a matcher for URLs produced by `url_fmt`, capturing the element id.
    Built from the format string itself so the two never drift apart."""
    pat = re.escape(url_fmt)
    pat = pat.replace(re.escape("{world}"), r"[^/)\s]+")
    pat = pat.replace(re.escape("{eid}"), r"(?P<eid>[^/)\s]+)")
    return re.compile(pat)


_ELEMENT_URL = _element_url_re(URL_FMT)


def rewrite_md_for_push(md_text: str, ent_id_by_key: dict,
                        world_id: str, url_fmt: str = URL_FMT) -> str:
    """Wikilinks -> element links (resolved via `ent_id_by_key`, keyed by
    `suggest._key`); unresolvable wikilinks and `.md` relative links -> bare
    display text; `http(s)` links untouched."""
    def _wl(m: re.Match) -> str:
        name = m.group(1).strip()
        display = (m.group(2) or m.group(1)).strip()   # [[Name|Alias]] shows Alias
        eid = ent_id_by_key.get(suggest._key(name))    # ...but resolves by Name
        if eid:
            return f"[{display}]({url_fmt.format(world=world_id, eid=eid)})"
        return display

    text = _EMBED_LINE.sub("", md_text or "")
    text = _WIKILINK.sub(_wl, _EMBED_INLINE.sub(_drop_inline_embed, text))

    def _ml(m: re.Match) -> str:
        label, href = m.group(1), m.group(2)
        if _HTTP.match(href):
            return m.group(0)                          # external — leave alone
        if _DOTMD.search(href):
            return label                               # vault-relative — flatten
        return m.group(0)                              # anything else — untouched

    return _MDLINK.sub(_ml, text)


# `href` located anywhere in the tag (not just as the first attribute) and in
# either quote style — an anchor mobRPG's OWN web-editor round-trip produced
# (or the server otherwise re-serialized) is not guaranteed to write `href`
# first the way our own `md.md_to_html` always does. Matching only the
# `<a href="...">` shape a candidate always has, and falling through silently
# on anything else, made the two sides of a compare drift APART instead of
# together: a candidate anchor normalizes to its `[[eid]]` marker while a
# same-content server anchor with `rel`/`target` before `href` (or a
# single-quoted href) falls through unnormalized to its literal text — two
# representations of identical content that no longer read equal, a
# regression from the plain full-tag-strip compare this replaced.
_ANCHOR = re.compile(
    r'<a\b[^>]*?\bhref\s*=\s*(?P<q>["\'])(?P<href>.*?)(?P=q)[^>]*>.*?</a>',
    re.S | re.I)


def normalize_element_links_for_compare(html: str, url_fmt: str = URL_FMT) -> str:
    """Reduce an mobRPG element-link anchor to a marker keyed on the linked
    element's id, dropping its display TEXT. `sync`'s content compare
    (`_matches_server`) works on plain text, so an aliased wikilink
    (`[[Target|alias]]` -> `<a href=...>alias</a>` on push) reads as a content
    difference against ANY copy whose anchor text isn't that exact alias —
    including the server's own accepted copy of this note's own push (#190),
    and a copy this tool itself degraded through an earlier alias-dropping
    pull, before this fix. The link's TARGET still has to agree — a link
    retargeted to a different element is a real edit — only the display text
    is insensitive. Anchors that aren't mobRPG element links (external URLs,
    left untouched by the push rewrite) are not touched, since their text can
    carry real meaning."""
    eid_re = _element_url_re(url_fmt)

    def _sub(m: re.Match) -> str:
        # A trailing slash is not a different target — tolerate one so a
        # server-normalized URL (many web frameworks append `/`) still
        # resolves to the same eid.
        um = eid_re.fullmatch(m.group("href").rstrip("/"))
        return f"[[{um.group('eid')}]]" if um else m.group(0)

    return _ANCHOR.sub(_sub, html or "")


def rewrite_md_for_pull(md_text: str, path_by_element_id: dict) -> str:
    """Element URLs (matched against `URL_FMT`) whose id maps to a known vault
    note -> `[[Name]]`; every other link is left untouched."""
    def _ml(m: re.Match) -> str:
        href = m.group(2)
        um = _ELEMENT_URL.fullmatch(href)
        if um:
            name = path_by_element_id.get(um.group("eid"))
            if name:
                return f"[[{name}]]"
        return m.group(0)

    return _MDLINK.sub(_ml, md_text or "")
