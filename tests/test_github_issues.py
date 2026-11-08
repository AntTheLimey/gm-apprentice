"""github_issues.py: what GitHub says about an issue and a release, through
`gh` when it is installed and GitHub's REST API when it is not."""
import io
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path
from unittest import mock

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import github_issues  # noqa: E402
from github_issues import GitHub, Issue  # noqa: E402

ISSUE = {"state": "closed", "state_reason": "completed",
         "closed_at": "2026-11-04T10:00:00Z"}
RELEASE = {"published_at": "2026-11-04T12:00:00Z"}


@pytest.fixture
def gh_stub(tmp_path, monkeypatch):
    """A `gh` on PATH that answers `gh api <path>` from a table."""
    table = tmp_path / "answers.json"
    log = tmp_path / "gh.log"
    stub = tmp_path / "bin" / "gh"
    stub.parent.mkdir()
    stub.write_text(
        "#!/bin/sh\n"
        f'echo "$@" >> "{log}"\n'
        f'exec "{sys.executable}" -c "import json,sys; '
        f"t=json.load(open('{table}')); a=sys.argv[2]; "
        f"print(json.dumps(t[a])) if a in t else sys.exit(1)\" \"$@\"\n",
        encoding="utf-8")
    stub.chmod(0o755)
    monkeypatch.setenv("PATH", str(stub.parent))

    def answers(mapping):
        table.write_text(json.dumps(mapping), encoding="utf-8")
    answers({})
    return answers, log


def test_issue_and_release_through_gh(gh_stub):
    answers, log = gh_stub
    answers({"repos/AntTheLimey/gm-apprentice/issues/510": ISSUE,
             "repos/AntTheLimey/gm-apprentice/releases/tags/v1.10.129": RELEASE})
    hub = GitHub()
    assert hub.issue(510) == Issue("closed", "completed", "2026-11-04T10:00:00Z")
    assert hub.published("1.10.129") == "2026-11-04T12:00:00Z"
    hub.issue(510)   # asked once per run
    assert log.read_text().splitlines() == [
        "api repos/AntTheLimey/gm-apprentice/issues/510",
        "api repos/AntTheLimey/gm-apprentice/releases/tags/v1.10.129"]


def test_unknown_issue_or_release_is_none(gh_stub):
    hub = GitHub()
    assert hub.issue(9999) is None
    assert hub.published("9.9.9") is None


def test_without_gh_the_rest_api_is_asked(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))   # no gh here
    seen = []

    def urlopen(req, timeout):
        seen.append((req.full_url, req.get_header("Accept"), timeout))
        return io.BytesIO(json.dumps(ISSUE).encode())
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert GitHub(timeout=3).issue(510).state == "closed"
    assert seen == [("https://api.github.com/repos/AntTheLimey/gm-apprentice/issues/510",
                     "application/vnd.github+json", 3)]


def test_a_slow_answer_stops_further_asks(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    calls = []

    def urlopen(req, timeout):
        calls.append(req.full_url)
        raise TimeoutError("slow")
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    hub = GitHub()
    assert hub.issue(510) is None
    assert hub.issue(511) is None
    assert len(calls) == 1


def test_fixed_before_compares_times():
    issue = Issue("closed", "completed", "2026-11-04T10:00:00Z")
    assert github_issues.closed_before(issue, "2026-11-04T12:00:00Z")
    assert not github_issues.closed_before(issue, "2026-11-04T09:00:00Z")
    assert not github_issues.closed_before(Issue("closed", "completed", None),
                                           "2026-11-04T12:00:00Z")


def test_a_gh_that_cannot_answer_falls_back_to_the_rest_api(gh_stub, monkeypatch):
    # gh installed but not logged in exits 4; the public API still answers.
    seen = []

    def urlopen(req, timeout):
        seen.append(req.full_url)
        return io.BytesIO(json.dumps(ISSUE).encode())
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert GitHub().issue(510).state == "closed"
    assert seen == ["https://api.github.com/repos/AntTheLimey/gm-apprentice/issues/510"]


def test_a_connect_timeout_stops_further_asks(monkeypatch, tmp_path):
    import urllib.error
    monkeypatch.setenv("PATH", str(tmp_path))
    calls = []

    def urlopen(req, timeout):
        calls.append(req.full_url)
        raise urllib.error.URLError(TimeoutError("timed out"))
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    hub = GitHub()
    hub.issue(510)
    hub.published("1.0.0")
    assert len(calls) == 1


def test_a_pull_request_number_is_not_an_issue(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    pr = {**ISSUE, "state_reason": None, "pull_request": {"url": "x"}}
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout: io.BytesIO(json.dumps(pr).encode()))
    assert GitHub().issue(612) is None
