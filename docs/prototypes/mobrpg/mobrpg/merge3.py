"""Line-oriented three-way merge (diff3-lite) for description prose.

`merge3(base, ours, theirs)` reconciles two edits of a common ancestor:

  - a region changed on only one side takes that side (auto-merge),
  - a region changed identically on both sides takes it once,
  - a region changed differently on both sides is a conflict, emitted with
    git-style `<<<<<<< vault / ======= / >>>>>>> mobRPG` markers.

Returns `(merged_text, had_conflict)`. Line-based on `str.splitlines()`; joins
with "\n" (boundary spacing is the caller's concern). Stdlib `difflib` only.

The sync-region algorithm is the classic Merge3: align on runs of lines present
unchanged in all three, then resolve each differing span between syncs.
"""
from __future__ import annotations

from difflib import SequenceMatcher

_VAULT = "<<<<<<< vault"
_MID = "======="
_CANON = ">>>>>>> mobRPG"


def _sync_regions(base, ours, theirs):
    """Yield (b0, b1, o0, o1, t0, t1) spans matched identically in all three,
    in order, terminated by a zero-length span at the ends."""
    a_blocks = SequenceMatcher(None, base, ours, autojunk=False).get_matching_blocks()
    b_blocks = SequenceMatcher(None, base, theirs, autojunk=False).get_matching_blocks()
    ia = ib = 0
    while ia < len(a_blocks) and ib < len(b_blocks):
        abase, amatch, alen = a_blocks[ia]
        bbase, bmatch, blen = b_blocks[ib]
        start = max(abase, bbase)
        end = min(abase + alen, bbase + blen)
        if start < end:
            yield (start, end,
                   amatch + (start - abase), amatch + (end - abase),
                   bmatch + (start - bbase), bmatch + (end - bbase))
        if abase + alen < bbase + blen:
            ia += 1
        else:
            ib += 1
    yield (len(base), len(base), len(ours), len(ours), len(theirs), len(theirs))


def _resolve(base_span, our_span, their_span):
    """Return (lines, is_conflict) for a differing span between two syncs."""
    if our_span == their_span:
        return our_span, False           # same edit (or both untouched)
    if our_span == base_span:
        return their_span, False          # only canon changed
    if their_span == base_span:
        return our_span, False            # only vault changed
    return ([_VAULT] + our_span + [_MID] + their_span + [_CANON], True)


def merge3(base_text: str, ours_text: str, theirs_text: str):
    base = base_text.splitlines()
    ours = ours_text.splitlines()
    theirs = theirs_text.splitlines()

    out: list[str] = []
    conflict = False
    bz = oz = tz = 0
    for b0, b1, o0, o1, t0, t1 in _sync_regions(base, ours, theirs):
        if bz < b0 or oz < o0 or tz < t0:
            lines, is_conflict = _resolve(base[bz:b0], ours[oz:o0], theirs[tz:t0])
            out.extend(lines)
            conflict = conflict or is_conflict
        if b0 < b1:
            out.extend(base[b0:b1])       # unchanged in all three
        bz, oz, tz = b1, o1, t1

    return "\n".join(out), conflict
