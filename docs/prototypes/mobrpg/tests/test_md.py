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
