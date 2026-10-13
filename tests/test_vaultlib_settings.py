"""vaultlib asks the publish tool for settings and parses none itself."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"))

import vaultlib  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def built_in():
    """The built-in list, from the tool, never restated here."""
    return vaultlib.settings_default("player_site.hide.sections")


def make_vault(tmp_path: Path, frontmatter: str | None) -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    if frontmatter is not None:
        (vault / "_meta" / "vault-config.md").write_text(
            f"---\n{frontmatter}\n---\n", encoding="utf-8")
    return vault


def file_text(vault: Path) -> str:
    return (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")


def count_runs(monkeypatch):
    calls: list[list[str]] = []
    real = subprocess.run

    def wrapper(*args, **kwargs):
        calls.append(list(args[0]))
        return real(*args, **kwargs)

    monkeypatch.setattr(vaultlib.subprocess, "run", wrapper)
    return calls


def test_defaults_are_not_written(tmp_path):
    vault = make_vault(tmp_path, "publish: {}")
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.connections") == "tree"
    assert not s.written("player_site.features.connections")
    assert s.has_site_block


def test_written_value(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  connections: web")
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.connections") == "web"
    assert s.written("player_site.features.connections")
    assert s.origins["player_site.features.connections"] == "file"


def test_exclude_sections_own_and_built_in(tmp_path):
    own = make_vault(tmp_path / "a", "publish:\n  exclude_sections: [Spoilers]")
    plain = make_vault(tmp_path / "b", "publish: {}")
    assert vaultlib.settings(own).get("player_site.hide.sections") == ["Spoilers"]
    assert vaultlib.settings(plain).get("player_site.hide.sections") == built_in()


def test_no_file_at_all(tmp_path):
    s = vaultlib.settings(make_vault(tmp_path, None))
    assert not s.has_site_block
    assert s.get("player_site.features.connections") == "tree"


def test_fault_is_listed_not_raised(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  connections: sideways")
    s = vaultlib.settings(vault)
    assert [f["name"] for f in s.faults] == ["publish.connections"]
    assert {"name", "level", "kind", "message"} <= set(s.faults[0])
    assert s.origins["player_site.features.connections"] == "fault"


def test_unknown_name_fault_keeps_suggestion(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  conections: web")
    faults = vaultlib.settings(vault).faults
    assert any(f.get("suggest") == "publish.connections" for f in faults)


def test_site_config_old_keys_take_part(tmp_path):
    vault = make_vault(tmp_path, "publish: {}")
    config = tmp_path / "vault.config.json"
    config.write_text('{"vaultPath": "vault", "excludeSections": ["Mine"]}',
                      encoding="utf-8")
    s = vaultlib.settings(vault, site_config=config)
    # The site file's list adds to the built-in one when the vault file sets none.
    assert s.get("player_site.hide.sections") == built_in() + ["Mine"]
    assert s.origins["player_site.hide.sections"] == "site-file"
    assert vaultlib.settings(vault).get("player_site.hide.sections") == built_in()


def test_set_then_settings_sees_it(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    assert vaultlib.settings(vault).get("player_site.features.connections") == "tree"
    assert vaultlib.settings_set(vault, [("publish.connections", "web")]) == [
        "publish.connections"]
    assert vaultlib.settings(vault).get("player_site.features.connections") == "web"


def test_set_passes_lists_as_json(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    vaultlib.settings_set(
        vault, [("publish.exclude_sections", ['Odd "one"', "Plain"])])
    assert vaultlib.settings(vault).get("player_site.hide.sections") == [
        'Odd "one"', "Plain"]


def test_refused_set_carries_reason_and_leaves_file(tmp_path):
    vault = make_vault(tmp_path, "publish: {}")
    before = file_text(vault)
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings_set(vault, [("publish.connections", "sideways"),
                                      ("publish.nonsense", 1)])
    assert e.value.refused
    assert "\n" not in str(e.value)
    assert not str(e.value).startswith(("Error:", "could not read"))
    assert file_text(vault) == before


def test_unset(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  connections: web")
    assert vaultlib.settings(vault).written("player_site.features.connections")
    assert vaultlib.settings_unset(
        vault, ["publish.connections", "publish.link_previews"]) == [
        "publish.connections"]
    assert not vaultlib.settings(vault).written("player_site.features.connections")


def test_refused_unset(tmp_path):
    vault = make_vault(tmp_path, "publish: {}")
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings_unset(vault, ["nonsense.thing"])
    assert e.value.refused


def test_raw_returns_the_map(tmp_path):
    vault = make_vault(
        tmp_path, "publish:\n  wrap_up:\n    recap: false")
    raw = vaultlib.settings_raw(vault, "publish.wrap_up")
    assert isinstance(raw, dict) and raw
    assert vaultlib.settings_raw(vault, "publish.nothing_here") is None
    assert "publish" in vaultlib.settings_raw(vault)


def test_invalid_yaml_raises_with_the_line(tmp_path):
    vault = make_vault(tmp_path, "publish: [unclosed\n  x: : :")
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings(vault)
    assert not e.value.refused
    assert "not valid YAML" in str(e.value)
    assert "\n" not in str(e.value)


def test_no_node(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish: {}")
    monkeypatch.setenv("PATH", "")
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings(vault)
    assert str(e.value).startswith("could not read the vault's settings:")
    assert not e.value.refused


def test_tool_missing(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish: {}")
    monkeypatch.setattr(vaultlib, "PUBLISH_TOOL", tmp_path / "nowhere.js")
    with pytest.raises(vaultlib.SettingsUnavailable, match="not at"):
        vaultlib.settings(vault)


def test_timeout(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish: {}")

    def slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 1)

    monkeypatch.setattr(vaultlib.subprocess, "run", slow)
    with pytest.raises(vaultlib.SettingsUnavailable, match="did not answer"):
        vaultlib.settings(vault)


def test_output_not_json(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish: {}")

    def junk(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, b"not json", b"")

    monkeypatch.setattr(vaultlib.subprocess, "run", junk)
    with pytest.raises(vaultlib.SettingsUnavailable, match="JSON"):
        vaultlib.settings(vault)


def test_two_calls_run_the_tool_once(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish: {}")
    calls = count_runs(monkeypatch)
    vaultlib.settings(vault)
    vaultlib.settings(vault)
    assert len(calls) == 1
    vaultlib.forget_settings(vault)
    vaultlib.settings(vault)
    assert len(calls) == 2


def test_cache_is_keyed_by_vault_and_site_config(tmp_path, monkeypatch):
    a = make_vault(tmp_path / "a", "publish: {}")
    b = make_vault(tmp_path / "b", "publish:\n  connections: web")
    calls = count_runs(monkeypatch)
    assert vaultlib.settings(a).get("player_site.features.connections") == "tree"
    assert vaultlib.settings(b).get("player_site.features.connections") == "web"
    assert len(calls) == 2


def test_mutating_a_result_does_not_reach_the_next_caller(tmp_path):
    vault = make_vault(tmp_path, "publish: {}")
    first = vaultlib.settings(vault)
    first.get("player_site.hide.sections").append("Corrupt")
    first.values["player_site.hide.sections"].append("Corrupt")
    first.faults.append({"name": "x"})
    first.origins["player_site.features.connections"] = "file"
    second = vaultlib.settings(vault)
    assert second.get("player_site.hide.sections") == built_in()
    assert second.faults == []
    assert second.origins["player_site.features.connections"] == "default"


def test_settings_default(tmp_path):
    assert "GM Notes" in built_in()
    assert vaultlib.settings_default("player_site.features.connections") == "tree"
    vaultlib.settings_default("player_site.hide.sections").append("Corrupt")
    assert vaultlib.settings_default("player_site.hide.sections") == built_in()
    with pytest.raises(KeyError):
        vaultlib.settings_default("publish.nonsense")


def test_hand_edit_is_not_seen_until_forgotten(tmp_path):
    vault = make_vault(tmp_path, "publish:\n  connections: web")
    assert vaultlib.settings(vault).get("player_site.features.connections") == "web"
    (vault / "_meta" / "vault-config.md").write_text(
        "---\npublish:\n  connections: tree\n---\n", encoding="utf-8")
    assert vaultlib.settings(vault).get("player_site.features.connections") == "web"
    vaultlib.forget_settings(vault)
    assert vaultlib.settings(vault).get("player_site.features.connections") == "tree"


def stub_run(stderr: bytes, code: int = 1):
    def run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], code, b"", stderr)
    return run


TRACE = (b"node:internal/modules/cjs/loader:1386\n  throw err;\n  ^\n\n"
         b"Error: Cannot find module 'yaml'\n    at Function._resolveFilename\n"
         b"\nNode.js v25.5.0\n")


def test_tool_crash_names_a_failure_to_start(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    monkeypatch.setattr(vaultlib.subprocess, "run", stub_run(TRACE))
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings(vault)
    message = str(e.value)
    assert "failed to start" in message and "Cannot find module" in message
    assert "Node.js v" not in message and not e.value.refused
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings_set(vault, [("publish.connections", "web")])
    assert "failed to start" in str(e.value) and not e.value.refused


def test_crash_without_error_line_uses_first_line(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    monkeypatch.setattr(vaultlib.subprocess, "run",
                        stub_run(b"boom\n\nNode.js v25.5.0\n"))
    with pytest.raises(vaultlib.SettingsUnavailable, match=r"start \(boom\)"):
        vaultlib.settings(vault)


def test_long_crash_line_is_cut(tmp_path, monkeypatch):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    monkeypatch.setattr(vaultlib.subprocess, "run",
                        stub_run(b"Error: " + b"x" * 5000 + b"\nmore\n"))
    with pytest.raises(vaultlib.SettingsUnavailable) as e:
        vaultlib.settings(vault)
    assert len(str(e.value)) < 400


def test_vault_that_is_not_a_folder(tmp_path):
    gone = tmp_path / "nope"
    file = tmp_path / "file.md"
    file.write_text("x", encoding="utf-8")
    for vault in (gone, file):
        for call in (lambda v: vaultlib.settings(v),
                     lambda v: vaultlib.settings_set(v, [("publish.site", True)]),
                     lambda v: vaultlib.settings_unset(v, ["publish.site"]),
                     lambda v: vaultlib.settings_raw(v)):
            with pytest.raises(vaultlib.SettingsUnavailable) as e:
                call(vault)
            assert str(e.value) == (
                f"could not read the vault's settings: {vault.as_posix()} "
                "is not a folder")


@pytest.mark.parametrize("name", ["--vault", "-x"])
def test_option_like_names_are_refused_before_the_tool_runs(
        tmp_path, monkeypatch, name):
    vault = make_vault(tmp_path, "publish:\n  site: true")
    calls = count_runs(monkeypatch)
    for call in (lambda: vaultlib.settings_set(vault, [(name, "x")]),
                 lambda: vaultlib.settings_unset(vault, ["publish.site", name])):
        with pytest.raises(vaultlib.SettingsUnavailable) as e:
            call()
        assert e.value.refused and str(e.value) == f"{name} is not a setting"
    assert calls == []
