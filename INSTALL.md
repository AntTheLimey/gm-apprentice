# Installing gm-apprentice: steps for an AI agent

A GM asked you to install gm-apprentice, the Game Master skills, on this
machine. Follow these steps in order, and do not improvise an alternative
to any of them. If step 3 fails, stop and show the GM the error. Speak to
the GM in plain words: they run tabletop games and may not be a
programmer.

1. **Preflight.** Run `python3 --version`. If it fails, or is older than
   3.10, stop and tell the GM to install Python 3.10 or newer:
   - on Windows, from the Microsoft Store (its `python3` is the one the
     skills call; the python.org installer gives only `python` and `py`);
   - on a Mac, from <https://www.python.org> or Homebrew (the `python3` a
     Mac comes with is 3.9);
   - elsewhere, from <https://www.python.org> or the system's package
     manager.

   Run `node --version`. If Node is missing or older than 22.21, tell the
   GM it is needed only for a campaign website (<https://nodejs.org>),
   and carry on.
2. **Work out which agent you are:** Claude Code, Codex, or another.
3. **Install for the GM's user,** so every campaign folder has it, and
   bring it up to the latest release. Run every line for your agent, in
   order, even when gm-apprentice is already there. "Already added" or
   "already installed" is fine: carry on to the next line, which updates
   an older install and changes nothing on a new one.
   - Claude Code: `claude plugin marketplace add AntTheLimey/gm-apprentice`,
     then `claude plugin install gm-apprentice@gm-apprentice`, then
     `claude plugin marketplace update gm-apprentice`, then
     `claude plugin update gm-apprentice@gm-apprentice --scope user` (the
     scope matters: without it the update may go to a copy installed for
     one project instead).
   - Codex: `codex plugin marketplace add AntTheLimey/gm-apprentice`,
     then `codex plugin marketplace upgrade gm-apprentice`, then
     `codex plugin add gm-apprentice@gm-apprentice`.
   - Any other agent: `npx -y skills add AntTheLimey/gm-apprentice --all -g`
     (it installs the latest release over an older one).
     `npx` comes with Node: if it is missing, stop and tell the GM this
     install needs Node (<https://nodejs.org>) even without a campaign
     website.
4. **Check the install.** Find the `gma.py` you just installed, in the
   newest version folder:
   - Claude Code: `claude plugin list --json` lists one entry per
     install; take the `installPath` of the `gm-apprentice@gm-apprentice`
     entry whose `scope` is `user`. It is at
     `skills/shared/scripts/gma.py` under it.
   - Codex: under `$CODEX_HOME/plugins/cache/gm-apprentice/` (`~/.codex`
     when `CODEX_HOME` is not set).
   - Any other agent: `~/.agents/skills/shared/scripts/gma.py`.

   Run `python3 "<that path>" doctor` and show the GM its output. If a
   line says `fail`, tell the GM what it says and stop. If one says
   `warn`, tell them and carry on. If it says `unknown command 'doctor'`,
   that `gma.py` is older than 1.12.104: step 3's update did not reach
   it. Run step 3's lines again once, then this step; if it still says
   so, stop and show the GM both outputs.
5. **Finish.** Tell the GM the skills load in a new session (in Claude
   Code, also after `/reload-plugins`), list any step you skipped with
   the command that finishes it later, and give them the next step: say
   "help me start a new campaign".
