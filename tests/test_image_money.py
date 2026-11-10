"""image_money.py: the money limits for drawing pictures, read from the
vault's settings (the real tool, a real settings file)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image_money  # noqa: E402
import vaultlib  # noqa: E402

CONFIG = "_meta/vault-config.yaml"


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path: Path, body: str | None) -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / CONFIG).write_text("version: 1\n" + (body or ""), encoding="utf-8")
    return vault


def test_limits_are_the_spec_defaults(tmp_path):
    v = make_vault(tmp_path, None)
    lim = image_money.limits(v)
    assert (lim.auto, lim.attempt, lim.redraws, lim.run, lim.month,
            lim.unpriced) == (False, 5, 1, 200, 2000, False)
    assert lim.service is None and lim.model is None and lim.price is None
    assert "pc" not in lim.kinds and "scene" in lim.kinds
    assert lim.guidance == "_Campaign/Image_Guidance.md"


def test_limits_read_what_the_vault_sets(tmp_path):
    v = make_vault(tmp_path, "vault:\n  images:\n    auto: true\n    redraws: 0\n"
                   "    service: gemini\n    model: some-model\n    price: 4\n")
    lim = image_money.limits(v)
    assert (lim.auto, lim.redraws, lim.service, lim.model, lim.price) == (
        True, 0, "gemini", "some-model", 4)
