"""github_issues.py: what GitHub says about a gm-apprentice issue and a release.

The workaround checks ask here whether an issue was fixed, and when a
release came out, rather than reading release notes: an install made with
`npx skills` carries no CHANGELOG, and GitHub is where the answer lives.
`gh` is asked when it is installed (it may hold a login); otherwise GitHub's
public REST API, which needs none. Any failure is None, never an error: the
caller says it could not check. A slow answer stops further asks this run.
Library module, no CLI.
"""

from __future__ import annotations

import datetime
import http.client
import json
import shutil
import subprocess
import urllib.error
import urllib.request
from typing import Any, NamedTuple

REPO = "AntTheLimey/gm-apprentice"
API = "https://api.github.com"
TIMEOUT = 5.0   # seconds per question


class Issue(NamedTuple):
    state: str               # "open" or "closed"
    reason: str | None       # "completed", "not_planned", ... when closed
    closed_at: str | None    # ISO time, when closed


class GitHub:
    """One per run; each answer is kept."""

    def __init__(self, timeout: float = TIMEOUT) -> None:
        self.timeout = timeout
        self.gh = shutil.which("gh")
        self.slow = False
        self.seen: dict[str, dict[str, Any] | None] = {}

    def _get(self, path: str) -> dict[str, Any] | None:
        if path in self.seen:
            return self.seen[path]
        found: Any = None
        if not self.slow and self.gh is not None:
            found = self._ask_gh(path)
        if not self.slow and found is None:
            # No gh, or one that could not answer (not logged in, an
            # expired token): the public API needs no login.
            found = self._ask_api(path)
        self.seen[path] = found if isinstance(found, dict) else None
        return self.seen[path]

    def _ask_gh(self, path: str) -> Any:
        try:
            # github.com always: GH_HOST may name a company's own GitHub.
            done = subprocess.run([str(self.gh), "api", "--hostname",
                                   "github.com", path],
                                  capture_output=True, text=True,
                                  timeout=self.timeout, check=False)
            return json.loads(done.stdout) if done.returncode == 0 else None
        except subprocess.TimeoutExpired:
            self.slow = True
        except (OSError, ValueError):
            pass
        return None

    def _ask_api(self, path: str) -> Any:
        req = urllib.request.Request(
            f"{API}/{path}", headers={"Accept": "application/vnd.github+json",
                                      "User-Agent": "gm-apprentice"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.load(r)
        except TimeoutError:
            self.slow = True
        except urllib.error.URLError as e:
            # A connect timeout arrives wrapped.
            if isinstance(e.reason, TimeoutError):
                self.slow = True
        except (OSError, ValueError, http.client.HTTPException):
            pass
        return None

    def issue(self, number: int) -> Issue | None:
        data = self._get(f"repos/{REPO}/issues/{number}")
        state = data.get("state") if data else None
        # A pull request's number answers here too; it is not an issue.
        if not isinstance(state, str) or "pull_request" in data:  # type: ignore[operator]
            return None
        reason, closed = data.get("state_reason"), data.get("closed_at")  # type: ignore[union-attr]
        return Issue(state.lower(),
                     reason if isinstance(reason, str) else None,
                     closed if isinstance(closed, str) else None)

    def published(self, version: str) -> str | None:
        """When release v<version> was published, or None."""
        data = self._get(f"repos/{REPO}/releases/tags/v{version}")
        when = data.get("published_at") if data else None
        return when if isinstance(when, str) else None


FIXED = ("completed", None)   # closed as done; None: closed before reasons existed


def _when(iso: str) -> datetime.datetime | None:
    try:
        return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def closed_before(issue: Issue, published: str) -> bool:
    """Whether the issue was closed no later than `published`."""
    closed = _when(issue.closed_at) if issue.closed_at else None
    out = _when(published)
    return closed is not None and out is not None and closed <= out
