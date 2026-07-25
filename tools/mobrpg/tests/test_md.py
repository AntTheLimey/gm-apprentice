from mobrpg import md


def test_headings_bold_italic_code():
    assert md.md_to_html("## Title") == "<h2>Title</h2>"
    assert md.md_to_html("a **b** c") == "<p>a <strong>b</strong> c</p>"
    assert md.md_to_html("a *b* c") == "<p>a <em>b</em> c</p>"
    assert md.md_to_html("use `x`") == "<p>use <code>x</code></p>"


def test_links():
    assert md.md_to_html("[t](http://u)") == '<p><a href="http://u">t</a></p>'


def test_table_becomes_html_table():
    src = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"
    html = md.md_to_html(src)
    assert "<table>" in html
    assert "<th>A</th><th>B</th>" in html
    assert "<td>1</td><td>2</td>" in html
    assert "<td>3</td><td>4</td>" in html


def test_lists():
    assert md.md_to_html("- one\n- two") == "<ul><li>one</li><li>two</li></ul>"
    assert md.md_to_html("1. a\n2. b") == "<ol><li>a</li><li>b</li></ol>"


def test_paragraph_and_linebreaks():
    assert md.md_to_html("l1\nl2") == "<p>l1<br>l2</p>"
    assert md.md_to_html("p1\n\np2") == "<p>p1</p><p>p2</p>"


def test_html_escaping():
    assert md.md_to_html("a < b & c") == "<p>a &lt; b &amp; c</p>"


def test_table_round_trips_through_html():
    src = "| Attr | Val |\n| --- | --- |\n| STR | 12 |\n| DEX | 14 |"
    back = md.html_to_md(md.md_to_html(src))
    assert "| Attr | Val |" in back
    assert "| STR | 12 |" in back
    assert "| DEX | 14 |" in back


def test_html_to_md_basics():
    assert md.html_to_md("<p>Hello <strong>world</strong></p>") == "Hello **world**"
    assert md.html_to_md("<h2>Title</h2>") == "## Title"
    out = md.html_to_md("<ul><li>one</li><li>two</li></ul>")
    assert "- one" in out and "- two" in out


def test_list_followed_by_paragraph_stays_separated():
    # Regression: a <p> after a </ul> lost its blank-line separator, so the
    # paragraph glued onto the last list item and, on the next push, was
    # absorbed into the list as an extra bullet.
    out = md.html_to_md("<ul><li>a</li><li>b</li></ul><p>See more.</p>")
    assert out == "- a\n- b\n\nSee more."


def test_underscore_not_intraword():
    # Regression B1: `_` inside a word (snake_case, file_name) or a URL must not
    # emphasize — otherwise `_description()` feeds spurious <em> into the world.
    assert md.md_to_html("snake_case_ident") == "<p>snake_case_ident</p>"
    assert md.md_to_html("file_name") == "<p>file_name</p>"
    assert md.md_to_html("see http://x/a_b_c here") == "<p>see http://x/a_b_c here</p>"
    assert md.md_to_html("a foo_bar b") == "<p>a foo_bar b</p>"


def test_underscore_emphasis_when_flanked():
    # Whitespace/punctuation-flanked `_…_` still emphasizes (CommonMark).
    assert md.md_to_html("_italic_") == "<p><em>italic</em></p>"
    assert md.md_to_html("a _b_ c") == "<p>a <em>b</em> c</p>"
    assert md.md_to_html("(_word_)") == "<p>(<em>word</em>)</p>"


def test_table_cells_honor_escaped_pipe():
    # Regression B1: an escaped \| inside a cell must not split the column, and
    # the cell content must be unescaped to a literal pipe.
    src = "| A | B |\n| --- | --- |\n| a \\| b | c |"
    html = md.md_to_html(src)
    assert "<th>A</th><th>B</th>" in html
    assert "<td>a | b</td><td>c</td>" in html


def test_converter_idempotent_over_corpus():
    # The base-hash for description merge must be stable: md -> html -> md must
    # be a fixed point on the shapes the vault uses, or untouched entities read
    # as "changed" every sync.
    corpus = [
        "## Background\n\nA **ruthless** smuggler with *hidden* debts.\n\n"
        "- Owns the Blue Boar\n- Fears the excise men\n\n"
        "See also the [ledger](http://x).",
        "Plain paragraph only.",
        "Body line above a list.\n\n- solo bullet\n\nTrailing paragraph.",
        "1. first\n2. second\n\nAfter the ordered list.",
        "| Attr | Val |\n| --- | --- |\n| STR | 12 |\n\nStats above.",
        "> a quoted aside\n\nand a paragraph.",
    ]
    for src in corpus:
        once = md.html_to_md(md.md_to_html(src))
        twice = md.html_to_md(md.md_to_html(once))
        assert once == twice, f"not a fixed point:\n{once!r}\n{twice!r}"


def test_html_to_md_escapes_pipe_in_table_cells():
    # A canon table cell containing a literal '|' must be emitted as '\|' so the
    # row keeps its column count — an unescaped pipe becomes an extra column and
    # corrupts the vault table (mirror of the fixed md_to_html cell path).
    html = ("<table><thead><tr><th>A</th><th>B</th></tr></thead>"
            "<tbody><tr><td>x | y</td><td>z</td></tr></tbody></table>")
    out = md.html_to_md(html)
    rows = [r for r in out.splitlines() if r.strip()]
    assert all(len(md._cells(r)) == 2 for r in rows)   # every row is 2 columns
    assert r"x \| y" in out


def test_md_html_table_round_trip_preserves_escaped_pipe():
    # md -> html -> md must not silently drop the escape and split the cell.
    src = "| A | B |\n| --- | --- |\n| x \\| y | z |"
    back = md.html_to_md(md.md_to_html(src))
    last = [r for r in back.splitlines() if r.strip()][-1]
    assert md._cells(last) == ["x | y", "z"]
