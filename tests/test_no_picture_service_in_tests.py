"""The suite-wide guard in conftest.py: no test reaches the picture service
or the keychain unless it replaces them itself."""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image_gemini  # noqa: E402
import image_keys  # noqa: E402


def test_a_call_to_the_picture_service_fails_the_test():
    with pytest.raises(pytest.fail.Exception) as e:
        image_gemini.SEND(image_gemini.URL, {}, b"{}", 1)
    assert str(e.value) == ("a test tried to call the picture service; "
                            "replace image_gemini.SEND in the test")


def test_a_keychain_lookup_fails_the_test(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    with pytest.raises(pytest.fail.Exception) as e:
        image_keys.find("gemini")
    assert str(e.value) == ("a test tried to reach the keychain; "
                            "replace image_keys.RUN in the test")


def test_no_real_key_is_in_the_environment():
    assert "GEMINI_API_KEY" not in os.environ
    assert "GOOGLE_API_KEY" not in os.environ
