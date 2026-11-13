"""mobrpg withdraw — take back Pending suggestions we filed.

The undo for `suggest` / `sync`: when a batch goes out wider than meant, this
deletes the leftover Pending suggestions and re-stamps the vault notes that
`--write-back` marked `pending`, so `sync` and `suggest` skip them and
`pull-canon` stops waiting on a suggestion that no longer exists.

    DELETE /world/{worldId}/suggestion/{id}     (needs ReadWriteDelete)

Selection (one is required; they combine as AND):
    --batch ID   suggestions filed in that batch
    --id ID...   exact suggestion ids
    --only S     substring of the suggestion's name or externalRef (the same
                 substring idea as `suggest --only`)

Only Pending suggestions are ever deleted; a suggestion already accepted or
dismissed is reported and left alone. Relations go before the creates they
depend on. Afterwards the queue is read back and what is left is reported;
the DELETE response alone is never trusted, and a vault note is re-stamped
only once its suggestion is confirmed gone.

Dry-run by default; --execute to delete.

    mobrpg withdraw <worldId> --batch <batchId> --vault <vault>            # dry-run
    mobrpg withdraw <worldId> --only "Walk-on" --vault <vault> --execute
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import suggest

STATES = ("Pending", "Accepted", "Dismissed")


def _list(world: str, state: str, token: str) -> list[dict]:
    resp = client._request("GET", f"/world/{world}/suggestion?reviewState={state}", token=token)
    if isinstance(resp, dict):
        resp = resp.get("content", [])
    return resp if isinstance(resp, list) else []


def _name(s: dict) -> str:
    return (s.get("payload") or {}).get("name") or ""


def _matches(s: dict, args) -> bool:
    if args.batch and s.get("batchId") != args.batch:
        return False
    if args.id and s.get("id") not in args.id:
        return False
    if args.only and args.only not in _name(s) and args.only not in (s.get("externalRef") or ""):
        return False
    return True


def delete_order(rows: list[dict]) -> list[dict]:
    """Relations first, then entity creates, then the rest (classifier mints and
    reified events) — an AddRelation depends on the creates it points at."""
    def rank(s):
        if s.get("operation") == "AddRelation":
            return 0
        return 1 if s.get("externalRef") else 2
    return sorted(rows, key=rank)  # stable: filing order within a rank


def _line(s: dict) -> str:
    return (f"  {(_name(s) or s.get('externalRef') or '')[:34]:34} "
            f"{(s.get('operation') or ''):14} id={s.get('id')}")


def _vault_path(ref: str, vault: str) -> str:
    rel = node.note_ref(ref).split(":", 1)[1]
    return os.path.join(os.path.expanduser(vault), rel + ".md")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg withdraw",
        description="Withdraw Pending suggestions we filed: delete them (relations "
                    "first), re-stamp their vault notes dismissed, read the queue back. "
                    "Dry-run by default.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--batch", default="", help="withdraw the suggestions filed in this batch id")
    ap.add_argument("--id", nargs="+", action="extend", default=[], metavar="ID",
                    help="withdraw these suggestion ids")
    ap.add_argument("--only", default="",
                    help="substring match on the suggestion's name or externalRef")
    ap.add_argument("--vault", default=os.environ.get("MOBRPG_VAULT"),
                    help="vault root, to re-stamp the matching notes (default: $MOBRPG_VAULT)")
    ap.add_argument("--execute", action="store_true", help="actually delete (default: dry-run)")
    args = ap.parse_args(argv)

    if not (args.batch or args.id or args.only):
        print("ERROR: say what to withdraw: --batch ID, --id ID... or --only S", file=sys.stderr)
        return 2

    try:
        token = client.get_access_token()
        by_state = {st: [s for s in _list(args.world, st, token) if _matches(s, args)]
                    for st in STATES}
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("  (listing and deleting suggestions needs ReadWriteDelete on the world)",
              file=sys.stderr)
        return 1

    pending = delete_order(by_state["Pending"])
    for st in ("Accepted", "Dismissed"):
        if by_state[st]:
            print(f"Not withdrawn: {len(by_state[st])} {st} (only Pending suggestions are deleted):")
            for s in by_state[st]:
                print(_line(s))
    print(f"Pending suggestions matched: {len(pending)}")
    for s in pending:
        print(_line(s))
    if not pending:
        return 0
    if not args.vault:
        print("  note: no --vault (or $MOBRPG_VAULT): vault notes will not be re-stamped",
              file=sys.stderr)
    if not args.execute:
        print("DRY-RUN: nothing deleted (add --execute to withdraw these)")
        return 0

    target_ids = {s["id"] for s in pending}
    failed = 0
    for s in pending:
        try:
            client._request("DELETE", f"/world/{args.world}/suggestion/{s['id']}", token=token)
        except client.ApiError as e:
            failed += 1
            print(f"  ERROR deleting {s['id']}: {e}", file=sys.stderr)

    # Read the queue back: the DELETE responses are not evidence.
    try:
        left_now = _list(args.world, "Pending", token)
    except client.ApiError as e:
        print(f"ERROR reading the queue back: {e}", file=sys.stderr)
        return 1
    still = [s for s in left_now if s.get("id") in target_ids]
    gone = [s for s in pending if s["id"] not in {x.get("id") for x in still}]

    stamped = 0
    if args.vault:
        today = _dt.date.today().isoformat()
        note = f"withdrawn {today}: suggestion deleted from the mobRPG queue"
        refs: dict[str, set] = {}
        for s in gone:
            ref = s.get("externalRef") or ""
            if ":" in ref:
                refs.setdefault(_vault_path(ref, args.vault), set()).add(ref)
        for path, rs in refs.items():
            if suggest.restamp_node(path, review_state="dismissed", review_note=note,
                                    match_refs=rs):
                stamped += 1

    print(f"Withdrawn (confirmed gone on read-back): {len(gone)} of {len(pending)}")
    print(f"Vault notes re-stamped dismissed: {stamped}")
    if still:
        print(f"STILL PENDING after delete: {len(still)}", file=sys.stderr)
        for s in still:
            print(_line(s), file=sys.stderr)
    print(f"Pending queue now holds {len(left_now)} suggestion(s)"
          f", of which {len(still)} we tried to withdraw")
    return 1 if still or failed else 0
