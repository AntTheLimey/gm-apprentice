from mobrpg.section import gm_notes_split


def test_gm_notes_split_roundtrip_and_boundary():
    body = "Intro.\n\n## History\n\nStuff.\n\n## GM Notes\n\nSecret.\n"
    main, tail = gm_notes_split(body)
    assert main + tail == body
    assert tail.startswith("## GM Notes")
    assert "Secret." in tail and "Secret." not in main

def test_gm_notes_split_absent_and_crlf():
    assert gm_notes_split("Just prose.\n") == ("Just prose.\n", "")
    body = "A.\r\n\r\n## GM Notes\r\nS.\r\n"
    main, tail = gm_notes_split(body)
    assert main + tail == body and tail.startswith("## GM Notes")
