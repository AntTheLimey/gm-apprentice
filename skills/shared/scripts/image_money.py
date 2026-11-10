#!/usr/bin/env python3
"""The money limits for drawing pictures, as the vault's settings give them.

Every value comes from `vaultlib.settings(vault)`; the defaults live in the
settings registry and nowhere else. Money is US cents, as a number.
"""

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
    kinds: tuple[str, ...]
    service: str | None
    model: str | None
    price: float | None
    guidance: str


def limits(vault: Path) -> Limits:
    """The picture-drawing settings of `vault`."""
    v = vaultlib.settings(vault).values
    return Limits(
        auto=bool(v["vault.images.auto"]),
        attempt=v["vault.images.attempt_limit"],
        redraws=int(v["vault.images.redraws"]),
        run=v["vault.images.run_cap"],
        month=v["vault.images.month_cap"],
        unpriced=bool(v["vault.images.unpriced"]),
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


def _months(vault: Path) -> dict[str, Any]:
    state = vaultlib.read_state(vault).get(STATE_KEY)
    months = state.get("months") if isinstance(state, dict) else None
    return months if isinstance(months, dict) else {}


def spent(vault: Path, today: date) -> float:
    """The cents drawn so far in `today`'s month."""
    entry = _months(vault).get(_month_key(today))
    if not isinstance(entry, dict):
        return 0.0
    return _cents(float(entry.get("cents", 0)))


def unpriced_count(vault: Path, today: date) -> int:
    """How many of this month's pictures were drawn at an unknown price."""
    entry = _months(vault).get(_month_key(today))
    return int(entry.get("unpriced", 0)) if isinstance(entry, dict) else 0


def record(vault: Path, today: date, cents: float | None) -> None:
    """Count one picture in `today`'s month: `cents` added, or, for `None`
    (price unknown), counted under `unpriced` with no cents. Only this month
    and the one before it are kept."""
    keep = {_month_key(today), _previous_key(today)}
    months = {k: v for k, v in _months(vault).items()
              if k in keep and isinstance(v, dict)}
    entry = months.setdefault(_month_key(today),
                              {"cents": 0, "pictures": 0, "unpriced": 0})
    entry["pictures"] = int(entry.get("pictures", 0)) + 1
    if cents is None:
        entry["unpriced"] = int(entry.get("unpriced", 0)) + 1
    else:
        entry["cents"] = _cents(float(entry.get("cents", 0)) + cents)
    vaultlib.set_state(vault, STATE_KEY, {"months": months})


def fit(estimate: Callable[[int], float], refs: int,
        limit: float) -> tuple[int, float] | None:
    """The most references `n <= refs` whose estimated cost is within
    `limit`, with that estimate; `None` when even no references is over."""
    for n in range(refs, -1, -1):
        cost = _cents(estimate(n))
        if cost <= _cents(limit):
            return n, cost
    return None


def room(lim: Limits, run_spent: float, month_spent: float,
         estimate: float) -> str | None:
    """`None` when an attempt costing `estimate` fits under both caps, else
    the plain reason it does not."""
    if _cents(run_spent + estimate) > _cents(lim.run):
        return f"the cap for one run ({lim.run:g} cents) would be passed"
    if _cents(month_spent + estimate) > _cents(lim.month):
        return f"this month's ceiling ({lim.month:g} cents) would be passed"
    return None
