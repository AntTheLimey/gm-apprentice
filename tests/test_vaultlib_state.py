"""The version stamp and the layout, on both settings layouts. Neither needs
Node: `vault_check.py <vault> version` runs at the start of every skill."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import vaultlib  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
TOOL = Path(__file__).resolve().parent.parent / "tools" / "publish"
PLUGIN = vaultlib.plugin_version()[0]


def vault_with(tmp_path: Path, *, old=None, new=None, state=None) -> Path:
    """A vault holding the given text for each of the three files."""
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    for name, text in (("vault-config.md", old), ("vault-config.yaml", new),
                       ("vault-state.json", state)):
        if text is not None:
            (vault / "_meta" / name).write_text(text, encoding="utf-8")
    return vault


def old_file(version: str | None) -> str:
    stamp = f'gm_apprentice_version: "{version}"\n' if version else ""
    return f"---\ntype: meta\n{stamp}publish:\n  site: false\n---\n"


def state(version: str | None, **more) -> str:
    return json.dumps({**({"gm_apprentice_version": version} if version else {}),
                       **more})


# ---- the layout -----------------------------------------------------------

@pytest.mark.parametrize("files, want", [
    ({}, "none"),
    ({"old": old_file("1.10.0")}, "legacy"),
    ({"new": "version: 1\n"}, "new"),
    ({"new": "version: 1\n", "old": old_file("1.10.0")}, "new"),
    ({"state": "{}"}, "none"),
])
def test_layout_is_which_settings_file_exists(tmp_path, files, want):
    assert vaultlib.vault_layout(vault_with(tmp_path, **files)) == want


def test_a_folder_in_the_files_place_is_not_a_file(tmp_path):
    vault = vault_with(tmp_path)
    (vault / "_meta" / "vault-config.yaml").mkdir()
    assert vaultlib.vault_layout(vault) == "none"


# ---- reading the stamp ----------------------------------------------------

def test_stamp_from_the_old_file(tmp_path):
    assert vaultlib.read_stamp(vault_with(tmp_path, old=old_file("1.10.20"))) == "1.10.20"


def test_stamp_from_the_state_file(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n", state=state("1.10.54"))
    assert vaultlib.read_stamp(vault) == "1.10.54"


def test_the_state_file_wins_over_a_leftover_old_file(tmp_path):
    vault = vault_with(tmp_path, old=old_file("1.10.20"), new="version: 1\n",
                       state=state("1.10.54"))
    assert vaultlib.read_stamp(vault) == "1.10.54"


def test_no_stamp_reads_as_none(tmp_path):
    assert vaultlib.read_stamp(vault_with(tmp_path)) is None
    assert vaultlib.read_stamp(vault_with(tmp_path / "a", old=old_file(None))) is None
    assert vaultlib.read_stamp(vault_with(tmp_path / "b", new="version: 1\n")) is None
    assert vaultlib.read_stamp(vault_with(
        tmp_path / "c", new="version: 1\n", state=state(None, setup={"a": 1}))) is None


def test_a_stamp_that_is_a_list_reads_as_none(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n",
                       state='{"gm_apprentice_version": ["1.0.0"]}')
    assert vaultlib.read_stamp(vault) is None


@pytest.mark.parametrize("text", ["{not json", "[1, 2]", '"text"', ""])
def test_a_broken_state_file_is_one_plain_line(tmp_path, text):
    vault = vault_with(tmp_path, new="version: 1\n", state=text)
    with pytest.raises(vaultlib.StateUnreadable) as caught:
        vaultlib.read_stamp(vault)
    message = str(caught.value)
    assert message.startswith("_meta/vault-state.json is not valid JSON")
    assert "\n" not in message


def test_a_broken_state_file_is_ignored_on_the_old_layout(tmp_path):
    vault = vault_with(tmp_path, old=old_file("1.10.20"), state="{broken")
    assert vaultlib.read_stamp(vault) == "1.10.20"


# ---- writing the stamp ----------------------------------------------------

def test_write_keeps_every_other_key_and_the_order(tmp_path):
    original = {"setup": {"step": "inbox", "n": 2}, "zzz": [1, {"a": "é"}],
                "gm_apprentice_version": "1.10.20", "aaa": True}
    vault = vault_with(tmp_path, new="version: 1\n", state=json.dumps(original))
    vaultlib.write_stamp(vault, "1.10.54")
    got = json.loads((vault / "_meta/vault-state.json").read_text("utf-8"))
    assert list(got) == ["setup", "zzz", "gm_apprentice_version", "aaa"]
    assert got == {**original, "gm_apprentice_version": "1.10.54"}


def test_write_adds_the_key_at_the_end_and_makes_the_file(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n", state='{"setup": {"a": 1}}')
    vaultlib.write_stamp(vault, "1.10.54")
    assert list(json.loads((vault / "_meta/vault-state.json").read_text("utf-8"))) == [
        "setup", "gm_apprentice_version"]
    fresh = vault_with(tmp_path / "x", new="version: 1\n")
    vaultlib.write_stamp(fresh, "1.10.54")
    assert vaultlib.read_stamp(fresh) == "1.10.54"


def test_write_is_formatted_as_the_publish_tool_writes_it(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on PATH")
    body = {"setup": {"step": "x", "list": [1, 2], "empty": {}, "text": "é☃"},
            "gm_apprentice_version": "1.10.20"}
    vault = vault_with(tmp_path, new="version: 1\n", state=json.dumps(body))
    vaultlib.write_stamp(vault, "1.10.54")
    python_text = (vault / "_meta/vault-state.json").read_bytes()
    js = ("const {stateText}=require(process.argv[1]);"
          "const s=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));"
          "s.gm_apprentice_version='1.10.54';"
          "process.stdout.write(stateText(s));")
    (tmp_path / "before.json").write_text(json.dumps(body), encoding="utf-8")
    tool_text = subprocess.run(
        [node, "-e", js, str(TOOL / "lib" / "settings" / "state.js"),
         str(tmp_path / "before.json")], capture_output=True, check=True).stdout
    assert python_text == tool_text
    assert python_text.endswith(b"}\n") and b'\n  "setup"' in python_text


def test_write_leaves_no_temporary_file_and_replaces_atomically(tmp_path, monkeypatch):
    vault = vault_with(tmp_path, new="version: 1\n", state=state("1.10.20"))
    seen = []
    real = os.replace
    monkeypatch.setattr(os, "replace", lambda a, b: seen.append((Path(a).name, Path(b).name)) or real(a, b))
    vaultlib.write_stamp(vault, "1.10.54")
    assert len(seen) == 1 and seen[0][1] == "vault-state.json"
    assert seen[0][0] != "vault-state.json"
    assert sorted(p.name for p in (vault / "_meta").iterdir()) == [
        "vault-config.yaml", "vault-state.json"]


def test_a_broken_state_file_is_not_overwritten(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n", state="{broken")
    with pytest.raises(vaultlib.StateUnreadable):
        vaultlib.write_stamp(vault, "1.10.54")
    assert (vault / "_meta/vault-state.json").read_text("utf-8") == "{broken"


def test_write_on_the_old_layout_edits_the_old_file_only(tmp_path):
    vault = vault_with(tmp_path, old=old_file("1.10.20"))
    vaultlib.write_stamp(vault, "1.10.54")
    assert 'gm_apprentice_version: "1.10.54"' in (vault / "_meta/vault-config.md").read_text("utf-8")
    assert not (vault / "_meta/vault-state.json").exists()
    assert vaultlib.read_stamp(vault) == "1.10.54"


# ---- vault_check.py version, with no Node ---------------------------------

def version_row(vault: Path):
    """`vault_check.py <vault> version` with no Node on PATH."""
    env = {k: v for k, v in os.environ.items() if k != "PATH"}
    empty = vault.parent / "empty-bin"    # a folder that holds no `node`
    empty.mkdir(exist_ok=True)
    env["PATH"] = str(empty)
    done = subprocess.run([sys.executable, str(SCRIPTS / "vault_check.py"),
                           str(vault), "version"], capture_output=True,
                          text=True, env=env)
    return done.returncode, done.stdout


def test_version_row_ok_on_the_new_layout_with_no_node(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n", state=state(PLUGIN))
    code, out = version_row(vault)
    assert code == 0
    assert out.splitlines()[-1] == f"OK\t_meta/vault-state.json\tvault {PLUGIN} = plugin {PLUGIN}"


def test_version_row_mismatch_and_ahead_from_the_state_file(tmp_path):
    behind = vault_with(tmp_path / "a", new="version: 1\n", state=state("1.10.20"))
    code, out = version_row(behind)
    assert code == 1 and f"MISMATCH\t_meta/vault-state.json\tvault 1.10.20 < plugin {PLUGIN}" in out
    ahead = vault_with(tmp_path / "b", new="version: 1\n", state=state("99.0.0"))
    code, out = version_row(ahead)
    assert code == 1 and "AHEAD\t_meta/vault-state.json\tvault 99.0.0 >" in out


def test_version_row_absent_on_the_new_layout(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n")
    code, out = version_row(vault)
    assert code == 1
    assert "MISMATCH\t_meta/vault-state.json\tgm_apprentice_version absent" in out


def test_version_row_with_both_files_reads_the_state_file(tmp_path):
    vault = vault_with(tmp_path, old=old_file("1.10.20"), new="version: 1\n",
                       state=state(PLUGIN))
    code, out = version_row(vault)
    assert code == 0 and f"OK\t_meta/vault-state.json\tvault {PLUGIN}" in out


def test_version_row_for_a_broken_state_file_is_an_error_row(tmp_path):
    vault = vault_with(tmp_path, new="version: 1\n", state="{nope")
    code, out = version_row(vault)
    assert code == 1
    row = out.splitlines()[-1]
    assert row.startswith("ERROR\t(vault)\t_meta/vault-state.json is not valid JSON")


def test_version_row_on_the_old_layout_still_reads_the_old_file(tmp_path):
    vault = vault_with(tmp_path, old=old_file(PLUGIN))
    code, out = version_row(vault)
    assert code == 0 and f"OK\t_meta/vault-config.md\tvault {PLUGIN} = plugin {PLUGIN}" in out


def test_version_row_for_a_vault_with_no_settings_file(tmp_path):
    vault = vault_with(tmp_path)
    code, out = version_row(vault)
    # #381: a _meta with no settings file is first-time setup, not a migration.
    assert code == 0 and "SETUP\t(vault)\tno settings file in _meta/" in out


# ---- the yes-words (#374) -------------------------------------------------

def test_no_script_reads_a_yes_no_flag_a_second_way():
    """`gm_only` and `withheld` are read by the publish tool only (#352): a
    script asks it (the `relationships` command, the `withheld` lines op),
    so a YAML spelling (`0x1`, `1e0`) can never read one way here and
    another in the build. No script keeps its own reading or yes-words."""
    for script in sorted((TOOL.parent.parent / "skills" / "shared" / "scripts").glob("*.py")):
        text = script.read_text(encoding="utf-8")
        for name in ("gm_only_hides", "GM_ONLY_YES_WORDS", "is_withheld"):
            assert name not in text, f"{script.name} reads a flag itself ({name})"


# ---- the settings files' names are written once (#382) --------------------

def _code_strings(path: Path):
    """The string constants of a script, docstrings left out."""
    import ast
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docs = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                docs.add(id(body[0].value))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and id(node) not in docs):
            yield node.value


def test_no_script_writes_a_settings_file_name_but_vaultlib():
    """`vaultlib` holds the names of the vault's settings and state files; a
    script that needs one imports it, so a rename is one edit."""
    found = []
    for script in sorted(SCRIPTS.glob("*.py")):
        if script.name == "vaultlib.py":
            continue
        for text in _code_strings(script):
            for name in ("vault-config.md", "vault-config.yaml",
                         "vault-state.json"):
                if name in text:
                    found.append(f"{script.name}: {text[:60]!r}")
    assert found == []
