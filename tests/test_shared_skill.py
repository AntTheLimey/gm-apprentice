"""skills/shared is a skill `npx skills` installs beside the others and
Claude Code hides (it holds the files the GM skills use)."""
from pathlib import Path

import yaml

SKILL = Path(__file__).resolve().parents[1] / "skills" / "shared" / "SKILL.md"


def _front() -> dict:
    text = SKILL.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    return yaml.safe_load(text.split("---\n", 2)[1])


def test_shared_is_a_skill_npx_will_install():
    fm = _front()
    assert fm["name"] == "shared"
    assert fm["description"].strip()
    # metadata.internal would need INSTALL_INTERNAL_SKILLS=1 at install.
    assert not (fm.get("metadata") or {}).get("internal")


def test_shared_is_hidden_in_claude_code():
    fm = _front()
    assert fm["disable-model-invocation"] is True
    assert fm["user-invocable"] is False


def test_shared_skill_is_small():
    assert SKILL.stat().st_size < 400


def test_shared_is_hidden_in_codex():
    # Codex leaves a skill out of the model's list when its agents/openai.yaml
    # says so (tested with codex 0.167.0); `npx skills` copies the folder.
    policy = yaml.safe_load((SKILL.parent / "agents" / "openai.yaml")
                            .read_text(encoding="utf-8"))["policy"]
    assert policy["allow_implicit_invocation"] is False
