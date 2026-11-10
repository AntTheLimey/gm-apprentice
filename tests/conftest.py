"""Two pieces of process-wide state that tests share, kept from leaking.

Under `pytest -n auto` each worker runs whatever tests it is handed, in
whatever order, so a test cannot count on a neighbour having left things
tidy. Both of these once made a test pass or fail by what ran before it.

- The publish tool the checks ask (`vaultlib.PUBLISH_LINES`) is a module
  global that a check points at its vault's site tool and leaves there. A
  test that points it at a throwaway site left it at a folder that was then
  deleted. Every test starts from the plugin's own tool, as a new run does.
- The site folder test vaults share (`site_fixture`) is made once, and
  fixtures built at import time rely on it as it was made. A test that
  changes it (a migration moves its settings out, a repin replaces its
  tool) needs `private=True`. The test that leaves it changed fails here,
  naming itself, and the folder is put back so the next test is not blamed.

A third piece is the system temp folder (#565): every folder
`tempfile.mkdtemp` makes in it while the tests run is noted and removed when
the process (each `-n auto` worker) exits, so no test has to remember its own
clean-up. Weeks of runs without it left over a million folders behind.
"""

import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

_MADE_TEMP_DIRS: list[str] = []
_TEMP_ROOT = os.path.realpath(tempfile.gettempdir())
_mkdtemp = tempfile.mkdtemp


def _mkdtemp_noted(*args, **kwargs):
    made = _mkdtemp(*args, **kwargs)
    full = os.path.realpath(os.fsdecode(made))
    # Only folders inside the temp folder: one a test makes inside its own fixture is left to it.
    if full.startswith(_TEMP_ROOT + os.sep):
        _MADE_TEMP_DIRS.append(full)
    return made


tempfile.mkdtemp = _mkdtemp_noted


@atexit.register
def _remove_made_temp_dirs():
    for made in _MADE_TEMP_DIRS:
        shutil.rmtree(made, ignore_errors=True)


# No test reaches the network or the real per-user cache for the publish
# tool: a copy of the skills without the tool would otherwise download the
# real release (tool_cache). A test that wants a fetch passes its own.
os.environ["GMA_CACHE"] = os.path.join(_TEMP_ROOT, f"gma-test-cache-{os.getpid()}")
_MADE_TEMP_DIRS.append(os.environ["GMA_CACHE"])
os.environ["GMA_RELEASE_BASE"] = "http://127.0.0.1:9/no-network-in-tests"


_SCRIPTS = str(Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts")
# The real seams as the modules first had them, before any test replaced one.
ORIGINAL: dict[str, object] = {}


@pytest.fixture(autouse=True)
def _no_picture_service_or_keychain(monkeypatch, tmp_path):
    """No test reaches the paid picture service (by `image_gemini.SEND` or
    by the sender's own `URLOPEN`), a real Codex (`image_codex.RUN`; tests
    see no Codex installed) or the real keychain, none sees a real
    key from the environment, and the key file folder is a temp one. A test
    that needs any of them replaces it itself (its own monkeypatch runs
    after this one), and sets a fake key the same way."""
    for var in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "gma-config"))
    added = _SCRIPTS not in sys.path
    if added:
        sys.path.append(_SCRIPTS)
    try:
        import image_codex
        import image_gemini
        import image_keys
    except Exception:  # noqa: BLE001 - a test that never draws pays nothing
        return
    finally:
        if added:
            sys.path.remove(_SCRIPTS)

    ORIGINAL.setdefault("SEND", image_gemini.SEND)

    def no_service(*a, **k):
        pytest.fail("a test tried to call the picture service; replace "
                    "image_gemini.SEND in the test", pytrace=False)

    def no_keychain(*a, **k):
        pytest.fail("a test tried to reach the keychain; replace "
                    "image_keys.RUN in the test", pytrace=False)
    def no_connection(*a, **k):
        pytest.fail("a test tried to open a connection for the picture "
                    "service; replace image_gemini.URLOPEN in the test",
                    pytrace=False)
    monkeypatch.setattr(image_gemini, "SEND", no_service)
    monkeypatch.setattr(image_gemini, "URLOPEN", no_connection)
    monkeypatch.setattr(image_keys, "RUN", no_keychain)

    def no_codex(*a, **k):
        pytest.fail("a test tried to run Codex; replace image_codex.RUN in "
                    "the test", pytrace=False)
    # As a machine with no Codex: a test that wants one replaces WHICH too.
    monkeypatch.setattr(image_codex, "RUN", no_codex)
    monkeypatch.setattr(image_codex, "WHICH", lambda *a, **k: None)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    # Picture jobs that fall back to the temp folder stay in this test's own.
    import image_jobs
    monkeypatch.setattr(image_jobs, "TEMP", lambda: str(tmp_path / "tmp"))


@pytest.fixture(autouse=True)
def _test_vaults_may_be_stamped_old(request):
    """Most tests stamp vaults at made-up old versions; the update's real
    floor (vault_check.MOVED_FLOOR) would refuse them all. A module that tests the floor
    itself sets REAL_FLOOR_TESTS."""
    vault_check = sys.modules.get("vault_check")
    if vault_check is None or getattr(request.module, "REAL_FLOOR_TESTS", False):
        yield
        return
    real = vault_check.MOVED_FLOOR
    vault_check.MOVED_FLOOR = "1.10.12"
    try:
        yield
    finally:
        vault_check.MOVED_FLOOR = real


@pytest.fixture(autouse=True)
def _shared_state_stays_shared():
    vaultlib = sys.modules.get("vaultlib")
    if vaultlib is not None:
        vaultlib.use_publish_tool(vaultlib.PUBLISH_TOOL)
        vaultlib.forget_settings(None)
    yield
    import site_fixture
    problem = site_fixture.shared_site_problem()
    if problem:
        site_fixture.restore_shared_site()
        pytest.fail(
            f"this test changed the site folder every test shares: "
            f"{problem}. Give its vault a private site "
            f"(site_fixture.give_site(..., private=True)).",
            pytrace=False)
