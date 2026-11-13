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
import json
import os
import shlex
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import map_cmd
from mobrpg.commands import suggest

STATES = ("Pending", "Accepted", "Dismissed")


class QueueReadError(Exception):
    pass


def _list(world: str, state: str, token: str) -> list[dict]:
    """Every row of one review state, following `totalPages` (as pull.py does).
    Fails loudly on a short or inconsistent read: withdraw acts on this list and
    trusts the read-back, so a silently truncated page would be a wrong answer."""
    out: list[dict] = []
    page = 0
    while True:
        r = client._request("GET", f"/world/{world}/suggestion", token=token,
                            query={"reviewState": state, "page": page, "size": 200})
        if isinstance(r, list):
            return [x for x in r if isinstance(x, dict)]
        if not isinstance(r, dict) or not isinstance(r.get("content"), list):
            raise QueueReadError(f"unreadable {state} queue page {page}")
        out.extend(x for x in r["content"] if isinstance(x, dict))
        info = r.get("page") or {}
        total = info.get("totalPages", 1)
        if page >= total - 1:
            want = info.get("totalElements")
            if want is not None and want != len(out):
                raise QueueReadError(
                    f"{state} queue read {len(out)} of {want} suggestions")
            return out
        page += 1


def _read_all(world: str, token: str) -> dict[str, list[dict]]:
    return {st: _list(world, st, token) for st in STATES}


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


def _bare(ref) -> str:
    ref = ref or ""
    return ref[len("suggestion:"):] if ref.startswith("suggestion:") else ref


def _links_to(rel: dict, creates: list[dict]) -> bool:
    """An AddRelation points at one of `creates` by sourceRef/targetRef (bare or
    `suggestion:<ref>`) or lists it in dependsOn. An externalRef or id is unique
    to the world; a local `ref` (e1, e2 ...) is only unique inside its batch, so
    it matches only a relation from the same batch."""
    p = rel.get("payload") or {}
    ends = {_bare(p.get("sourceRef")), _bare(p.get("targetRef"))}
    ends |= {_bare(d) for d in (rel.get("dependsOn") or p.get("dependsOn") or [])}
    ends.discard("")
    for c in creates:
        if ends & {k for k in (c.get("externalRef"), c.get("id")) if k}:
            return True
        if c.get("ref") and c["ref"] in ends and c.get("batchId") == rel.get("batchId"):
            return True
    return False


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


def _links_to_any(rels: list[dict], create: dict) -> bool:
    return any(_links_to(r, [create]) for r in rels)


def _restamp(vault: str, refs: list[str], prefix: str) -> tuple[int, list[tuple[str, str]]]:
    """Re-stamp the notes behind `refs`. Returns (stamped count, [(path, ref)] that
    failed to read or write)."""
    note = f"withdrawn {_dt.date.today().isoformat()}: suggestion deleted from the mobRPG queue"
    by_path: dict[str, set] = {}
    for ref in refs:
        if ref.startswith(prefix):
            by_path.setdefault(_vault_path(ref, vault), set()).add(ref)
    stamped = 0
    failed: list[tuple[str, str]] = []
    for path, rs in by_path.items():
        res = suggest.restamp_node(path, review_state="dismissed", review_note=note,
                                   match_refs=rs)
        if res == "stamped":
            stamped += 1
        elif res == "failed":
            failed += [(path, r) for r in sorted(rs)]
    return stamped, failed


def _report_restamp_failures(args, ns: str, failed: list[tuple[str, str]]) -> None:
    if not failed:
        return
    print(f"RESTAMP FAILED for {len(failed)} note(s); the suggestions are already deleted:",
          file=sys.stderr)
    for path, ref in failed:
        print(f"  {path}  ({ref})", file=sys.stderr)
    cmd = ["mobrpg", "withdraw", args.world, "--restamp-only", "--namespace", ns,
           "--vault", args.vault, "--ref", *[r for _, r in failed]]
    if args.map:
        cmd[cmd.index("--vault"):cmd.index("--vault")] = ["--map", args.map]
    print("  retry: " + " ".join(shlex.quote(c) for c in cmd), file=sys.stderr)


def _restamp_only(args) -> int:
    if not args.vault or not args.ref:
        print("ERROR: --restamp-only needs --vault (or $MOBRPG_VAULT) and --ref EXTERNALREF...",
              file=sys.stderr)
        return 2
    ns = _namespace(args)
    prefix = ns + ":"
    foreign = [r for r in args.ref if not r.startswith(prefix)]
    if foreign:
        print(f"ERROR: not in our namespace '{ns}': {', '.join(foreign)}", file=sys.stderr)
        return 2
    try:
        token = client.get_access_token()
        queue = _read_all(args.world, token)
    except (client.ApiError, QueueReadError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    live = {s.get("externalRef"): st for st in STATES for s in queue[st] if s.get("externalRef")}
    present = [r for r in args.ref if r in live]
    for r in present:
        print(f"  NOT re-stamped: {r} still exists in the queue ({live[r]})", file=sys.stderr)
    todo = [r for r in args.ref if r not in live]
    if not args.execute:
        print(f"DRY-RUN: would re-stamp the notes for {len(todo)} suggestion(s) already gone "
              "(add --execute)")
        return 1 if present else 0
    stamped, failed = _restamp(args.vault, todo, prefix)
    print(f"Vault notes re-stamped dismissed: {stamped}")
    _report_restamp_failures(args, ns, failed)
    return 1 if failed or present else 0


def _namespace(args) -> str | None:
    """Our externalRef namespace, taken the way `suggest` takes it: from the
    vault's map (or derived from the vault), or given outright by --namespace."""
    if args.namespace:
        return args.namespace
    if not args.vault:
        return None
    map_path = args.map or suggest._default_map_path(args.vault)
    try:
        with open(map_path, encoding="utf-8") as fh:
            mp = json.load(fh)
    except (OSError, json.JSONDecodeError):
        mp = {}
    return map_cmd.namespace_for(args.vault, mp)


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg withdraw",
        description="Withdraw Pending suggestions we filed: delete them (relations "
                    "first), re-stamp their vault notes dismissed, read the queue back. "
                    "Only suggestions in our own namespace are ever touched. "
                    "Dry-run by default.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--batch", default="", help="withdraw the suggestions filed in this batch id")
    ap.add_argument("--id", nargs="+", action="extend", default=[], metavar="ID",
                    help="withdraw these suggestion ids")
    ap.add_argument("--only", default="",
                    help="substring match on name or externalRef; dry-run only (it prints "
                         "the --id line to execute)")
    ap.add_argument("--vault", default=os.environ.get("MOBRPG_VAULT"),
                    help="vault root: gives our namespace and the notes to re-stamp "
                         "(default: $MOBRPG_VAULT)")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
    ap.add_argument("--namespace", default="",
                    help="our externalRef namespace, when there is no --vault")
    ap.add_argument("--restamp-only", action="store_true",
                    help="delete nothing: re-stamp the notes for suggestions already gone "
                         "(give their externalRefs with --ref; the retry after a failed re-stamp)")
    ap.add_argument("--ref", nargs="+", action="extend", default=[], metavar="EXTERNALREF",
                    help="with --restamp-only: externalRefs whose notes to re-stamp")
    ap.add_argument("--no-restamp", action="store_true",
                    help="delete without re-stamping vault notes (needed when there is no vault)")
    ap.add_argument("--execute", action="store_true", help="actually delete (default: dry-run)")
    args = ap.parse_args(argv)

    if args.restamp_only:
        return _restamp_only(args)
    if not (args.batch or args.id or args.only):
        print("ERROR: say what to withdraw: --batch ID, --id ID... or --only S", file=sys.stderr)
        return 2
    if args.only and args.execute:
        print("ERROR: --only cannot be combined with --execute; dry-run it, then run the "
              "--id line it prints.", file=sys.stderr)
        return 2
    if args.execute and not args.vault and not args.no_restamp:
        print("ERROR: withdraw --execute needs --vault (or $MOBRPG_VAULT) to re-stamp the "
              "notes; pass --no-restamp to delete without re-stamping vault notes.",
              file=sys.stderr)
        return 2
    ns = _namespace(args)
    if not ns:
        print("ERROR: withdraw only touches our own suggestions; give --vault (or "
              "$MOBRPG_VAULT) or --namespace so it knows which are ours.", file=sys.stderr)
        return 2
    prefix = ns + ":"

    try:
        token = client.get_access_token()
        queue = _read_all(args.world, token)
    except (client.ApiError, QueueReadError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("  (listing and deleting suggestions needs ReadWriteDelete on the world)",
              file=sys.stderr)
        return 1

    # Ours: a selected non-relation row in our namespace. A relation is ours when
    # it points at one of those creates; it is pulled in even if the selector
    # (e.g. --only on a name) would not have matched it.
    selected = [(st, s) for st in STATES for s in queue[st] if _matches(s, args)]
    mine = [(st, s) for st, s in selected
            if s.get("operation") != "AddRelation"
            and (s.get("externalRef") or "").startswith(prefix)]
    my_creates = [s for st, s in mine if st == "Pending"]
    # --batch alone: the batch's own classifier mints (creates with no externalRef)
    # go too, but only when every externalRef in the batch is ours.
    mints: list[dict] = []
    whole_batch = bool(args.batch) and not args.id and not args.only
    if whole_batch:
        in_batch = [s for st in STATES for s in queue[st] if s.get("batchId") == args.batch]
        alien = [s for s in in_batch if s.get("externalRef")
                 and not s["externalRef"].startswith(prefix)]
        if alien:
            print(f"ERROR: batch {args.batch} holds {len(alien)} suggestion(s) outside "
                  f"namespace '{ns}'; refusing the whole batch.", file=sys.stderr)
            for s in alien:
                print(_line(s), file=sys.stderr)
            return 2
        mints = [s for s in queue["Pending"] if s.get("batchId") == args.batch
                 and s.get("operation") == "CreateElement" and not s.get("externalRef")]
        my_creates = my_creates + mints
    rels = [s for s in queue["Pending"]
            if s.get("operation") == "AddRelation" and _links_to(s, my_creates)]
    taken = {s["id"] for _, s in mine} | {s["id"] for s in mints} | {s["id"] for s in rels}
    foreign = [s for _, s in selected if s["id"] not in taken]

    if foreign:
        print(f"Not ours, left alone: {len(foreign)} (externalRef not in namespace '{ns}')")
        for s in foreign:
            print(_line(s))
    for st in ("Accepted", "Dismissed"):
        done = [s for t, s in mine if t == st]
        if done:
            print(f"Not withdrawn: {len(done)} {st} (only Pending suggestions are deleted):")
            for s in done:
                print(_line(s))
    pending = delete_order([s for t, s in mine if t == "Pending"] + rels + mints)
    mint_ids = {s["id"] for s in mints}
    print(f"Pending suggestions to withdraw: {len(pending) - len(mints)} "
          f"({len(rels)} linked relation(s) included)")
    for s in pending:
        if s["id"] not in mint_ids:
            print(_line(s))
    if mints:
        print(f"Classifier types minted in this batch (deleted last): {len(mints)}")
        for s in mints:
            print(_line(s))
    if not pending:
        return 0
    no_restamp = args.no_restamp or not args.vault
    if no_restamp:
        print("  note: no vault notes would be re-stamped", file=sys.stderr)
    if not args.execute:
        print("DRY-RUN: nothing deleted. To withdraw exactly these, run:")
        sel = (["--batch", args.batch] if whole_batch
               else ["--id", *[x["id"] for x in pending]])
        cmd = ["mobrpg", "withdraw", args.world, *sel, "--namespace", ns]
        if args.map:
            cmd += ["--map", args.map]
        cmd += ["--vault", args.vault] if (args.vault and not args.no_restamp) else ["--no-restamp"]
        print("  " + " ".join(shlex.quote(c) for c in cmd + ["--execute"]))
        return 0

    deleted_ok: set = set()
    failed = 0
    failed_rels: list[dict] = []
    for s in pending:
        if s.get("operation") != "AddRelation" and _links_to_any(failed_rels, s):
            failed += 1
            print(f"  SKIPPED {s['id']}: a relation to it could not be deleted", file=sys.stderr)
            continue
        try:
            client._request("DELETE", f"/world/{args.world}/suggestion/{s['id']}", token=token)
            deleted_ok.add(s["id"])
        except client.ApiError as e:
            failed += 1
            if s.get("operation") == "AddRelation":
                failed_rels.append(s)
            print(f"  ERROR deleting {s['id']}: {e}", file=sys.stderr)

    # Read every state back: the DELETE responses are not evidence, and a
    # suggestion adjudicated meanwhile is not ours to call "withdrawn".
    try:
        after = _read_all(args.world, token)
    except (client.ApiError, QueueReadError) as e:
        print(f"ERROR reading the queue back: {e}", file=sys.stderr)
        return 1
    where = {x.get("id"): st for st in STATES for x in after[st]}
    gone = [s for s in pending if s["id"] in deleted_ok and s["id"] not in where]
    turned = [(s, where[s["id"]]) for s in pending
              if where.get(s["id"]) in ("Accepted", "Dismissed")]
    still = [s for s in pending if where.get(s["id"]) == "Pending"]

    stamped = 0
    restamp_failed: list[tuple[str, str]] = []
    if not no_restamp:
        refs = [s["externalRef"] for s in gone if (s.get("externalRef") or "").startswith(prefix)]
        stamped, restamp_failed = _restamp(args.vault, refs, prefix)

    print(f"Withdrawn (delete succeeded and gone from every state): {len(gone)} of {len(pending)}")
    print(f"Vault notes re-stamped dismissed: {stamped}")
    _report_restamp_failures(args, ns, restamp_failed)
    for s, st in turned:
        print(f"  NOT withdrawn: {s['id']} became {st} meanwhile (note not stamped)",
              file=sys.stderr)
    if still:
        print(f"STILL PENDING after delete: {len(still)}", file=sys.stderr)
        for s in still:
            print(_line(s), file=sys.stderr)
    print(f"Pending queue now holds {len(after['Pending'])} suggestion(s)"
          f", of which {len(still)} we tried to withdraw")
    return 1 if still or failed or turned or restamp_failed else 0
