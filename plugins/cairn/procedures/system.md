# System overview

Write or refresh `docs/cairn/SYSTEM.md`: a generated, high-level overview of the whole system for an engineer or agent who is new to it. It is organized by capability, never by folder, and regenerated on request rather than kept by hand. It never refreshes at ship; session start says when it is behind.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn system --json`, adding `--full` when the user asked for a full rebuild (the argument `full`).

If `current` is true, tell the user the overview is current and the commit it was built from, and stop.

**Done when:** you know whether the overview is current, and if not, whether this is a full rebuild or an update.

## 2. Write
Dispatch the `system-writer` agent with `model: "sonnet"`. Its brief names only: the checkout root, whether this is a full rebuild (`--full`) or an update, and the plugin root. The agent runs `cairn system --json` itself and reads what it needs. Do not paste the brief's lists or any file content into the prompt, and do not read SYSTEM.md yourself.

**Done when:** the agent reports the path, the word count, and the sections it wrote or changed.

## 3. Report
Tell the user, in two or three lines: written or updated, the sections that changed, the word count, and that the file is not committed. Offer to commit it on the current branch.

**Done when:** the user has the outcome and the commit offer.
