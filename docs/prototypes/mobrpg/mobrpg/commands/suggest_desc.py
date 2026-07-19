"""mobrpg suggest-desc — suggest a linked note's authored description UP to mobRPG.

Where a synced vault note carries authored canon-section prose that the mobRPG
element is missing (an empty stub) or poorer on, the right move is to propose
that prose *up* — not to pull the empty stub down. This does it as a reviewable
suggestion the world owner accepts, never a direct element PUT. See CLI-GAPS.md G5.

Discovered API shape (mobRPG Spring backend, models/world/suggestion/):
    operation "UpdateElement", payload UpdateElementPayload — a SPARSE edit:
        { operation, targetRef, description?, name?, altNames? }
    A present field replaces; null leaves it alone. `targetRef` must be a REAL
    element id (SuggestionService rejects a suggestion: ref — "UpdateElement must
    target a real element"). The typed `data` block is deliberately NOT accepted.
    Submitted through the same SubmitSuggestionsRequest transport as suggest /
    submit-batch, so the dry-run summary, --execute, and the prod-write guard
    (client.assert_writes_allowed) come for free.

Idempotency/safety: each edit carries a DISTINCT externalRef `<ns>:desc/<relpath>`,
never the element's own create externalRef `<ns>:<relpath>`. The backend dedupes
an active suggestion by externalRef, so a re-run collapses onto its own still-
pending desc suggestion instead of both minting a duplicate and being swallowed
by the element's create.
"""
from __future__ import annotations

import argparse
import difflib
import sys

from mobrpg import client
from mobrpg import md as _md
from mobrpg import section
from mobrpg.commands import pull_desc
from mobrpg.commands import submit_batch

DEFAULT_THRESHOLD = 0.98

_EMPTY_HTML = {"", "<p></p>", "<p/>", "<br>", "<br/>", "<p><br></p>", "<p><br/></p>"}


def _is_empty_html(html: str | None) -> bool:
    """True when mobRPG's stored description carries no real prose — the empty
    stub G5 exists to fill (bare '', an empty paragraph, or a lone break)."""
    return (html or "").strip() in _EMPTY_HTML


def vault_html(body: str) -> str:
    """The note's canon-section prose, converted to the HTML mobRPG stores.
    The GM-only tail (## GM Notes/Notes/...) is never included — it is not canon."""
    region = section.canon_section(body)[0]
    return _md.md_to_html(region)


def similarity(a: str | None, b: str | None) -> float:
    """difflib ratio with autojunk DISABLED. The default heuristic treats any
    character filling >1% of a string of length >=200 as junk and drops it from
    matching, which collapses the ratio toward zero on long, near-identical prose
    — a false 'they differ'. autojunk=False keeps the comparison honest."""
    return difflib.SequenceMatcher(None, a or "", b or "", autojunk=False).ratio()


def classify_candidate(cand_html: str | None, live_html: str | None,
                       threshold: float = DEFAULT_THRESHOLD) -> tuple[bool, str]:
    """(is_candidate, reason). Pure. reason ∈ {no-prose, empty, differs, in-sync}.

    - no-prose: nothing authored in the vault to suggest up (skip).
    - empty:    mobRPG element is a stub — suggest the authored prose (the G5 case).
    - in-sync:  live description is >= threshold similar to the vault prose (skip).
    - differs:  vault prose meaningfully differs from / is richer than live.
    """
    if _is_empty_html(cand_html):
        return False, "no-prose"
    if _is_empty_html(live_html):
        return True, "empty"
    if similarity(cand_html, live_html) >= threshold:
        return False, "in-sync"
    return True, "differs"


def desc_external_ref(nd: dict) -> str | None:
    """A distinct `<ns>:desc/<relpath>` externalRef for the description edit,
    derived from the note's own `<ns>:<relpath>` element external_ref."""
    ext = nd.get("external_ref") or ""
    if ":" not in ext:
        return None
    ns, rel = ext.split(":", 1)
    return f"{ns}:desc/{rel}"


def build_suggestion(nd: dict, cand_html: str, ref: str = "e0") -> dict:
    """One UpdateElement suggestion item (SubmitSuggestionRequest shape). The
    payload is sparse — description only; name/altNames/data are left untouched."""
    item = {"ref": ref, "operation": "UpdateElement",
            "payload": {"operation": "UpdateElement",
                        "targetRef": nd["element_id"],
                        "description": cand_html},
            "dependsOn": []}
    xref = desc_external_ref(nd)
    if xref:
        item["externalRef"] = xref
    return item


def build_request(candidates: list[tuple[dict, str]], label: str) -> dict:
    """Assemble a SubmitSuggestionsRequest from (node, cand_html) candidates."""
    suggestions = [build_suggestion(nd, html, ref=f"e{i}")
                   for i, (nd, html) in enumerate(candidates)]
    return {"batchLabel": label, "suggestions": suggestions}


# ---------------- I/O ----------------

def _plan(world: str, vault: str, token: str, *, only: str | None, threshold: float
          ) -> tuple[list[tuple[dict, str]], list[tuple[str, str, str]]]:
    """Fetch each synced note's live description and classify it.
    Returns (candidates, rows). candidates = [(node, cand_html)];
    rows = [(ref, reason, status)] for reporting. Raises LookupError on a bad --only."""
    notes = list(pull_desc._iter_notes(vault))
    if only:
        found, detail = pull_desc._find_note(notes, only)
        if found is None:
            raise LookupError(detail)
        notes = [detail]

    candidates: list[tuple[dict, str]] = []
    rows: list[tuple[str, str, str]] = []
    for path, txt, nd in notes:
        body = pull_desc._body_of(txt)
        cand = vault_html(body)
        live_html, status = pull_desc._fetch_description(world, nd, token)
        ref = nd.get("external_ref") or path
        if status != "ok":
            rows.append((ref, status, status))     # deleted / unknown → skip
            continue
        is_cand, reason = classify_candidate(cand, live_html, threshold)
        rows.append((ref, reason, "ok"))
        if is_cand:
            candidates.append((nd, cand))
    return candidates, rows


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg suggest-desc",
        description="Suggest linked notes' authored descriptions UP to mobRPG as "
                    "reviewable UpdateElement suggestions (never a direct PUT). "
                    "Dry-run by default.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--only", help="external_ref (or path suffix) of a single note to target")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help="skip a note whose live description is >= this similar to the "
                         f"vault prose (default {DEFAULT_THRESHOLD}); empty stubs are "
                         "always suggested regardless of threshold")
    ap.add_argument("--batch-label", default="", help="override the suggestion batch label")
    ap.add_argument("--execute", action="store_true", help="actually submit (default: dry-run)")
    args = ap.parse_args(argv)

    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    try:
        candidates, rows = _plan(args.world, args.vault, token,
                                 only=args.only, threshold=args.threshold)
    except LookupError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    for ref, reason, _status in rows:
        mark = "→ suggest" if reason in ("empty", "differs") else "  skip"
        print(f"{mark:10} {reason:9} {ref}")
    print(f"\nsuggest-desc: {len(candidates)} candidate(s) of {len(rows)} synced note(s)")

    if not candidates:
        return 0

    label = args.batch_label or f"Suggest descriptions ({len(candidates)})"
    request = build_request(candidates, label)
    try:
        submit_batch.submit(args.world, request, execute=args.execute)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0
