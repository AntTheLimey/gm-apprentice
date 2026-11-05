"""Helpers the update's tests share: a throwaway vault on the settings file,
a private site pinned to the repo's publish tool, and a run of the update."""

import contextlib
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402
import migrate_site as ms  # noqa: E402
from layouts import write_config  # noqa: E402
import site_fixture  # noqa: E402
import vault_check as vc  # noqa: E402
from vaultlib import (read_stamp, settings, vault_layout,  # noqa: E402
                      write_stamp)

PLUGIN = "1.10.53"
NEEDS_NODE = unittest.skipUnless(
    os.environ.get("VAULT_CHECK_REQUIRE_NODE")
    or (shutil.which("node") and (
        vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
    "node and the publish tool's node_modules are needed")


def tmp(case):
    d = Path(tempfile.mkdtemp(prefix="mig-move-"))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    return d


def make_vault(case, front="publish:\n  mode: player\n", version="1.10.12"):
    """A vault on the settings file; `front` is the settings the short way
    (`publish:` and the names under it), as `write_config` takes them."""
    vault = tmp(case) / "Vault"
    (vault / "_meta").mkdir(parents=True)
    write_config(vault, f'---\ntype: meta\ngm_apprentice_version: "{version}"\n{front}---\n')
    return vault


def install_as(site, version):
    """The tool installed in the site folder says it is `version`; it is the
    repo's own tool underneath, so the other steps of the update still work."""
    pkg = site / "node_modules" / "gm-apprentice-publish"
    pkg.unlink()
    (pkg / "bin").mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps(
        {"name": "gm-apprentice-publish", "version": version}), encoding="utf-8")
    real = site_fixture.TOOL_DIR / "bin" / "gm-publish.js"
    (pkg / "bin" / "gm-publish.js").write_text(
        f"require({json.dumps(str(real))});\n", encoding="utf-8")


def with_site(case, vault, spec=None, installed="1.20.0", **site_keys):
    """A private site for `vault`, pinned to the repo's tool (or `spec`)."""
    site_fixture.give_site(vault, lambda p: None, private=True)
    site = site_fixture.point_site_at(vault, **site_keys)
    site_fixture.pin_site(site, spec)
    if spec is not None:
        install_as(site, installed)
    return site


def hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(
        p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*")) if p.is_file()}


def update(vault, *args):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(migrate, "plugin_version",
                           return_value=(PLUGIN, "test")), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = migrate.main([str(vault), *args])
    return code, out.getvalue(), err.getvalue()


def add_steps(site, **scripts):
    """The site's package.json gains these scripts (prebuild, postbuild ...)."""
    file = site / "package.json"
    data = json.loads(file.read_text(encoding="utf-8"))
    data["scripts"] = {**data.get("scripts", {}), **scripts}
    file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def moved_vault_with_site(case, spec=None, installed="1.24.0", **site_keys):
    """A vault already on the new settings file, naming a private site."""
    vault = tmp(case) / "Vault"
    (vault / "_meta").mkdir(parents=True)
    site = site_fixture.private_site()
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nplayer_site:\n  publish: true\n"
        f"  folder: {site.as_posix()}\n", encoding="utf-8")
    write_stamp(vault, "1.10.50")
    site_fixture.point_site_at(vault, site, **site_keys)
    # The shared fixture's folderMap is a setting the vault's file decides;
    # these sites hold only what the test names.
    file = site / "vault.config.json"
    config = json.loads(file.read_text(encoding="utf-8"))
    config.pop("folderMap", None)
    file.write_text(json.dumps(config), encoding="utf-8")
    site_fixture.pin_site(site, spec)
    if spec is not None:
        install_as(site, installed)
    return vault, site


