#!/usr/bin/env python3
"""The money limits for drawing pictures, as the vault's settings give them.

Every value comes from `vaultlib.settings(vault)`; the defaults live in the
settings registry and nowhere else. Money is US cents, as a number.
"""

import math
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any, NamedTuple

import vaultlib


class Limits(NamedTuple):
    auto: bool
    attempt: float
    redraws: int
    run: float
    month: float
    unpriced: bool
    thinking: bool
    kinds: tuple[str, ...]
    service: str | None
    model: str | None
    price: float | None
    guidance: str


_NAMES = tuple(f"vault.images.{n}" for n in (
    "auto", "attempt_limit", "redraws", "run_cap", "month_cap", "unpriced",
    "thinking", "kinds", "service", "model", "price", "guidance"))


def limits(vault: Path) -> Limits:
    """The picture-drawing settings of `vault`."""
    v = vaultlib.settings(vault).values
    if not all(name in v for name in _NAMES):
        raise vaultlib.SettingsUnavailable(
            "This vault's picture settings could not be read: the publish "
            "tool in use is older than this command. Run gma update.")
    return Limits(
        auto=bool(v["vault.images.auto"]),
        attempt=v["vault.images.attempt_limit"],
        redraws=int(v["vault.images.redraws"]),
        run=v["vault.images.run_cap"],
        month=v["vault.images.month_cap"],
        unpriced=bool(v["vault.images.unpriced"]),
        thinking=bool(v["vault.images.thinking"]),
        kinds=tuple(v["vault.images.kinds"]),
        service=v["vault.images.service"],
        model=v["vault.images.model"],
        price=v["vault.images.price"],
        guidance=v["vault.images.guidance"],
    )


STATE_KEY = "images"
PLACES = 4  # sums of cents are rounded here, so float error never decides a fit


def _cents(x: float) -> float:
    return round(x, PLACES)


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _previous_key(d: date) -> str:
    return _month_key(date(d.year - 1, 12, 1) if d.month == 1
                      else date(d.year, d.month - 1, 1))


def _bad(what: str) -> vaultlib.StateUnreadable:
    return vaultlib.StateUnreadable(
        f"{vaultlib.STATE_FILE}: the {STATE_KEY} entry is damaged ({what}); "
        "fix or remove it by hand")


def _number(value: Any, what: str) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0):
        raise _bad(f"{what} is not a number of zero or more")
    return float(value)


def _images(vault: Path) -> dict[str, Any]:
    """The `images` entry of the state file, checked ({} when absent). A
    damaged entry raises `StateUnreadable`; it is never read as nothing."""
    state = vaultlib.read_state(vault)
    if STATE_KEY not in state:
        return {}
    images = state[STATE_KEY]
    if not isinstance(images, dict):
        raise _bad("it is not an object")
    months = images.get("months", {})
    if not isinstance(months, dict):
        raise _bad("months is not an object")
    for key, entry in months.items():
        if not isinstance(entry, dict):
            raise _bad(f"month {key} is not an object")
        for field in ("cents", "pictures", "unpriced"):
            if field in entry:
                _number(entry[field], f"{field} of {key}")
    return images


def _months(vault: Path) -> dict[str, Any]:
    months: dict[str, Any] = _images(vault).get("months", {})
    return months


def spent(vault: Path, today: date) -> float:
    """The cents drawn so far in `today`'s month."""
    entry = _months(vault).get(_month_key(today))
    return _cents(float(entry.get("cents", 0))) if entry else 0.0


def unpriced_count(vault: Path, today: date) -> int:
    """How many of this month's pictures were drawn at an unknown price."""
    entry = _months(vault).get(_month_key(today))
    return int(entry.get("unpriced", 0)) if entry else 0


def record(vault: Path, today: date, cents: float | None) -> None:
    """Count one picture in `today`'s month: `cents` added, or, for `None`
    (price unknown), counted under `unpriced` with no cents. Only this month
    and the one before it are kept. Cents that are not a finite number of
    zero or more raise `ValueError` and write nothing."""
    if cents is not None and (not math.isfinite(cents) or cents < 0):
        raise ValueError(f"cents must be a number of zero or more, got {cents}")
    images = _images(vault)
    keep = {_month_key(today), _previous_key(today)}
    months = {k: v for k, v in images.get("months", {}).items() if k in keep}
    entry = months.setdefault(_month_key(today),
                              {"cents": 0, "pictures": 0, "unpriced": 0})
    entry["pictures"] = int(entry.get("pictures", 0)) + 1
    if cents is None:
        entry["unpriced"] = int(entry.get("unpriced", 0)) + 1
    else:
        entry["cents"] = _cents(float(entry.get("cents", 0)) + cents)
    vaultlib.set_state(vault, STATE_KEY, {**images, "months": months})


def fit(estimate: Callable[[int], float], refs: int,
        limit: float) -> tuple[int, float] | None:
    """The most references `n <= refs` whose estimated cost is within
    `limit`, with that estimate; `None` when even no references is over.
    A negative `refs` is a caller error and raises `ValueError`."""
    if refs < 0:
        raise ValueError(f"refs must be zero or more, got {refs}")
    for n in range(refs, -1, -1):
        cost = _cents(estimate(n))
        if cost <= _cents(limit):
            return n, cost
    return None


def room(lim: Limits, run_spent: float, month_spent: float,
         estimate: float) -> str | None:
    """`None` when an attempt costing `estimate` fits under both caps, else
    the plain reason it does not (the month's ceiling when both are passed).
    A figure that is not a finite number of zero or more raises
    `ValueError`: the fences fail closed."""
    for name, x in (("run_spent", run_spent), ("month_spent", month_spent),
                    ("estimate", estimate)):
        if not math.isfinite(x) or x < 0:
            raise ValueError(f"{name} must be a number of zero or more, got {x}")
    if _cents(month_spent + estimate) > _cents(lim.month):
        return f"this month's ceiling ({lim.month:g} cents) would be passed"
    if _cents(run_spent + estimate) > _cents(lim.run):
        return f"the cap for one run ({lim.run:g} cents) would be passed"
    return None
