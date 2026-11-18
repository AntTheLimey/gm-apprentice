"""#715 and #717: a value of escaped empty quotes is empty, and what the
scaffold writes before play is stamped as made before play."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
TEMPLATES = ROOT / "skills" / "shared" / "templates"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
import reconcile_scan as rs  # noqa: E402
import schema_rules  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib as vl  # noqa: E402

ESC = '\\"\\"'
NPC = f"---\ntype: npc\nnationality: {ESC}\nvoice: {ESC}\n---\n\n## Overview\n\nx\n"


def vault_with(tmp_path: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    (tmp_path / "_meta").mkdir(exist_ok=True)
    (tmp_path / "_meta" / "vault-config.yaml").write_text("version: 1\n")
    return tmp_path


# --- the shared helper ---------------------------------------------------------

@pytest.mark.parametrize("value", [None, "", "  ", [], {}, ESC, "\\'\\'", f" {ESC} "])
def test_effectively_empty(value):
    assert vl.effectively_empty(value)


@pytest.mark.parametrize("value", ["x", '""', '\\"hi\\"', "\\\"\\\"\\\"", ["a"], 0])
def test_not_effectively_empty(value):
    assert not vl.effectively_empty(value)


def test_schema_rules_uses_it():
    assert schema_rules._empty(ESC)


# --- the voices check (#715) ---------------------------------------------------

def test_voice_read_takes_escaped_quotes_as_none():
    assert vl.voice_read(f"---\nvoice: {ESC}\n---\n") == ""
    assert vl.voice_value(f"---\nvoice: {ESC}  # none\n---\n") == ""
    assert vl.voice_read("---\nvoice: \\'\\'\n---\n") == ""
    assert vl.voice_read('---\nvoice: "Dry."\n---\n') == "Dry."


def test_voices_rows_skip_an_escaped_empty_voice(tmp_path):
    v = vault_with(tmp_path, {
        "NPCs/Tom.md": NPC,
        "NPCs/Ann.md": '---\ntype: npc\nvoice: "Slow."\n---\n'})
    rows = vc.voice_rows(v, [])
    assert any(r.startswith("Ann\t") for r in rows)
    assert not any(r.startswith("Tom\t") for r in rows)
    named = vc.voice_rows(v, ["Tom"])
    assert named[-1] == "Tom\t(none)"


# --- the check and its fix (#715) ----------------------------------------------

def test_escaped_empty_keys_only_exact_values():
    text = ("---\ntype: npc\na: \\\"\\\"\nb: \\\"x\\\"\nc: \\'\\'   # n\n"
            "d:\n  - \\\"\\\"\n---\n\nbody \\\"\\\"\n")
    keys, same = vl.escaped_empty_keys(text)
    assert keys == ["a", "c"]
    assert same == text
    _, fixed = vl.escaped_empty_keys(text, fix=True)
    assert fixed == ('---\ntype: npc\na: ""\nb: \\"x\\"\nc: ""   # n\n'
                     'd:\n  - \\"\\"\n---\n\nbody \\"\\"\n')


def test_frontmatter_check_warns_then_fixes(tmp_path):
    v = vault_with(tmp_path, {"NPCs/Tom.md": NPC.replace("\n", "\r\n")})
    rows = vc.check_frontmatter(v, None)
    hits = [r for r in rows if r.startswith("WARNING\tNPCs/Tom.md\tnationality, voice")]
    assert len(hits) == 1 and "--fix" in hits[0]
    assert ESC in (v / "NPCs/Tom.md").read_text()      # a dry run writes nothing
    rows = vc.check_frontmatter(v, None, fix=True)
    assert any(r.startswith("FIXED\tNPCs/Tom.md\t") for r in rows)
    after = (v / "NPCs/Tom.md").read_bytes().decode()
    assert after == NPC.replace(ESC, '""').replace("\n", "\r\n")
    assert not any("escaped quotes" in r for r in vc.check_frontmatter(v, None))


def test_frontmatter_command_fix_flag(tmp_path):
    v = vault_with(tmp_path, {"NPCs/Tom.md": NPC})
    run = subprocess.run([sys.executable, str(SCRIPTS / "vault_check.py"), str(v),
                          "frontmatter", "--fix"], capture_output=True, text=True)
    assert "FIXED\tNPCs/Tom.md" in run.stdout, run.stdout + run.stderr
    assert 'voice: ""' in (v / "NPCs/Tom.md").read_text()


# --- a writer given the escaped form (#715) ------------------------------------

def test_entity_new_writes_empty_quotes_for_escaped_ones(tmp_path):
    v = tmp_path
    subprocess.run([sys.executable, str(SCRIPTS / "vault_scaffold.py"), str(v),
                    "--name", "T", "--no-system", "--write"],
                   capture_output=True, text=True, check=True)
    run = subprocess.run(
        [sys.executable, str(SCRIPTS / "vault_write.py"), str(v), "entity-new",
         "--type", "npc", "--name", "Marlo", "--write"],
        input=f"---\nvoice: {ESC}\nnationality: {ESC}\n---\n\n## Overview\n\nx\n",
        capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    note = (v / "Characters/NPCs/Marlo.md").read_text()
    assert 'voice: ""' in note and 'nationality: ""' in note
    assert ESC not in note


# --- what the scaffold writes before play (#717) --------------------------------

@pytest.mark.parametrize("name", ["adventure-brief", "world-index", "world-domain"])
def test_scaffold_templates_are_stamped_before_play(name):
    text = (TEMPLATES / f"{name}.md").read_text()
    fm = vl.extract_frontmatter(text) or {}
    assert "createdSession" in fm and vl.before_play(fm["createdSession"])


def test_entity_new_brief_is_stamped_before_play(tmp_path):
    v = tmp_path
    subprocess.run([sys.executable, str(SCRIPTS / "vault_scaffold.py"), str(v),
                    "--name", "T", "--no-system", "--write"],
                   capture_output=True, text=True, check=True)
    run = subprocess.run(
        [sys.executable, str(SCRIPTS / "vault_write.py"), str(v), "entity-new",
         "--type", "adventure-brief", "--name", "Brief", "--write"],
        input=("---\nscope: one-shot\nsystem: undecided\nsessions_estimated: \"1\"\n"
               "continuation_type: new\nadventure_shape: linear\n---\n\n"
               "## Premise\n\nHi\n\n### The Truth\n\nSecret\n"),
        capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    fm = vl.extract_frontmatter((v / "Adventures/Brief/Brief.md").read_text())
    assert "createdSession" in fm and vl.before_play(fm["createdSession"])


def test_stale_drafts_is_quiet_about_a_stamped_scaffold_note(tmp_path):
    session = "---\ntype: session\nsession_number: 1\n---\n"
    brief = "---\ntype: adventure-brief\ncanon_status: DRAFT\ncreatedSession: \"\"\n---\n"
    bare = "---\ntype: adventure-brief\ncanon_status: DRAFT\n---\n"
    v = vault_with(tmp_path, {"Session_01.md": session, "Brief.md": brief})
    assert vc.check_stale_drafts(v) == []
    v2 = vault_with(tmp_path / "b", {"Session_01.md": session, "Brief.md": bare})
    assert any("missing createdSession" in r for r in vc.check_stale_drafts(v2))


def test_reconcile_scan_lists_a_linked_scaffold_note_as_pre_play(tmp_path):
    sessions = "Chapters/Chapter 1/Sessions"
    wrap = f"{sessions}/Session 01 - Start - Wrap-Up.md"
    v = vault_with(tmp_path, {
        f"{sessions}/Session 01 - Start.md":
            "---\ntype: session\nsession_number: 1\nstatus: wrap-up\ndocuments:\n"
            "  wrap_up: \"[[Session 01 - Start - Wrap-Up]]\"\n---\n",
        wrap: "---\ntype: session_wrap\nsession: \"[[Session 01 - Start]]\"\n"
              "canon_status: DRAFT\n---\n\nThe table opened [[Geography]].\n",
        "_World/Geography.md":
            "---\ntype: world_domain\ndomain: geography\nstatus: active\n"
            "canon_status: DRAFT\ncreatedSession: \"\"\nasOfSession: \"\"\n---\n"})
    out = rs.scan(v, wrap)
    assert "pre-play draft entities played this session: 1" in out
    assert "  _World/Geography.md" in out


# --- the update stamps older scaffold notes (#717) ------------------------------

def test_update_stamps_unstamped_scaffold_drafts_only(tmp_path):
    world = ("---\ntype: world_domain\ndomain: {d}\nstatus: stub\n"
             "canon_status: DRAFT\nlastUpdated: \"\"\nasOfSession: \"\"\n---\n\n## Overview\n")
    brief = "---\ntype: adventure-brief\ncanon_status: DRAFT\ntitle: B\n---\n\n## Premise\n"
    v = vault_with(tmp_path, {
        "_World/geography.md": world.format(d="geography"),
        "Adventures/B/B.md": brief,
        # left alone: stamped, canon, played (asOfSession set), another type, template
        "_World/health.md": world.format(d="health").replace(
            "canon_status: DRAFT", "canon_status: DRAFT\ncreatedSession: \"Session 2\""),
        "_World/religion.md": world.format(d="religion").replace(
            "DRAFT", "AUTHORITATIVE"),
        "_World/calendar.md": world.format(d="calendar").replace(
            'asOfSession: ""', 'asOfSession: "Session 3"'),
        "NPCs/Tom.md": "---\ntype: npc\ncanon_status: DRAFT\n---\n",
        "_Templates/_Template_World_Domain.md": world.format(d="")})
    before = {p: (v / p).read_text() for p in (
        "_World/health.md", "_World/religion.md", "_World/calendar.md",
        "NPCs/Tom.md", "_Templates/_Template_World_Domain.md")}
    (item,) = mv.find_scaffold_pre_play(v)
    assert item.id == "scaffold-pre-play" and len(item.lines) == 2
    item.apply(None)
    for rel in ("_World/geography.md", "Adventures/B/B.md"):
        fm = vl.extract_frontmatter((v / rel).read_text())
        assert vl.before_play(fm["createdSession"]), rel
    assert (v / "Adventures/B/B.md").read_text().endswith("\n\n## Premise\n")
    for rel, text in before.items():
        assert (v / rel).read_text() == text, rel
    assert mv.find_scaffold_pre_play(v) == []


# --- campaign-wide notes made before play are canon at the first reconcile (#717) ---

def _first_session(tmp_path, extra):
    sessions = "Chapters/Chapter 1/Sessions"
    wrap = f"{sessions}/Session 01 - Start - Wrap-Up.md"
    files = {
        f"{sessions}/Session 01 - Start.md":
            "---\ntype: session\nsession_number: 1\nstatus: wrap-up\ndocuments:\n"
            "  wrap_up: \"[[Session 01 - Start - Wrap-Up]]\"\n---\n",
        wrap: "---\ntype: session_wrap\nsession: \"[[Session 01 - Start]]\"\n"
              "canon_status: DRAFT\n---\n\nThey met nobody.\n",
        "Adventures/B/B.md":
            "---\ntype: adventure-brief\ncanon_status: DRAFT\ncreatedSession: \"\"\n---\n",
        "_World/geography.md":
            "---\ntype: world_domain\ndomain: geography\nstatus: active\n"
            "canon_status: DRAFT\ncreatedSession: \"\"\n---\n",
        "_World/world-index.md":
            "---\ntype: world_domain\ndomain: index\nstatus: stub\n"
            "canon_status: DRAFT\ncreatedSession: \"\"\n---\n",
        "NPCs/Tom.md":
            "---\ntype: npc\ncanon_status: DRAFT\ncreatedSession: \"\"\n---\n",
        **extra}
    return vault_with(tmp_path, files), wrap


def test_scan_lists_campaign_wide_notes_unlinked(tmp_path):
    v, wrap = _first_session(tmp_path, {})
    out = rs.scan(v, wrap)
    assert "campaign-wide draft notes made before play: 2" in out
    assert "  Adventures/B/B.md (campaign-wide, made before play)" in out
    assert not any("NPCs/Tom.md" in line and "campaign-wide" in line for line in out)
    assert "pre-play draft entities played this session: 0" in out


def test_promote_takes_campaign_wide_not_ordinary_unlinked(tmp_path):
    import reconcile_promote as rp
    v, wrap = _first_session(tmp_path, {})
    rows, _orig, texts, errors = rp.plan(v, wrap, "2026-11-17")
    assert errors == 0
    assert {"Adventures/B/B.md", "_World/geography.md"} <= set(texts)
    assert "NPCs/Tom.md" not in texts
    # --except still works on them
    rows, _o, texts, _e = rp.plan(v, wrap, "2026-11-17", ["geography"])
    assert "_World/geography.md" not in texts and "Adventures/B/B.md" in texts
    assert any(r.startswith("KEPT\t_World/geography.md") for r in rows)


def test_authoritative_brief_is_untouched(tmp_path):
    import reconcile_promote as rp
    v, wrap = _first_session(tmp_path, {
        "Adventures/B/B.md":
            "---\ntype: adventure-brief\ncanon_status: AUTHORITATIVE\ncreatedSession: \"\"\n---\n"})
    _rows, _o, texts, _e = rp.plan(v, wrap, "2026-11-17")
    assert "Adventures/B/B.md" not in texts
    assert "campaign-wide draft notes made before play: 1" in rs.scan(v, wrap)
    assert not any("campaign-wide" in line for line in rs.scan(vault_with(
        tmp_path / "plain", {"Wrap.md": "---\ntype: session_wrap\n---\n"}), "Wrap.md"))


# --- reviewer follow-ups (#717, #715) ---------------------------------------------

def test_update_skips_a_note_touched_in_play_and_is_crlf_safe_and_idempotent(tmp_path):
    world = ("---\r\ntype: world_domain\r\ndomain: {d}\r\nstatus: active\r\n"
             "canon_status: DRAFT\r\n{extra}asOfSession: \"\"\r\n---\r\n\r\n## Overview\r\n")
    v = vault_with(tmp_path, {
        "_World/a.md": world.format(d="a", extra=""),
        "_World/played.md": world.format(d="p", extra="source: play\r\n")})
    (item,) = mv.find_scaffold_pre_play(v)
    assert item.lines == ['stamp _World/a.md as made before play (createdSession: "")']
    item.apply(None)
    data = (v / "_World/a.md").read_bytes().decode()
    assert 'createdSession: ""\r\n' in data and "\n" not in data.replace("\r\n", "")
    assert (v / "_World/played.md").read_bytes().decode() == world.format(
        d="p", extra="source: play\r\n")
    once = data
    assert mv.find_scaffold_pre_play(v) == []
    assert (v / "_World/a.md").read_bytes().decode() == once


def test_entity_new_brief_with_session_is_not_pre_play(tmp_path):
    subprocess.run([sys.executable, str(SCRIPTS / "vault_scaffold.py"), str(tmp_path),
                    "--name", "T", "--no-system", "--write"],
                   capture_output=True, text=True, check=True)
    run = subprocess.run(
        [sys.executable, str(SCRIPTS / "vault_write.py"), str(tmp_path), "entity-new",
         "--type", "adventure-brief", "--name", "Late", "--session", "5", "--write"],
        input=("---\nscope: one-shot\nsystem: undecided\nsessions_estimated: \"1\"\n"
               "continuation_type: new\nadventure_shape: linear\n---\n\n"
               "## Premise\n\nHi\n\n### The Truth\n\nSecret\n"),
        capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    fm = vl.extract_frontmatter((tmp_path / "Adventures/Late/Late.md").read_text())
    assert vl.parse_session_number(fm["createdSession"]) == 5
    assert not vl.before_play(fm["createdSession"])


def test_except_lasts_one_run_and_a_session_number_leaves_the_set(tmp_path):
    import reconcile_promote as rp
    v, wrap = _first_session(tmp_path, {})
    _r, _o, texts, _e = rp.plan(v, wrap, "2026-11-17", ["geography"])
    assert "_World/geography.md" not in texts
    # nothing was written, and the next scan lists it again
    assert "  _World/geography.md (campaign-wide, made before play)" in rs.scan(v, wrap)
    kept_row = rp.plan(v, wrap, "2026-11-17", ["geography"])[0][0]
    assert "listed again next time" in kept_row
    geo = v / "_World/geography.md"
    geo.write_text(geo.read_text().replace('createdSession: ""', "createdSession: 1"))
    assert "_World/geography.md" not in "\n".join(rs.scan(v, wrap))


def test_a_stub_is_not_campaign_wide(tmp_path):
    import reconcile_promote as rp
    v, wrap = _first_session(tmp_path, {})
    _r, _o, texts, _e = rp.plan(v, wrap, "2026-11-17")
    assert "_World/world-index.md" not in texts          # status: stub
    assert "  _World/world-index.md (campaign-wide, made before play)" not in rs.scan(v, wrap)


def test_quoted_wrapped_escapes_are_deliberately_not_empty():
    # `'\"\"'` and `"\"\""` are real two-character strings, not the escaped bare form.
    for line in ("voice: '\\\"\\\"'", 'voice: "\\"\\""'):
        assert vl.voice_read(f"---\n{line}\n---\n") != ""
        assert vl.escaped_empty_keys(f"---\n{line}\n---\n")[0] == []


def test_escaped_empty_comment_needs_a_space():
    assert vl.escaped_empty_keys('---\nvoice: \\"\\"#c\n---\n')[0] == []
    keys, fixed = vl.escaped_empty_keys('---\nvoice: \\"\\" # c\n---\n', fix=True)
    assert keys == ["voice"] and 'voice: "" # c' in fixed
