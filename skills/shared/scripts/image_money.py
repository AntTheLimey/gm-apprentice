#!/usr/bin/env python3
"""The money limits for drawing pictures, as the vault's settings give them.

Every value comes from `vaultlib.settings(vault)`; the defaults live in the
settings registry and nowhere else. Money is US cents, as a number.
"""

from pathlib import Path
from typing import NamedTuple

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
