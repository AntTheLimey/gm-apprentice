"""The gma llms pages, and the gates that keep them and the skill text honest.

The pages under skills/shared/gma/ are hand-written prose around blocks
rendered from the command tree (gma_docs.render, the one definition of
conforming). The skill-text gates read every `gma <cmd> ...`,
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/<x>.py" ...` and
publish-tool line in skills/**/*.md and hold it to the real parsers.

Each gate has a positive control: an error planted in a copy, which the
gate must catch.
"""

import argparse
import contextlib
import io
import re
import shlex
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import gma  # noqa: E402
import gma_docs  # noqa: E402

PUBLISH_JS = ROOT / "tools" / "publish" / "bin" / "gm-publish.js"

# Snake_case flags that predate the kebab-case rule, with the reason each
# stays. This set may only shrink (test_grandfathered_flags_only_shrink).
GRANDFATHERED_FLAGS: dict[str, str] = {}

# Full command lines that stop short on purpose, by where they sit, with why.
# An entry the scan no longer finds fails (test_prefix_allowances_are_used).
PREFIX_ONLY = {
    "skills/session-wrapup/SKILL.md:16":
        "defines the shorthand `vw` that the later steps extend",
}

_TREE = None


def tree():
    global _TREE
    if _TREE is None:
        _TREE = gma.full_tree()
    return _TREE


# --- reading commands out of skill text ------------------------------------

MODULES = {c.module: n for n, c in gma.COMMANDS.items() if c.module}
SCRIPT_RE = re.compile(
    r'(?:python3?\s+)?"?\$\{CLAUDE_PLUGIN_ROOT\}/skills/shared/scripts/'
    r'(?P<mod>\w+)\.py"?')
BARE_RE = re.compile(r'(?P<mod>[a-z_]+)\.py\b')
GMA_RE = re.compile(r'gma\s+(?P<cmd>[a-z][a-z-]*)')
PUBLISH_RE = re.compile(
    r'(?:(?:node|npx)\s+)?(?:"[^"\s]*/gm-publish\.js"|gm-publish\.js'
    r'|gm-publish|gm-apprentice-publish|"\$TOOL")\s+(?P<sub>[a-z][a-z-]*)')
FENCE_RE = re.compile(r'^\s*(```|~~~)')
SEPARATORS = re.compile(r'\s(?:&&|\|\||;|\|)\s')


class Found:
    """One command line in a skill file."""

    def __init__(self, path, line, kind, name, rest, form, fenced):
        self.path, self.line, self.kind = path, line, kind
        self.name, self.rest, self.fenced = name, rest, fenced
        # "script" (python3 "${CLAUDE_PLUGIN_ROOT}/..."), "gma", or "bare"
        # (`vault_check.py frontmatter` or `vw ...`, the skills' shorthand).
        self.form = form

    def example(self):
        """A full command line with arguments: it must parse."""
        return (self.kind == "cmd" and self.form in ("script", "gma")
                and bool(self.rest.strip()) and not _synopsis(self.rest))

    def where(self):
        return f"{_rel(self.path)}:{self.line}"


def _rel(path):
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.name


def _match(text):
    """(kind, name, rest, form) when `text` starts with a command, else None."""
    text = text.lstrip()
    if text.startswith("$ "):
        text = text[2:]
    m = SCRIPT_RE.match(text)
    if m:
        if m.group("mod") == "gma":
            # The plan's calling form: hand the rest to the gma branch.
            text = "gma" + text[m.end():]
        elif m.group("mod") not in MODULES:
            return ("unknown-script", m.group("mod"), "", "script")
        else:
            return ("cmd", MODULES[m.group("mod")], text[m.end():], "script")
    m = BARE_RE.match(text)
    if m:
        if m.group("mod") not in MODULES:
            return ("unknown-script", m.group("mod"), "", "bare")
        return ("cmd", MODULES[m.group("mod")], text[m.end():], "bare")
    if text.startswith("vw "):
        # session-wrapup's shorthand for `vault_write.py <vault>`.
        return ("cmd", "vault-write", " <vault> " + text[3:], "bare")
    m = GMA_RE.match(text)
    if m:
        if m.group("cmd") == "publish":
            sub = re.match(r'\s+([a-z][a-z-]*)', text[m.end():])
            return ("publish", sub.group(1), "", "full") if sub else None
        return ("cmd", m.group("cmd"), text[m.end():], "gma")
    m = PUBLISH_RE.match(text)
    if m:
        return ("publish", m.group("sub"), "", "full")
    return None


def _split_outside_quotes(text):
    """`text` cut at each separator that is not inside quoted text."""
    parts, start, quote = [], 0, None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        else:
            m = SEPARATORS.match(text, i)
            if m:
                parts.append(text[start:i])
                start = i = m.end()
                continue
        i += 1
    parts.append(text[start:])
    return parts


def _segments(text):
    for seg in _split_outside_quotes(text):
        seg = seg.strip()
        while seg.startswith(("$(", "(")):
            seg = seg[2:] if seg.startswith("$(") else seg[1:]
        yield seg


def scan_file(path):
    """Every command line in one Markdown file, fenced and inline."""
    lines = path.read_text(encoding="utf-8").splitlines()
    found = []
    i, fence = 0, None
    para, para_start = [], 0

    def flush_para():
        text = " ".join(para)
        for span in re.finditer(r'`([^`]+)`', text):
            body = span.group(1).replace("\\|", "|")
            for seg in _segments(body):
                hit = _match(seg)
                if hit:
                    # The line the span starts on.
                    upto = text[:span.start()]
                    line = para_start + _line_of(para, len(upto))
                    found.append(Found(path, line, *hit, fenced=False))
                    break

    while i < len(lines):
        line = lines[i]
        m = FENCE_RE.match(line)
        if fence is None and m:
            flush_para()
            para = []
            fence = m.group(1)
            i += 1
            continue
        if fence is not None:
            if line.strip().startswith(fence):
                fence = None
                i += 1
                continue
            start = i
            logical = line
            while logical.rstrip().endswith("\\") and i + 1 < len(lines):
                logical = logical.rstrip()[:-1] + " " + lines[i + 1].strip()
                i += 1
            for seg in _segments(logical):
                hit = _match(seg)
                if hit:
                    found.append(Found(path, start + 1, *hit, fenced=True))
            i += 1
            continue
        if line.strip():
            if not para:
                para_start = i + 1
            para.append(line)
        else:
            flush_para()
            para = []
        i += 1
    flush_para()
    return found


def _line_of(para, offset):
    total = 0
    for n, line in enumerate(para):
        total += len(line) + 1
        if offset < total:
            return n
    return len(para) - 1


# Lines that may still name a script or the publish tool, by "<rel>:<line>",
# with the reason. Empty to start; it may only shrink.
ONLY_GMA_ALLOWED: dict[str, str] = {}

ONLY_GMA_EXCLUDED = ("skills/shared/gma/llms/",)
MODULE_PY_RE = re.compile(
    r'(?<![\w.-])(?P<mod>' + "|".join(sorted(MODULES)) + r')\.py\b')
PUBLISH_DIRECT_RE = re.compile(r'gm-publish\.js|\$\{?TOOL\}?\b|"\$TOOL"')


def only_gma_problems(paths):
    """Lines that name a script path or the publish tool instead of `gma`."""
    bad = []
    for path in paths:
        rel = _rel(path)
        if rel.startswith(ONLY_GMA_EXCLUDED):
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{rel}:{n}"
            if where in ONLY_GMA_ALLOWED:
                continue
            if "CLAUDE_PLUGIN_ROOT" in line:
                bad.append(f"{where}: names CLAUDE_PLUGIN_ROOT")
            for m in MODULE_PY_RE.finditer(line):
                bad.append(f"{where}: names {m.group('mod')}.py; "
                           f"use gma {MODULES[m.group('mod')]}")
                break
            if PUBLISH_DIRECT_RE.search(line):
                bad.append(f"{where}: runs the publish tool directly; "
                           "use gma publish")
    return bad


def skill_files():
    return sorted(p for p in (ROOT / "skills").rglob("*.md")
                  if "personal" not in p.parts)


_FOUND = None


def all_found():
    global _FOUND
    if _FOUND is None:
        _FOUND = [f for p in skill_files() for f in scan_file(p)]
    return _FOUND


def _tokens(rest):
    """The arguments of a command line, placeholders as `1`.

    `1` rather than `x`: it also satisfies a flag typed int (`--number N`).
    A placeholder is `<...>` or a bare capital word (`N`, `INDEX`).
    """
    rest = rest.split("<<", 1)[0]
    rest = re.sub(r'<[^<>\n]+>', '1', rest)
    rest = re.sub(r'(?<![\w"=-])[A-Z][A-Z0-9_-]*(?![\w"])', '1', rest)
    lex = shlex.shlex(rest, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    lex.commenters = "#"
    out = []
    try:
        for tok in lex:
            if tok and set(tok) <= set("();<>|&"):
                break
            out.append(tok)
    except ValueError as exc:
        raise UnclosedQuote(rest.strip()) from exc
    return out


class UnclosedQuote(ValueError):
    """A command line whose quotes don't close."""


def _synopsis(rest):
    """A usage synopsis (`[--system ID | --no-system]`, `[options]`,
    `FILE...`) rather than a command line: flags are checked, not parsed."""
    return bool(re.search(r'(?:^|\s)\[(?!\[)', rest)) or "..." in rest


def _takes_value(action):
    return action.nargs != 0


def flag_errors(command, rest, root=None):
    """Flags in `rest` that `gma <command>` doesn't have, walking subcommands."""
    root = root or tree()
    parser = gma._subparsers(root).choices[command]
    path = [command]
    if _synopsis(rest):
        known = set()
        for p in _all_parsers(parser):
            known |= set(p._option_string_actions)
        return [f"gma {command}: no flag {f}"
                for f in re.findall(r'(?<![\w-])(--?[a-zA-Z][\w-]*)', rest)
                if f not in known]
    errors = []
    try:
        toks = _tokens(rest)
    except UnclosedQuote:
        return [f"gma {command}: unclosed quote"]
    i = 0
    while i < len(toks):
        tok = toks[i]
        if tok == "--":
            break
        if tok.startswith("-") and len(tok) > 1 and not re.match(r'-\d', tok):
            # `--inventory/--state`: prose naming two flags at once.
            names = tok.split("=", 1)[0].split("/")
            for name in names:
                if name not in parser._option_string_actions:
                    errors.append(f"gma {' '.join(path)}: no flag {name}")
            action = parser._option_string_actions.get(names[-1])
            if action is not None and _takes_value(action) and "=" not in tok:
                if action.nargs in ("*", "+"):
                    while i + 1 < len(toks) and not toks[i + 1].startswith("-"):
                        i += 1
                elif action.nargs == "?":
                    if i + 1 < len(toks) and not toks[i + 1].startswith("-"):
                        i += 1
                else:
                    i += action.nargs if isinstance(action.nargs, int) else 1
        else:
            sub = _sub_action(parser)
            if sub is not None and tok in sub.choices:
                parser = sub.choices[tok]
                path.append(tok)
        i += 1
    return errors


def _sub_action(parser):
    for a in parser._actions:
        if isinstance(a, argparse._SubParsersAction):
            return a
    return None


def _all_parsers(parser):
    yield parser
    sub = _sub_action(parser)
    if sub is not None:
        for p in sub.choices.values():
            yield from _all_parsers(p)


def parse_error(command, rest, root=None):
    """argparse's complaint about `gma <command> rest`, or None."""
    root = root or tree()
    parser = gma._subparsers(root).choices[command]
    err = io.StringIO()
    try:
        toks = _tokens(rest)
    except UnclosedQuote:
        return "unclosed quote"
    try:
        with contextlib.redirect_stderr(err), \
                contextlib.redirect_stdout(io.StringIO()):
            parser.parse_args(toks)
    except SystemExit as exc:
        if exc.code:
            return err.getvalue().strip().splitlines()[-1]
    return None


# --- gates over the pages ---------------------------------------------------

def _copy_docs():
    d = Path(tempfile.mkdtemp(prefix="gma-docs-"))
    shutil.copytree(gma_docs.DOCS, d / "gma")
    return d / "gma"


class PageTests(unittest.TestCase):
    def addCleanupDir(self, d):
        self.addCleanup(shutil.rmtree, d.parent, True)

    def test_generated_blocks_match_the_tree(self):
        self.assertEqual(gma_docs.problems(tree(), gma_docs.DOCS), [],
                         "run: python3 scripts/gen_gma_docs.py")

    def test_gate_catches_a_deleted_flag_row(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        page = docs / "llms" / "links.md"
        text = page.read_text(encoding="utf-8")
        row = next(l for l in text.splitlines() if l.startswith("| `--keep-text`"))
        page.write_text(text.replace(row + "\n", ""), encoding="utf-8")
        found = gma_docs.problems(tree(), docs)
        self.assertTrue(any("links.md" in p for p in found), found)

    def test_render_fixes_the_deleted_row(self):
        text = (gma_docs.PAGES / "links.md").read_text(encoding="utf-8")
        row = next(l for l in text.splitlines() if l.startswith("| `--keep-text`"))
        self.assertEqual(gma_docs.render(text.replace(row + "\n", ""), tree()),
                         text)

    def test_every_command_has_a_page(self):
        self.assertEqual(gma_docs.missing_pages(tree(), gma_docs.PAGES), [])

    def test_gate_catches_a_dropped_page(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        (docs / "llms" / "relink.md").unlink()
        self.assertEqual(gma_docs.missing_pages(tree(), docs / "llms"),
                         ["relink"])
        self.assertTrue(any("relink" in p
                            for p in gma_docs.problems(tree(), docs)))

    def test_gate_catches_a_missing_index(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        (docs / "llms.md").unlink()
        self.assertIn("llms.md: missing", gma_docs.problems(tree(), docs))

    def test_gate_catches_a_missing_block(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        page = docs / "llms" / "moments.md"
        text = page.read_text(encoding="utf-8")
        start = text.index("<!-- BEGIN GENERATED: gma moments list -->")
        end = text.index(gma_docs.END, start) + len(gma_docs.END)
        page.write_text(text[:start] + text[end:], encoding="utf-8")
        found = gma_docs.problems(tree(), docs)
        self.assertTrue(any("gma moments list" in p for p in found), found)

    def test_gate_catches_a_block_for_no_command(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        page = docs / "llms" / "relink.md"
        page.write_text(page.read_text(encoding="utf-8")
                        + "\n<!-- BEGIN GENERATED: gma relink nowhere -->\n"
                        + gma_docs.END + "\n", encoding="utf-8")
        found = gma_docs.problems(tree(), docs)
        self.assertTrue(any("gma relink nowhere" in p for p in found), found)

    def test_gate_catches_a_stale_routing_table(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        index = docs / "llms.md"
        text = index.read_text(encoding="utf-8")
        row = next(l for l in text.splitlines() if l.startswith("| `links` |"))
        index.write_text(text.replace(row, row.replace("links", "linkz", 1)),
                         encoding="utf-8")
        self.assertIn("llms.md: routing table out of date",
                      gma_docs.problems(tree(), docs))
        # With its closing marker gone the block is skipped by the renderer.
        index.write_text(text.replace(row, row.replace("links", "linkz", 1))
                         .replace(gma_docs.END, "", 1), encoding="utf-8")
        self.assertTrue(any("llms.md" in p
                            for p in gma_docs.problems(tree(), docs)))

    def test_stdin_formats_are_rendered(self):
        text = (gma_docs.PAGES / "vault-write.md").read_text(encoding="utf-8")
        self.assertIn("PATH<TAB>SECTION<TAB>LINE", text)
        self.assertIn("stdin: markdown sections", text)

    def test_index_under_budget(self):
        self.assertEqual(gma_docs.over_budget(gma_docs.INDEX), [])

    def test_index_budget_gate_bites(self):
        docs = _copy_docs()
        self.addCleanupDir(docs)
        index = docs / "llms.md"
        text = index.read_text(encoding="utf-8")
        index.write_text(text + "x" * (12_001 - len(text.encode("utf-8"))),
                         encoding="utf-8", newline="\n")
        self.assertEqual(len(index.read_bytes()), 12_001)
        found = gma_docs.problems(tree(), docs)
        self.assertTrue(any("over INDEX_BUDGET" in p and "every routed call" in p
                            for p in found), found)

    def test_rendering_does_not_depend_on_prog(self):
        # Python 3.14 takes prog from `-m` under pytest; the pages must not.
        t = gma.full_tree()
        for p in _all_parsers(t):
            p.prog = "python3.14 -m pytest"
        for sub in gma._subparsers(t).choices.values():
            for p in _all_parsers(sub):
                p.prog = "python3.14 -m pytest"
        self.assertEqual(gma_docs.problems(t, gma_docs.DOCS), [])

    def test_check_mode_exits_1_on_drift(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "gen_gma_docs", ROOT / "scripts" / "gen_gma_docs.py")
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        docs = _copy_docs()
        self.addCleanupDir(docs)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.assertEqual(gen.main(["--check", "--docs", str(docs)]), 0)
            page = docs / "llms" / "links.md"
            page.write_text(page.read_text(encoding="utf-8")
                            .replace("| `--keep-text`", "| `--kept-text`"),
                            encoding="utf-8")
            self.assertEqual(gen.main(["--check", "--docs", str(docs)]), 1)
            self.assertEqual(gen.main(["--docs", str(docs)]), 0)
            self.assertEqual(gen.main(["--check", "--docs", str(docs)]), 0)


def help_problems(root, commands=None):
    """Commands with no summary, no `Example: gma <name>` epilog, or a
    subcommand with no help line."""
    commands = gma.COMMANDS if commands is None else commands
    bad = []
    for name, parser in gma._subparsers(root).choices.items():
        if not commands[name].summary:
            bad.append(f"{name}: no summary")
        epilog = (parser.epilog or "").strip()
        if not epilog.startswith("Example:"):
            bad.append(f"{name}: epilog does not begin 'Example:'")
        elif not re.search(rf'gma {re.escape(name)}\b', epilog):
            bad.append(f"{name}: example names no full `gma {name}` line")
        for path, _, summary in gma_docs.walk(parser, (name,)):
            if len(path) > 1 and not summary:
                bad.append(f"{' '.join(path)}: no help line")
    return bad


def snake_flags(root):
    """Option strings with an underscore, less the grandfathered ones."""
    return sorted({o for p in _all_parsers(root) for o in
                   p._option_string_actions if "_" in o}
                  - set(GRANDFATHERED_FLAGS))


def missing_arg_help(root):
    """Every argument (bar -h) with no help string, as `gma <path>: <arg>`."""
    bad = []
    for name, parser in gma._subparsers(root).choices.items():
        for path, p, _ in gma_docs.walk(parser, (name,)):
            for a in p._actions:
                if isinstance(a, (argparse._HelpAction,
                                  argparse._SubParsersAction)):
                    continue
                if not a.help:
                    arg = "/".join(a.option_strings) or a.dest
                    bad.append(f"gma {' '.join(path)}: {arg}")
    return bad


class ParserTests(unittest.TestCase):
    def test_every_command_has_help_and_an_example(self):
        self.assertEqual(help_problems(tree()), [])

    def test_help_gate_catches_each_fault(self):
        t = gma.full_tree()
        cmds = dict(gma.COMMANDS)
        cmds["relink"] = gma.Command("relink", "")
        gma._subparsers(t).choices["tones"].epilog = "Example: tones x"
        sub = _sub_action(gma._subparsers(t).choices["moments"])
        for a in sub._choices_actions:
            if a.dest == "status":
                a.help = None
        self.assertEqual(sorted(help_problems(t, cmds)), [
            "moments status: no help line",
            "relink: no summary",
            "tones: example names no full `gma tones` line"])
        gma._subparsers(t).choices["tones"].epilog = None
        self.assertIn("tones: epilog does not begin 'Example:'",
                      help_problems(t, cmds))

    def test_every_argument_has_help(self):
        self.assertEqual(missing_arg_help(tree()), [])

    def test_argument_help_gate_bites(self):
        t = gma.full_tree()
        gma._subparsers(t).choices["relink"].add_argument("--planted")
        self.assertEqual(missing_arg_help(t), ["gma relink: --planted"])

    def test_gate_catches_a_missing_example(self):
        t = gma.full_tree()
        gma._subparsers(t).choices["relink"].epilog = None
        self.assertNotEqual(gma_docs.problems(t, gma_docs.DOCS), [])

    def test_examples_parse(self):
        bad = []
        for name, parser in gma._subparsers(tree()).choices.items():
            for line in gma_docs.examples(parser):
                hit = _match(line)
                if name == "publish" and hit and hit[0] == "publish":
                    continue
                if hit is None or hit[1] != name:
                    bad.append(f"{name}: example is not a gma {name} line")
                elif hit[0] == "cmd":
                    err = parse_error(name, hit[2])
                    if err:
                        bad.append(f"{name}: {line}: {err}")
        self.assertEqual(bad, [])

    def test_every_parser_formats_its_help(self):
        # argparse's own --help runs the %-formatting the pages also use;
        # a badly formed help string must fail here, at every depth.
        count = 0
        for path, parser, _ in gma_docs.walk(tree(), ("gma",)):
            with self.subTest(parser=" ".join(path)):
                parser.format_help()
                count += 1
        self.assertGreater(count, 40)

    def test_a_bad_help_string_fails_the_generator(self):
        ap = argparse.ArgumentParser(prog="x")
        action = ap.add_argument("--n", help="fine")
        action.help = "see %(nope)s"   # 3.14 refuses this at add_argument
        with self.assertRaises(KeyError):
            gma_docs.render_block("gma x", ap, "")
        with self.assertRaises((KeyError, TypeError, ValueError)):
            ap.format_help()

    def test_flags_are_kebab_case(self):
        self.assertEqual(snake_flags(tree()), [], "flags are --kebab-case")

    def test_kebab_gate_bites(self):
        t = gma.full_tree()
        gma._subparsers(t).choices["relink"].add_argument(
            "--snake_flag", help="planted")
        self.assertEqual(snake_flags(t), ["--snake_flag"])

    def test_grandfathered_flags_only_shrink(self):
        # 0 when this gate was added (2026-11-05). This number may only go
        # down: a new flag is kebab-case, never a new entry.
        self.assertLessEqual(len(GRANDFATHERED_FLAGS), 0)


class LlmsCommandTests(unittest.TestCase):
    def _run(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = gma.main(argv)
            except SystemExit as exc:
                code = exc.code
        return code, out.getvalue(), err.getvalue()

    def test_llms_prints_the_index(self):
        code, out, _ = self._run(["llms"])
        self.assertEqual(code, 0)
        want = gma_docs.INDEX.read_text(encoding="utf-8").replace(
            "{gma}", f'python3 "{Path(gma.__file__).resolve().as_posix()}"')
        self.assertEqual(out, want)

    def test_llms_prints_a_page(self):
        code, out, _ = self._run(["llms", "relink"])
        self.assertEqual(code, 0)
        self.assertEqual(out, (gma_docs.PAGES / "relink.md")
                         .read_text(encoding="utf-8"))

    def test_unknown_page_exits_2_listing_names(self):
        code, _, err = self._run(["llms", "frobnicate"])
        self.assertEqual(code, 2)
        self.assertIn("relink", err)
        self.assertIn("vault-check", err)

    def test_no_path_out_of_the_pages(self):
        code, _, _ = self._run(["llms", "../llms"])
        self.assertEqual(code, 2)

    def test_llms_is_a_command(self):
        self.assertIn("llms", gma.COMMANDS)
        self.assertNotIn("llms", gma_docs.missing_pages(tree(), gma_docs.PAGES))


# --- gates over the skill text ----------------------------------------------

class SkillTextTests(unittest.TestCase):
    def test_skills_call_only_gma(self):
        self.assertEqual(only_gma_problems(skill_files()), [])

    def test_only_gma_allowances_only_shrink(self):
        found = set()
        for path in skill_files():
            for p in only_gma_problems([path]):
                found.add(p.split(": ")[0])
        self.assertEqual(sorted(set(ONLY_GMA_ALLOWED) - found), [])

    def test_only_gma_gate_bites(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text(
            'Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py"`.\n'
            "Run `relink.py <vault> <old> <new>`.\n"
            "Run `node gm-publish.js build`.\n"
            "Run `gma relink <vault> <old> <new>`.\n"
            "Run `npx gm-apprentice-publish build`.\n"
            "Install the gm-apprentice-publish package.\n"
            "The entry point is gma.py.\n"
            "Run `gma publish build`.\n"
            'Run `"$TOOL" build`.\n',
            encoding="utf-8")
        self.assertEqual(only_gma_problems([md]), [
            "x.md:1: names CLAUDE_PLUGIN_ROOT",
            "x.md:2: names relink.py; use gma relink",
            "x.md:3: runs the publish tool directly; use gma publish",
            "x.md:9: runs the publish tool directly; use gma publish"])

    def test_scan_matches_enough_lines(self):
        found = [f for f in all_found() if f.kind == "cmd"]
        self.assertGreater(len(found), 40)
        self.assertTrue(any(f.fenced for f in found))
        self.assertTrue(any(not f.fenced for f in found))
        # Each form the gates claim to read was read.
        self.assertGreater(len([f for f in found if f.form == "gma"]), 0)
        self.assertGreater(len([f for f in all_found()
                                if f.kind == "publish"]), 0)

    def test_skill_text_names_only_real_flags(self):
        self.assertEqual(name_problems(all_found()), [])

    def test_flag_gate_bites(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text(
            "Run `gma relink\n<vault> <old> <new> --aply`.\n\n"
            "```bash\ngma moments <vault> tag <w> \\\n  --writ\n```\n\n"
            "```bash\ngma moments <vault> list --write\n```\n",
            encoding="utf-8")
        found = scan_file(md)
        self.assertEqual([(f.name, f.line, f.fenced) for f in found],
                         [("relink", 1, False), ("moments", 5, True),
                          ("moments", 10, True)])
        errs = [flag_errors(f.name, f.rest) for f in found]
        self.assertEqual(errs, [["gma relink: no flag --aply"],
                                ["gma moments tag: no flag --writ"],
                                ["gma moments list: no flag --write"]])

    def test_name_gate_catches_each_fault(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text(
            "Run `frob_nicate.py <vault>`.\n\n"
            "Run `gma frobnicate <vault>`.\n\n"
            "Run `gma publish frobnicate`.\n\n"
            "Run `gma relink <vault> \"<old> <new>`.\n",
            encoding="utf-8")
        self.assertEqual(name_problems(scan_file(md)), [
            "x.md:1: no command for frob_nicate.py",
            "x.md:3: no command gma frobnicate",
            "x.md:5: publish has no subcommand frobnicate",
            "x.md:7: gma relink: unclosed quote"])

    def test_name_gate_catches_a_bare_unknown_script(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text("Run `vault_chek.py frontmatter <vault>`.\n\n"
                      "Run `vault_check.py frontmatter <vault>`.\n",
                      encoding="utf-8")
        self.assertEqual(name_problems(scan_file(md)), [
            "x.md:1: no command for vault_chek.py"])

    def test_segments_keep_separators_inside_quotes(self):
        for text in ('gma links <v> --as "north | south"',
                     "gma links <v> --as 'a && b'",
                     'gma links <v> --as "x ; y"'):
            with self.subTest(text=text):
                self.assertEqual(list(_segments(text)), [text])
        self.assertEqual(
            list(_segments('gma links <v> --as "a | b" | sort')),
            ['gma links <v> --as "a | b"', "sort"])
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text('Run `gma links <vault> fix --as "north | south"`.\n',
                      encoding="utf-8")
        self.assertNotIn("unclosed quote", " ".join(name_problems(scan_file(md))))

    def test_gma_calling_form_is_read(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        call = "gma"
        md = d / "x.md"
        md.write_text(f"Run `{call} relink <vault> <old> <new>`.\n\n"
                      f"Run `{call} frobnicate <vault>`.\n\n"
                      f"Run `{call} relink <vault> <old> <new> --aply`.\n",
                      encoding="utf-8")
        found = scan_file(md)
        self.assertEqual([(f.kind, f.name, f.form) for f in found],
                         [("cmd", "relink", "gma"), ("cmd", "frobnicate", "gma"),
                          ("cmd", "relink", "gma")])
        self.assertEqual(name_problems(found), [
            "x.md:3: no command gma frobnicate",
            "x.md:5: gma relink: no flag --aply"])

    def test_publish_subcommands_match_the_tool(self):
        text = PUBLISH_JS.read_text(encoding="utf-8")
        names = {n for n in re.findall(r"command === '([^']+)'", text)
                 if not n.startswith("-")}
        self.assertEqual(set(gma_docs.PUBLISH_SUBCOMMANDS), names)

    def test_skill_examples_parse(self):
        bad = []
        for f in all_found():
            if not f.example() or f.name not in gma.COMMANDS:
                continue
            if f.where() in PREFIX_ONLY:
                continue
            err = parse_error(f.name, f.rest)
            if err:
                bad.append(f"{f.where()}: gma {f.name}{f.rest}: {err}")
        self.assertEqual(bad, [])

    def test_prefix_allowances_are_used(self):
        where = {f.where() for f in all_found() if f.example()}
        self.assertEqual(sorted(set(PREFIX_ONLY) - where), [])

    def test_parse_gate_bites(self):
        self.assertIsNotNone(parse_error("relink", " <vault> <old>"))
        self.assertIsNone(parse_error("relink", " <vault> <old> <new>"))

    def test_routed_pages_exist(self):
        bad, seen = route_problems(skill_files())
        self.assertGreater(seen, 0)
        self.assertEqual(bad, [])

    def test_route_gate_bites(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text("Read `gma llms relink`, then\n`gma llms frobnicate`.\n",
                      encoding="utf-8")
        self.assertEqual(route_problems([md]),
                         (["x.md:2: no page frobnicate"], 2))

    def test_route_gate_reads_the_gma_form(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        call = "gma"
        md.write_text(f'Read `{call} llms relink`, then\n`{call} llms frobnicate`.\n',
                      encoding="utf-8")
        self.assertEqual(route_problems([md]),
                         (["x.md:2: no page frobnicate"], 2))

    def test_recipes_keep_exit_status(self):
        bad = []
        for path in skill_files():
            bad += _pipefail_problems(path)
        self.assertEqual(bad, [])

    def test_pipefail_gate_bites(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text("```bash\ngma links <vault> | head -5\n```\n\n"
                      "```bash\nset -o pipefail\ngma links <vault> | head\n```\n",
                      encoding="utf-8")
        self.assertEqual(len(_pipefail_problems(md)), 1)

    def test_pipefail_gate_sees_other_filters_continuations_and_inline(self):
        d = Path(tempfile.mkdtemp(prefix="gma-skill-"))
        self.addCleanup(shutil.rmtree, d, True)
        md = d / "x.md"
        md.write_text("```bash\ngma links <vault> | sort\n```\n\n"
                      "```bash\ngma links <vault> \\\n  | head -3\n```\n\n"
                      "Run `gma links <vault> | wc -l` for the count.\n\n"
                      "```bash\nset -o pipefail\ngma links <vault> | sort\n```\n",
                      encoding="utf-8")
        self.assertEqual([p.split(": ")[0] for p in _pipefail_problems(md)],
                         ["x.md:1", "x.md:5", "x.md:10"])


def name_problems(found):
    """Commands, scripts and publish subcommands that don't exist, and
    flags their command doesn't have. A publish line's flags are not
    checked: the tool's help is hand-written and has no parser to ask."""
    bad = []
    for f in found:
        if f.kind == "unknown-script":
            bad.append(f"{f.where()}: no command for {f.name}.py")
        elif f.kind == "publish":
            if f.name not in gma_docs.PUBLISH_SUBCOMMANDS:
                bad.append(f"{f.where()}: publish has no subcommand {f.name}")
        elif f.name not in gma.COMMANDS:
            bad.append(f"{f.where()}: no command gma {f.name}")
        else:
            bad += [f"{f.where()}: {e}" for e in flag_errors(f.name, f.rest)]
    return bad


def route_problems(paths):
    """(each `gma llms <name>` naming no page, how many routes were read)."""
    pages = {p.stem for p in gma_docs.PAGES.glob("*.md")}
    bad, seen = [], 0
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r'gma(?:\.py"?)?\s+llms\s+([a-z][a-z-]*)', text):
            seen += 1
            if m.group(1) not in pages:
                line = text[:m.start()].count("\n") + 1
                bad.append(f"{_rel(path)}:{line}: no page {m.group(1)}")
    return bad, seen


FILTERS = r"(?:head|tail|grep|sort|wc|jq|tee|awk|sed|cut)"
PIPE_INTO_FILTER = re.compile(r"(?<!\|)\|(?!\|)\s*" + FILTERS + r"\b")


def _piped(logical):
    """True when a gma command's output goes into a filter, which hides the
    command's exit status without `set -o pipefail`."""
    m = PIPE_INTO_FILTER.search(logical)
    return bool(m) and any(_match(seg) for seg in _segments(logical[:m.start()]))


def _logical_lines(block):
    """Fenced lines with `\\` continuations and a trailing `|` joined, so a
    pipe that starts a continuation line is seen with its command."""
    out, cur = [], ""
    for line in block:
        cur = f"{cur} {line.strip()}" if cur else line
        if cur.rstrip().endswith("\\"):
            cur = cur.rstrip()[:-1]
        elif cur.rstrip().endswith("|") and not cur.rstrip().endswith("||"):
            continue
        else:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def _pipefail_problems(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    try:
        where = path.relative_to(ROOT).as_posix()
    except ValueError:
        where = path.name
    bad, block, start, fence = [], [], 0, None
    for n, line in enumerate(lines, 1):
        m = FENCE_RE.match(line)
        if fence is None and m:
            fence, block, start = m.group(1), [], n
        elif fence is not None and line.strip().startswith(fence):
            if (any(_piped(l) for l in _logical_lines(block))
                    and "set -o pipefail" not in "\n".join(block)):
                bad.append(f"{where}:{start}: piped command without "
                           "set -o pipefail")
            fence = None
        elif fence is not None:
            block.append(line)
        else:
            # Inline code can't carry `set -o pipefail`.
            for span in re.finditer(r"`([^`]+)`", line):
                body = span.group(1).replace("\\|", "|")
                if _piped(body) and "set -o pipefail" not in body:
                    bad.append(f"{where}:{n}: piped command without "
                               "set -o pipefail")
    return bad


if __name__ == "__main__":
    unittest.main()
