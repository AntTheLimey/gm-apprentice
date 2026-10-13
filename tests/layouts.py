"""Run a test on both settings layouts: build the vault the old way (a
`_meta/vault-config.md`), then, for the new layout, take it across with the
publish tool's own `settings move`, so the two layouts hold the same
settings by construction."""

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "publish" / "bin" / "gm-publish.js"

LAYOUTS = ("legacy", "new")


def move_to_new_layout(vault: Path, *fill: str) -> Path:
    """Move `vault` to `_meta/vault-config.yaml` and `vault-state.json`.
    `fill` are `--fill name=value` answers for a vault that lacks them."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on PATH")
    args = [node, str(TOOL), "settings", "move", "--vault", str(vault)]
    for item in fill:
        args += ["--fill", item]
    done = subprocess.run(args, capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    assert (vault / "_meta" / "vault-config.yaml").is_file()
    assert not (vault / "_meta" / "vault-config.md").exists()
    return vault


def on_layout(vault: Path, layout: str, *fill: str) -> Path:
    """`vault` as built (old layout), or moved to the new one."""
    return vault if layout == "legacy" else move_to_new_layout(vault, *fill)
