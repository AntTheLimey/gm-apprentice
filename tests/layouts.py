"""Settings fixtures for tests. A test says a vault's settings the short way
(`publish:` with `site: true`, `exclude_sections: [...]`, the way the old
settings file named them) and `write_config` writes them where they now live:
`_meta/vault-config.yaml`, with the version stamp in `_meta/vault-state.json`.
The setting names are taken from the publish tool's own registry
(tests/old_config_to_new.js), so a fixture never carries a table of its own."""

import functools
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "publish" / "bin" / "gm-publish.js"
CONVERTER = Path(__file__).resolve().parent / "old_config_to_new.js"

LAYOUTS = ("new",)


@functools.lru_cache(maxsize=None)
def _converted(text: str) -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on PATH")
    done = subprocess.run([node, str(CONVERTER)], input=text,
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    if "error" in answer:
        # A file that is not YAML at all: the new file holds the text as it
        # is, without the fences, so the reader meets what the test wrote.
        return _unfenced(text), "{}"
    return answer["yaml"], json.dumps(answer["state"])


def _unfenced(text: str) -> str:
    lines = text.split("\n")
    if lines and lines[0].rstrip("\r") == "---":
        for i, line in enumerate(lines[1:], 1):
            if line.rstrip("\r") == "---":
                return "\n".join(lines[1:i]) + "\n"
    return text


def new_config(text: str) -> str:
    """The new settings file's text for settings written the short way."""
    return _converted(text)[0]


def write_config(vault: Path, text: str) -> None:
    """Write `text` (settings the short way) as the vault's settings file,
    and any version stamp it carries into the state file."""
    meta = vault / "_meta"
    meta.mkdir(parents=True, exist_ok=True)
    yaml_text, state = _converted(text)
    (meta / "vault-config.yaml").write_text(yaml_text, encoding="utf-8")
    stamp = json.loads(state)
    if stamp:
        file = meta / "vault-state.json"
        held = json.loads(file.read_text(encoding="utf-8")) if file.is_file() else {}
        held.update(stamp)
        file.write_text(json.dumps(held, indent=2) + "\n", encoding="utf-8")
    import vaultlib
    vaultlib.forget_settings(vault)


def move_to_new_layout(vault: Path, *fill: str) -> Path:
    """The vault's `_meta/vault-config.md` (settings the short way), written
    as the new settings file and removed. `fill` are `name=value` settings for
    a vault that lacks them."""
    old = vault / "_meta" / "vault-config.md"
    if old.is_file():
        write_config(vault, old.read_text(encoding="utf-8"))
        old.unlink()
    if fill:
        node = shutil.which("node")
        done = subprocess.run(
            [node, str(TOOL), "settings", "set", "--vault", str(vault),
             *[f.replace("=", "=", 1) for f in fill]],
            capture_output=True, text=True)
        assert done.returncode == 0, done.stdout + done.stderr
    return vault


def on_layout(vault: Path, layout: str, *fill: str) -> Path:
    """`vault` on the settings layout there is: the new one."""
    return move_to_new_layout(vault, *fill)
