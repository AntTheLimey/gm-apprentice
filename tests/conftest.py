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
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))


@pytest.fixture(autouse=True)
def _shared_state_stays_shared():
    vaultlib = sys.modules.get("vaultlib")
    if vaultlib is not None:
        vaultlib.use_publish_tool(vaultlib.PUBLISH_TOOL)
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
