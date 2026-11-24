#!/usr/bin/env python3
"""Fail a CI job whose tests left things in the system temp folder (#565).

    python scripts/temp_guard.py snapshot FILE   # before the tests
    python scripts/temp_guard.py check FILE      # after: lists what is new

The tests clean up after themselves (tools/publish/test/helpers/temp-cleanup.js
and tests/conftest.py remove every temp folder a test process makes); this
catches what gets past them, such as a folder made by a process a test starts.
Weeks of runs before that clean-up left over a million folders behind.

Some names are allowed to appear: Node's compile cache and pytest's own base
folder for `tmp_path`, which are each made once and reused, not one per run,
the `com.apple.*` folders macOS's own services make in the same folder
while the tests run, and the `systemd-private-*` folders a Linux runner's own
services make there.
"""

import fnmatch
import os
import sys
import tempfile

# scoped_dir* and contentlinkingd: a Mac Chrome driven over --remote-debugging-pipe
# writes these outside TMPDIR, and they can't be told from the GM's own running
# Chrome's, so the tests must not delete them; on a CI runner they are harmless.
# betaenrollmentagent and diagnosticextensionsd: macOS services on the runner make
# these whenever they wake, tests or not (they failed macOS jobs whose tests all
# passed, Nov 2026).
# com.google.GoogleUpdater.*: Google's updater service, which a Chrome left running for a
# whole test file wakes (#866); it writes its own fetch files on its own schedule, and
# they can't be told from the ones it makes for the GM's own Chrome, so they are not ours
# to delete.
# CFNetworkDownload_*.tmp: a download by a macOS service through Apple's network library
# (failed the macOS job of #871, whose tests all passed and fetch nothing).
ALLOWED = ("node-compile-cache", "pytest-of-*", "com.apple.*", "systemd-private-*",
           "scoped_dir*", "contentlinkingd", "betaenrollmentagent", "diagnosticextensionsd",
           "com.google.GoogleUpdater.*", "CFNetworkDownload_*")


def entries() -> set[str]:
    return set(os.listdir(tempfile.gettempdir()))


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("snapshot", "check"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    mode, path = argv[1], argv[2]
    if mode == "snapshot":
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(sorted(entries())))
        return 0
    with open(path, encoding="utf-8") as f:
        before = set(f.read().splitlines())
    new = sorted(
        name for name in entries() - before
        if not any(fnmatch.fnmatch(name, pattern) for pattern in ALLOWED)
    )
    if not new:
        print(f"temp folder: nothing left behind ({tempfile.gettempdir()})")
        return 0
    print(f"::error::the tests left {len(new)} entries in the temp folder "
          f"{tempfile.gettempdir()} (#565):")
    for name in new[:50]:
        print(f"  {name}")
    if len(new) > 50:
        print(f"  ... and {len(new) - 50} more")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
