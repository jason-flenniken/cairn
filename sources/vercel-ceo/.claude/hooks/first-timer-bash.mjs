// PreToolUse hook for the first-timer agent: Bash may only run the app, its checks,
// and headless screenshots of localhost; Read may only open those screenshots.
// Everything else is blocked (exit 2), so the agent stays blind to the code.
//
// Template: edit the three settings below to match your app, and keep the commands
// listed in .claude/agents/first-timer.md in sync.
import { readFileSync } from "node:fs";

const PORT = 3000;
const RUN_COMMANDS = ["npm run dev", "npm run lint", "npm test"];
const CHROME = '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'; // macOS path

const { tool_name, tool_input } = JSON.parse(readFileSync(0, "utf8"));

if (tool_name === "Read") {
  if (!/^\/tmp\/first-timer-[\w-]+\.png$/.test(String(tool_input?.file_path ?? ""))) {
    process.stderr.write("Blocked: first-timer may only read its own screenshots at /tmp/first-timer-<name>.png.");
    process.exit(2);
  }
  process.exit(0);
}

const cmd = String(tool_input?.command ?? "").trim();

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FLAG = String.raw`--(?:headless=new|disable-gpu|hide-scrollbars|force-prefers-reduced-motion|window-size=\d{3,4},\d{3,5}|virtual-time-budget=\d{1,5})`;
const URL = String.raw`http://localhost:${PORT}(?:/[\w./?=%-]*)?`;

const ALLOWED = [
  ...RUN_COMMANDS.map((c) => new RegExp(`^${escape(c)}$`)),
  new RegExp(`^curl -sI ${URL}$`),
  new RegExp(`^${escape(CHROME)}(?: ${FLAG})* --screenshot=/tmp/first-timer-[\\w-]+\\.png ${URL}$`),
];

// No chaining, pipes, redirects, substitution, escapes, or multi-line commands.
const META = /[;&|<>`$\\\n\r]/;

if (META.test(cmd) || !ALLOWED.some((re) => re.test(cmd))) {
  process.stderr.write(
    `Blocked: first-timer may only run ${RUN_COMMANDS.map((c) => `"${c}"`).join(", ")}, ` +
      `"curl -sI http://localhost:${PORT}/...", or headless Chrome screenshots to /tmp/first-timer-<name>.png. ` +
      `Got: ${cmd.slice(0, 200)}`,
  );
  process.exit(2);
}
