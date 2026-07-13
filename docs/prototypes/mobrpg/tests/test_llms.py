from pathlib import Path
from mobrpg import cli

LLMS = Path(cli.__file__).resolve().parent.parent / "llms.txt"


def test_llms_exists_and_covers_every_verb():
    assert LLMS.exists()
    text = LLMS.read_text()
    for verb, _ in cli.VERB_HELP:
        assert verb in text, f"llms.txt missing verb: {verb}"


def test_llms_documents_auth_and_write_guard():
    text = LLMS.read_text()
    for token in ("MOBRPG_TOKEN", "MOBRPG_ENV", "MOBRPG_ALLOW_PROD_WRITES"):
        assert token in text
