"""image_money.py: the money limits for drawing pictures, read from the
vault's settings (the real tool, a real settings file)."""

import dataclasses
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
            lim.unpriced) == (False, 10, 1, 200, 2000, False)
    assert lim.service is None and lim.model is None and lim.price is None
    assert "pc" not in lim.kinds and "scene" in lim.kinds
    assert lim.guidance == "_Campaign/Image_Guidance.md"


def test_limits_read_what_the_vault_sets(tmp_path):
    v = make_vault(tmp_path, "vault:\n  images:\n    auto: true\n    redraws: 0\n"
                   "    service: gemini\n    model: some-model\n    price: 4\n")
    lim = image_money.limits(v)
    assert (lim.auto, lim.redraws, lim.service, lim.model, lim.price) == (
        True, 0, "gemini", "some-model", 4)


def test_thinking_defaults_off_and_reads_on(tmp_path):
    assert image_money.limits(make_vault(tmp_path, None)).thinking is False
    vaultlib.forget_settings(None)
    v = make_vault(tmp_path / "b", "vault:\n  images:\n    thinking: true\n")
    assert image_money.limits(v).thinking is True


def test_settings_without_the_picture_names_are_a_plain_skew_error(
        tmp_path, monkeypatch):
    v = make_vault(tmp_path, None)
    real = vaultlib.settings(v)
    stripped = {k: x for k, x in real.values.items()
                if not k.startswith("vault.images.")}
    monkeypatch.setattr(vaultlib, "settings",
                        lambda vault: dataclasses.replace(real, values=stripped))
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        image_money.limits(v)
    assert str(e.value) == (
        "This vault's picture settings could not be read: the publish tool "
        "in use is older than this command. Run gma update.")


# --- the month count and the fences ---------------------------------------

import json  # noqa: E402
from datetime import date  # noqa: E402

STATE = "_meta/vault-state.json"


def months(v: Path) -> dict:
    return json.loads((v / STATE).read_text(encoding="utf-8"))["images"]["months"]


def test_record_adds_and_spent_reads(tmp_path):
    v = make_vault(tmp_path, None)
    d = date(2026, 11, 9)
    image_money.record(v, d, 3.4)
    image_money.record(v, d, 4.1)
    assert image_money.spent(v, d) == 7.5
    assert months(v)["2026-11"]["pictures"] == 2


def test_unpriced_counts_pictures_not_cents(tmp_path):
    v = make_vault(tmp_path, None)
    d = date(2026, 11, 9)
    image_money.record(v, d, None)
    assert image_money.spent(v, d) == 0
    assert months(v)["2026-11"]["unpriced"] == 1
    assert months(v)["2026-11"]["pictures"] == 1


def test_only_two_months_are_kept(tmp_path):
    v = make_vault(tmp_path, None)
    for m in (9, 10, 11):
        image_money.record(v, date(2026, m, 5), 1)
    assert set(months(v)) == {"2026-10", "2026-11"}


def test_the_year_turns_over(tmp_path):
    v = make_vault(tmp_path, None)
    image_money.record(v, date(2026, 11, 5), 1)
    image_money.record(v, date(2026, 12, 5), 1)
    image_money.record(v, date(2027, 1, 5), 1)
    assert set(months(v)) == {"2026-12", "2027-01"}


def test_a_new_month_starts_at_nothing(tmp_path):
    v = make_vault(tmp_path, None)
    image_money.record(v, date(2026, 11, 9), 3.4)
    assert image_money.spent(v, date(2026, 12, 1)) == 0


def test_spent_is_nothing_with_no_state_file(tmp_path):
    v = make_vault(tmp_path, None)
    assert image_money.spent(v, date(2026, 11, 9)) == 0


def test_other_state_keys_survive(tmp_path):
    v = make_vault(tmp_path, None)
    (v / STATE).write_text('{"gm_apprentice_version": "1.12.4"}\n', encoding="utf-8")
    image_money.record(v, date(2026, 11, 9), 2)
    state = json.loads((v / STATE).read_text(encoding="utf-8"))
    assert state["gm_apprentice_version"] == "1.12.4"
    assert "images" in state


def test_fractions_do_not_drift(tmp_path):
    v = make_vault(tmp_path, None)
    d = date(2026, 11, 9)
    for _ in range(10):
        image_money.record(v, d, 0.1)
    assert image_money.spent(v, d) == 1.0


def test_fit_drops_references_to_get_under():
    est = lambda n: 3.4 + 0.5 * n  # noqa: E731
    assert image_money.fit(est, 4, 5) == (3, 4.9)


def test_fit_keeps_all_references_when_they_fit():
    assert image_money.fit(lambda n: 1 + n, 2, 5) == (2, 3)


def test_fit_refuses_when_nothing_fits():
    assert image_money.fit(lambda n: 5.04, 4, 5) is None


def test_fit_accepts_exactly_the_limit_despite_float_error():
    assert image_money.fit(lambda n: 0.1 + 0.2 + n * 0, 0, 0.3) == (0, 0.3)


def test_room_names_the_cap_that_stops_it(tmp_path):
    lim = image_money.limits(make_vault(tmp_path, None))
    assert image_money.room(lim, 10, 10, 3.4) is None
    assert image_money.room(lim, 198, 10, 3.4) == (
        "the cap for one run (200 cents) would be passed")
    assert image_money.room(lim, 10, 1999, 3.4) == (
        "this month's ceiling (2000 cents) would be passed")
    assert image_money.room(lim, 196.6, 10, 3.4) is None


def test_room_names_the_month_when_both_caps_are_passed(tmp_path):
    lim = image_money.limits(make_vault(tmp_path, None))
    assert image_money.room(lim, 199, 1999, 3.4) == (
        "this month's ceiling (2000 cents) would be passed")


@pytest.mark.parametrize("args", [
    (float("nan"), 0, 1), (0, float("nan"), 1), (0, 0, float("nan")),
    (float("inf"), 0, 1), (0, 0, -1)])
def test_room_fails_closed_on_bad_figures(tmp_path, args):
    lim = image_money.limits(make_vault(tmp_path, None))
    with pytest.raises(ValueError):
        image_money.room(lim, *args)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1.0])
def test_record_refuses_bad_cents_and_writes_nothing(tmp_path, bad):
    v = make_vault(tmp_path, None)
    image_money.record(v, date(2026, 11, 9), 2)
    before = (v / STATE).read_bytes()
    with pytest.raises(ValueError):
        image_money.record(v, date(2026, 11, 9), bad)
    assert (v / STATE).read_bytes() == before


DAMAGED = [
    '{"images": 5}',
    '{"images": {"months": []}}',
    '{"images": {"months": {"2026-11": [1999]}}}',
    '{"images": {"months": {"2026-11": {"cents": null}}}}',
    '{"images": {"months": {"2026-11": {"cents": -3}}}}',
    '{"images": {"months": {"2026-11": {"pictures": "2"}}}}',
    '{"images": {"months": {"2026-11": {"unpriced": true}}}}',
]


@pytest.mark.parametrize("text", DAMAGED)
def test_a_damaged_count_raises_and_is_never_overwritten(tmp_path, text):
    v = make_vault(tmp_path, None)
    (v / STATE).write_text(text, encoding="utf-8")
    d = date(2026, 11, 9)
    for call in (lambda: image_money.spent(v, d),
                 lambda: image_money.unpriced_count(v, d),
                 lambda: image_money.record(v, d, 1)):
        with pytest.raises(vaultlib.StateUnreadable) as e:
            call()
        assert "vault-state.json" in str(e.value) and "images" in str(e.value)
    assert (v / STATE).read_text(encoding="utf-8") == text


def test_absent_things_read_as_nothing_spent(tmp_path):
    v = make_vault(tmp_path, None)
    d = date(2026, 11, 9)
    assert image_money.spent(v, d) == 0
    (v / STATE).write_text('{"images": {}}', encoding="utf-8")
    assert image_money.spent(v, d) == 0
    (v / STATE).write_text('{"images": {"months": {"2026-10": {"cents": 5}}}}',
                           encoding="utf-8")
    assert image_money.spent(v, d) == 0


def test_record_keeps_other_keys_under_images(tmp_path):
    v = make_vault(tmp_path, None)
    (v / STATE).write_text('{"images": {"note": "kept"}}', encoding="utf-8")
    image_money.record(v, date(2026, 11, 9), 2)
    assert json.loads((v / STATE).read_text(encoding="utf-8"))["images"]["note"] == "kept"


def test_fit_with_negative_references_is_a_caller_error():
    with pytest.raises(ValueError):
        image_money.fit(lambda n: 1, -1, 5)
