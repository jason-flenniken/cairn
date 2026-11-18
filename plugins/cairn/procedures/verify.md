# Check

Prove the finished build works: tests and build, the proofs (the end state agreed before the build), then one pass over the PRD's acceptance checks. Fix what fails without asking (`references/autonomy.md`).

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: step 2 runs `cairn test`. A red suite is not a blocker: it goes to step 6 with its hardening item (which `cairn test` files) and the note lists it as a known failure, not to the fix loop in step 5. Steps 3 and 4 run as written; the scan and audit are floors.
- Standard: as written below.
- Polished: every requirement must be met and tested. Treat "met but untested" in step 4 as blocking and fix it in step 5. UI work is checked in the app or browser through its proofs (step 3a).

## 1. Check
Run `cairn status --json`. The stage must be `verify`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `verify`.

## 1a. The last phase's wrap-up
The last phase finished without a suite run or an on-track check: they run here, once. When you arrive from the build, say in one line that every task is merged and the plan is in Check, running the full suite first.

- When `cairn status --json` shows `state.linear`, re-read the plan's issues first, exactly as `procedures/phase-end.md` step 1 describes, unless the plan reached Check through `cairn phase finish` after that refresh just ran (the `linear-sender` "phase-end refresh" in the foreground, then each change decided by you, as that step says). `cairn evidence verify pass` refuses while a change is not handled; when you have chosen for each, run it with `--call "<what you chose, and why>"`.
- Polished: the last phase's on-track check runs after the tests, in step 2a.

**Done when:** Linear changes are handled, or there is no Linear link.

## 2. Tests and build
Run `cd <plan worktree> && cairn step testing && cairn test` in one call. It runs the repo's test command (and the build command when `build` is set) and prints the counts and the failure tail; a red run's full output goes to the log named after "Full output:". With no test command, it says so; continue.

**Done when:** you hold the pass/fail counts from a run made in this step. On failure, fix in place (step 5) before continuing.

## 2a. The last phase's on-track check (Polished)
Below Polished, skip this step. Run `cd <plan worktree> && cairn step on-track`, sent in the same message as the first dispatch of the on-track check for the last phase: follow `procedures/direction.md` with that phase's id, ending with `cairn evidence phase`. A red result is fixed in step 5 like any other blocking finding, then checked again; `cairn evidence verify pass` refuses while it is red.

**Done when:** below Polished, or the last phase's on-track check is recorded.

## 3. Security scan and dependency audit
Run `cd <plan worktree> && cairn step scanning`, sent in the same message as the first command of the scan (for example the `git diff` or the audit command). Read the Secrets section of `references/security-checklist.md`, and the `[deps]` section when the branch touches a manifest or lockfile. Work from the branch diff, `git diff <base>...<plan branch>`, in the plan worktree.

- **Secret scan.** The output of every scan command must contain only the file, the line and the kind, never the matched text. Do not run a bare `grep`, `grep -n` or `git diff | grep` over the diff, and do not open a hit to double-check it: if the kind looks doubtful, report it as found and let the user look.
  1. Count the added lines that look like a secret (a number only):
     ```sh
     git diff <base>...<plan branch> -U0 --no-color | grep -E '^\+' | grep -cE -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -e 'AKIA[0-9A-Z]{16}' -e 'gh[pousr]_[A-Za-z0-9]{36}' -e 'xox[abprs]-[A-Za-z0-9-]{10}' -e '[sr]k_(live|test)_[A-Za-z0-9]{16}' -e "(password|secret|api_key) *[=:] *[\"'][^\"' ]{4}"
     ```
  2. List where they are, as `file:line:kind` only (private key header, AWS, GitHub, Slack and Stripe-style tokens, `password`, `secret` and `api_key` assignments with a literal value). Run it as written: the patterns are built in `BEGIN` because mawk, Debian's default awk, matches nothing with `{n}` repeats:
     ```sh
     git diff <base>...<plan branch> -U0 --no-color | awk '
     function rep(c,k,  r){r="";while(k-->0)r=r c;return r}
     BEGIN{aws="AKIA" rep("[0-9A-Z]",16);gh="gh[pousr]_" rep("[A-Za-z0-9]",36);sl="xox[abprs]-" rep("[A-Za-z0-9-]",10)
       st="[sr]k_(live|test)_" rep("[A-Za-z0-9]",16);cr="(password|secret|api_key)[ ]*[=:][ ]*[\"\047]" rep("[^\"\047 ]",4)}
     /^\+\+\+ b\//{f=substr($0,7);next}
     /^@@/{match($0,/\+[0-9]+/);n=substr($0,RSTART+1,RLENGTH-1)+0;next}
     /^\+/{l=substr($0,2);k=""
       if(l~/-----BEGIN [A-Z ]*PRIVATE KEY-----/)k="private key"
       else if(l~aws)k="aws key"
       else if(l~gh)k="github token"
       else if(l~sl)k="slack token"
       else if(l~st)k="stripe key"
       else if(l~cr)k="literal credential"
       if(k!="")print f":"n":"k
       n++}'
     ```
  3. Added `.env` files, by path only: `git diff --name-only --diff-filter=A <base>...<plan branch> | grep -E '(^|/)\.env($|\.)'`.
  A secret in the diff blocks: remove it in step 5. A committed secret counts as leaked: remove it in step 5, then record it so the pull request says so: `cd <plan worktree> && cairn pr not-done "A secret was committed and counts as leaked: <file:line:kind>" --why "removed from the diff; revoke it"`, and `cairn suggest add --area security --from check --text "Revoke the <kind> secret committed at <file:line>"`. Do not ask.
- **Dependency audit.** Run the `audit` command from `.cairn/config.json` when it is set. Otherwise detect it from the lockfile: `package-lock.json` runs `npm audit --omit=dev --audit-level=high`, `pnpm-lock.yaml` runs `pnpm audit`, `yarn.lock` runs `yarn npm audit` (berry) or `yarn audit` (v1), `Cargo.lock` runs `cargo audit` when installed, and a pinned `requirements*.txt` runs `pip-audit --no-deps --disable-pip -r <file>` when installed (that form installs nothing; it needs every requirement pinned with `==`, so skip an unpinned file with a one-line note). `poetry.lock` is not audited unless the config sets a command. Run the audit command only: never an install, never an audit fix (no `npm audit fix --force`), and never `pip-audit` without `--no-deps --disable-pip` (it builds the packages in a temp environment, which can run their build scripts).
- **Triage by reachability.** A critical or high advisory in code the build reaches blocks: fix it in step 5. Everything else is logged: `cairn suggest add --area security --from check --where <lockfile> --text "<advisory and package>"`.
- **Lockfile diff.** When the branch changes a lockfile, list the new and bumped packages. Flag install scripts and names that look like a typosquat.
- **No audit tool.** With no configured command and no known audit for the stack, say in one line that the audit was skipped and why, then go on.
- **Registry unreachable.** Retry the audit once. When it still can't reach the registry, record it (`cairn pr not-done "The dependency audit could not run" --why "registry unreachable after one retry; run the audit by hand"`) and go on.

**Done when:** the scan, the audit (or its one-line skip) and the lockfile review each have a result, and every blocking finding is queued for step 5.

## 3a. Proofs
Skip when `cairn prove list` says the plan has no proofs. Otherwise run `cd <plan worktree> && cairn step testing && cairn prove` in one call. It runs every proof on the plan branch and prints one line per proof.
- **A red proof:** blocking. The line ends with "Full output: <log>". Queue it for step 5 with its log path.
- **Screenshots:** for each proof that passed and takes screenshots, the line names the folder and what they must show. Dispatch one `visual-checker` (`model: sonnet`, `description` "Check · screenshots") for all of them, with each proof's id, folder, screenshot names and `look`, and the report path `<work folder>/reports/screenshots.md`. Record each verdict line it ends with: `cd <plan worktree> && cairn prove judge <id> pass|fail --note "<what differs>"`. A fail is blocking: queue it for step 5.

`cairn advance` refuses to leave the check stage until every proof is green on the current code and its screenshots are judged pass.

**Done when:** every proof passed and every screenshot was judged, or the failures are queued for step 5.

## 4. Acceptance checks
Dispatch the `acceptance-checker` agent (`model: sonnet`, `description` "Check · acceptance") with the path to `prd.md`, the plan worktree path, and the report path `<plan worktree>/.cairn/work/<slug>/reports/acceptance.md`. It walks each requirement's `Check:` and writes met / met but untested / not met, each with `path:line`, to the report; it returns the counts and the unmet requirements by name.

- **Not met:** blocking. Fix it in place (step 5).
- **Met but untested:** log each as a suggestion and move on: `cairn suggest add --area tests --from check --where <glob> --text "<what lacks a test>"` (the report lists them under "Met but untested"; read only that section).

**Done when:** every requirement has a verdict, and every "met but untested" item is logged.

## 5. Fix what is blocking
Skip when tests are green, every proof is green and judged, nothing is not met, no secret was found, and no reachable critical or high advisory remains. Otherwise run `cd <plan worktree> && cairn step fixing --count N` (N is the number of failing tests, unmet requirements, secrets and advisories to fix), sent in the same message as the dispatch of one `implementer` (`model: sonnet`, `description` "Fix · acceptance") on the plan worktree itself. It commits directly on the plan branch; there is no new task, phase, or re-plan. Its prompt names the plugin root, the report path `<work folder>/reports/verify-fix.md`, the acceptance report path for unmet requirements, each red proof's id, command and log path, each failed screenshot verdict with what differs (proof files are locked: the fix changes the code, never a proof), the path after "Full output:" (the full failing test log; implementers never run `cairn`), and in a few lines the failing tests, the secret finding (file and line only) or the advisory; tell it to add a test for the fix. Then rerun step 2 (`cairn test`), step 3's blocking findings, step 3a's red and failed proofs (`cairn prove`, then judge again) and step 4's unmet items once more.

When something is still failing after that attempt, dispatch one more fix, one tier up (`opus`), with the new logs. Two attempts is the limit. When something still fails after the second, record it and go on (`references/autonomy.md`): a red suite or a red proof goes through with `--not-done "<why; what was tried; the fix you propose>"` on the command that checks it (`cairn evidence verify pass`, `cairn advance`); a requirement still not met, or a screenshot still failing, is recorded with `cairn pr not-done "<the requirement or screenshot>" --why "<why; what was tried; the fix you propose>"`, and also goes in the note of step 6 and the record's Findings.

**A locked proof that is itself wrong.** When the code is right and the locked proof is what is wrong, do not weaken it. Add a corrected copy with `cd <plan worktree> && cairn prove add <new-id> --covers <FR ids> --run "<command>" --files <paths> --note "<what was wrong>"` (it must cover every requirement the old one covers), and run it green. Never retire the old one: it stays red. Pass it with `--not-done "<which proof is wrong, why, and that <new-id> replaces it>"` on the command that checks it, so the pull request lists it and the user retires it after the merge.

**Done when:** tests are green and no requirement is not met, or what is left is recorded as not done.

## 6. Record the result
Run `cairn evidence verify pass --note "<tests: N passing; proofs: N green; M requirements met, K untested; secret scan: clean or N found; audit: result or skipped>"`. List any requirement still not met in the note, by id (each already recorded with `cairn pr not-done`). Then run `cairn advance`; a red proof makes it refuse, and the fix attempts of step 5 are used up, pass it with `--not-done`.

**Done when:** the stage is `review`. Then run `cairn next --json`. Follow the procedure it names.
