"""mobrpg-cli — CLI over the mobRPG world-builder API for gm-apprentice.

`__version__` is the package's own version (see pyproject.toml), independent of
the gm-apprentice marketplace plugin version. Prefer the installed distribution
metadata; fall back to the pyproject default when running from a source tree that
has never been installed.
"""

from __future__ import annotations

try:
    from importlib.metadata import PackageNotFoundError, version as _version

    try:
        __version__ = _version("mobrpg-cli")
    except PackageNotFoundError:  # running from an uninstalled source checkout
        __version__ = "0.1.0"
except Exception:  # pragma: no cover - importlib.metadata always present on 3.10+
    __version__ = "0.1.0"

__all__ = ["__version__"]
