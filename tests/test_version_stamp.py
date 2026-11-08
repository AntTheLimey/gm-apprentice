"""skills/shared/VERSION is committed and must equal plugin.json's version."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_shared_version_matches_plugin_json():
    manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json")
                          .read_text(encoding="utf-8"))["version"]
    stamp = (ROOT / "skills" / "shared" / "VERSION").read_bytes().decode("utf-8")
    assert stamp.replace("\r\n", "\n") == manifest + "\n", (
        "skills/shared/VERSION must equal .claude-plugin/plugin.json's "
        "version, one line: bump both")


def test_zip_build_does_not_write_version():
    script = (ROOT / "scripts" / "build-skill-zips.sh").read_text(encoding="utf-8")
    assert '> "$STAGE/shared/VERSION"' not in script
