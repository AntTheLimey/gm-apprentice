"""mobrpg suggestions — read the review queue back from mobRPG.

The return leg of the suggestion round-trip. `mobrpg suggest` (push_suggestions.py)
submits vault entities as suggestions; this reads them back by review state and,
with --correlate, joins each one to its originating vault file via the externalRef
convention (`<namespace>:<vault-relative path without .md>`) and reports the
mobRPG element id that an Accepted suggestion produced (resultElementId).

Needs ReadWriteDelete on the world (the list/get suggestion endpoints are
reviewer-gated server-side) — a plain Read token gets 400/403 here.

    GET /world/{worldId}/suggestion?reviewState={Pending|Accepted|Dismissed}

Read-only. Examples:
    mobrpg suggestions <worldId>                       # Pending (default)
    mobrpg suggestions <worldId> --state Accepted
    mobrpg suggestions <worldId> --state Accepted --correlate --vault ~/Documents/CTHULHU/Canticle
    mobrpg suggestions <worldId> --state Accepted --correlate --fetch-elements --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from mobrpg import client

STATES = ("Pending", "Accepted", "Dismissed")
# mobRPG element discriminator -> the /world/{id}/{kind} sub-resource used to GET it.
TYPE_EP = {
    "Person": "person", "Political": "political", "PoliticalType": "political/type",
    "Organization": "organization", "OrganizationType": "organization/type",
    "Item": "item", "Creature": "creature", "CreatureType": "creature/type",
    "LandFeature": "landfeature", "Race": "person/race", "Profession": "person/profession",
}


def _resolve_vault_file(external_ref: str, vault: str | None) -> str | None:
    """`<ns>:<relpath>` -> <vault>/<relpath>.md, flagged (MISSING) if absent.
    Returns None when there is no externalRef or no --vault to resolve against."""
    if not external_ref or ":" not in external_ref or not vault:
        return None
    _, rel = external_ref.split(":", 1)
    p = os.path.join(os.path.expanduser(vault), rel + ".md")
    return p if os.path.exists(p) else f"(MISSING) {p}"


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg suggestions",
        description="List mobRPG suggestions by review state; optionally correlate "
                    "them back to vault files and the elements they produced.",
    )
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--state", choices=STATES, default="Pending",
                    help="review state to list (default: Pending)")
    ap.add_argument("--correlate", action="store_true",
                    help="join each suggestion to its vault file (externalRef) and "
                         "show the resultElementId it produced")
    ap.add_argument("--vault", default=os.environ.get("MOBRPG_VAULT"),
                    help="vault root for --correlate (default: $MOBRPG_VAULT)")
    ap.add_argument("--fetch-elements", action="store_true",
                    help="with --correlate: GET each resultElementId to confirm it "
                         "exists and capture its live fields")
    ap.add_argument("--json", action="store_true", help="print the full report as JSON")
    ap.add_argument("--out", default="", help="also write the JSON report to this dir")
    args = ap.parse_args(argv)

    try:
        token = client.get_access_token()
        suggestions = client._request(
            "GET", f"/world/{args.world}/suggestion?reviewState={args.state}", token=token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("  (listing suggestions needs ReadWriteDelete on the world)", file=sys.stderr)
        return 1

    if not isinstance(suggestions, list):
        suggestions = suggestions.get("content", []) if isinstance(suggestions, dict) else []

    report = []
    for s in suggestions:
        pl = s.get("payload") or {}
        etype = (pl.get("data") or {}).get("type") or s.get("typeName") or ""
        rid = s.get("resultElementId") or ""
        row = {
            "id": s.get("id"), "operation": s.get("operation"),
            "reviewState": s.get("reviewState"), "name": pl.get("name"),
            "type": etype, "externalRef": s.get("externalRef"),
            "resultElementId": rid, "batchId": s.get("batchId"),
        }
        if args.correlate:
            row["vaultFile"] = _resolve_vault_file(s.get("externalRef") or "", args.vault)
            if args.fetch_elements and rid and etype in TYPE_EP:
                try:
                    row["element"] = client._request(
                        "GET", f"/world/{args.world}/{TYPE_EP[etype]}/{rid}", token=token)
                    row["elementExists"] = True
                except client.ApiError as e:
                    row["elementExists"] = False
                    row["element"] = {"error": str(e)}
        report.append(row)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"{args.state} suggestions: {len(report)}")
        for r in report:
            line = f"  {(r['name'] or '')[:26]:26} {r['type']:13} {(r['operation'] or ''):14} id={r['id']}"
            if args.correlate:
                vf = r.get("vaultFile") or "-"
                line += f"\n      externalRef={r['externalRef']}  resultElementId={r['resultElementId'] or '-'}"
                line += f"\n      vault: {vf}"
                if "elementExists" in r:
                    line += f"  elementExists={r['elementExists']}"
            print(line)

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        p = os.path.join(args.out, f"suggestions-{args.state.lower()}.json")
        with open(p, "w") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False)
        print(f"-> {p}")
    return 0
