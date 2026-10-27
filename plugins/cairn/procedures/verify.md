# Check

Prove the finished build works: tests and build, then one pass over the PRD's acceptance checks.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: in step 2 run the suite with `cd <plan worktree> && cairn test` instead of the bare test command. A red suite is not a blocker: it goes to step 6 with its hardening item (which `cairn test` files) and the note lists it as a known failure, not to the fix loop in step 5. Steps 3 and 4 run as written; the scan and audit are floors.
- Standard: as written below.
- Polished: every requirement must be met and tested. Treat "met but untested" in step 4 as blocking and fix it in step 5. App or browser verification is added when cairn can run it.

## 1. Check
Run `cairn status --json`. The stage must be `verify`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `verify`.

## 2. Tests and build
Run `cd <plan worktree> && cairn step testing`. Then run the repo's test command (`test` in `.cairn/config.json`) in the plan worktree, and the build command when `build` is set. Read the output and the exit code. With no test command, say so in one line and continue.

**Done when:** you hold the pass/fail counts from a run made in this step. On failure, fix in place (step 5) before continuing.

## 3. Security scan and dependency audit
Run `cd <plan worktree> && cairn step scanning`. Then read the Secrets section of `references/security-checklist.md`, and the `[deps]` section when the branch touches a manifest or lockfile. Work from the branch diff, `git diff <base>...<plan branch>`, in the plan worktree.

- **Secret scan.** The output of every scan command must contain only the file, the line and the kind, never the matched text. Do not run a bare `grep`, `grep -n` or `git diff | grep` over the diff, and do not open a hit to double-check it: if the kind looks doubtful, report it as found and let the user look.
  1. Count the added lines that look like a secret (a number only):
     ```sh
     git diff <base>...<plan branch> -U0 --no-color | grep -E '^\+' | grep -cE -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -e 'AKIA[0-9A-Z]{16}' -e 'gh[pousr]_[A-Za-z0-9]{36}' -e 'xox[abprs]-[A-Za-z0-9-]{10}' -e '[sr]k_(live|test)_[A-Za-z0-9]{16}' -e "(password|secret|api_key) *[=:] *[\"'][^\"' ]{4}"
     ```
  2. List where they are, as `file:line:kind` only (private key header, AWS, GitHub, Slack and Stripe-style tokens, `password`, `secret` and `api_key` assignments with a literal value):
     ```sh
     git diff <base>...<plan branch> -U0 --no-color | awk '
     /^\+\+\+ b\//{f=substr($0,7);next}
     /^@@/{match($0,/\+[0-9]+/);n=substr($0,RSTART+1,RLENGTH-1)+0;next}
     /^\+/{l=substr($0,2);k=""
       if(l~/-----BEGIN [A-Z ]*PRIVATE KEY-----/)k="private key"
       else if(l~/AKIA[0-9A-Z]{16}/)k="aws key"
       else if(l~/gh[pousr]_[A-Za-z0-9]{36}/)k="github token"
       else if(l~/xox[abprs]-[A-Za-z0-9-]{10}/)k="slack token"
       else if(l~/[sr]k_(live|test)_[A-Za-z0-9]{16}/)k="stripe key"
       else if(l~/(password|secret|api_key)[ ]*[=:][ ]*["\047][^"\047 ]{4}/)k="literal credential"
       if(k!="")print f":"n":"k
       n++}'
     ```
  3. Added `.env` files, by path only: `git diff --name-only --diff-filter=A <base>...<plan branch> | grep -E '(^|/)\.env($|\.)'`.
  A secret in the diff blocks: remove it in step 5. A committed secret counts as leaked, so tell the user to revoke it.
- **Dependency audit.** Run the `audit` command from `.cairn/config.json` when it is set. Otherwise detect it from the lockfile: `package-lock.json` runs `npm audit --omit=dev --audit-level=high`, `pnpm-lock.yaml` runs `pnpm audit`, `yarn.lock` runs `yarn npm audit` (berry) or `yarn audit` (v1), `Cargo.lock` runs `cargo audit` when installed, and a pinned `requirements*.txt` runs `pip-audit --no-deps --disable-pip -r <file>` when installed (that form installs nothing; it needs every requirement pinned with `==`, so skip an unpinned file with a one-line note). `poetry.lock` is not audited unless the config sets a command. Run the audit command only: never an install, never an audit fix (no `npm audit fix --force`), and never `pip-audit` without `--no-deps --disable-pip` (it builds the packages in a temp environment, which can run their build scripts).
- **Triage by reachability.** A critical or high advisory in code the build reaches blocks: fix it in step 5. Everything else is logged: `cairn suggest add --area security --from check --where <lockfile> --text "<advisory and package>"`.
- **Lockfile diff.** When the branch changes a lockfile, list the new and bumped packages. Flag install scripts and names that look like a typosquat.
- **No audit tool.** With no configured command and no known audit for the stack, say in one line that the audit was skipped and why, then go on.
- **Registry unreachable.** When the audit can't reach the registry, stop and ask with AskUserQuestion: Retry / Skip with a note / Pause.

**Done when:** the scan, the audit (or its one-line skip) and the lockfile review each have a result, and every blocking finding is queued for step 5.

## 4. Acceptance checks
Dispatch the `acceptance-checker` agent (`model: sonnet`, `description` "Check · acceptance") with the path to `prd.md` and the plan worktree path. It walks each requirement's `Check:` and returns met / met but untested / not met, each with `path:line`.

- **Not met:** blocking. Fix it in place (step 5).
- **Met but untested:** log it as a suggestion and move on: `cairn suggest add --area tests --from check --where <glob> --text "<what lacks a test>"`.

**Done when:** every requirement has a verdict, and every "met but untested" item is logged.

## 5. Fix what is blocking
Skip when tests are green, nothing is not met, no secret was found, and no reachable critical or high advisory remains. Otherwise run `cd <plan worktree> && cairn step fixing --count N` (N is the number of failing tests, unmet requirements, secrets and advisories to fix), then dispatch one `implementer` (`model: sonnet`, `description` "Fix · acceptance") on the plan worktree itself. It commits directly on the plan branch; there is no new task, phase, or re-plan. Brief it with the failing tests, the unmet requirement and its Check line, or the secret finding (file and line only) or advisory, and tell it to add a test for the fix. Then rerun step 2, step 3's blocking findings and step 4's unmet items once more.

If it is still failing after that one attempt, stop and ask the user with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Pause.

**Done when:** tests are green and no requirement is not met, or the user chose how to proceed.

## 6. Record the result
Run `cairn evidence verify pass --note "<tests: N passing; M requirements met, K untested; secret scan: clean or N found; audit: result or skipped>"`, or `cairn evidence verify fail --note "<one line>"` when the user stops here. Then run `cairn advance`.

**Done when:** the stage is `review`. Then run `cairn next --json` and follow the procedure it names.
