import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cmdAdvance,
  cmdApprove,
  cmdClose,
  cmdDecide,
  cmdDriftAck,
  cmdEscalate,
  cmdLevel,
  cmdMigrate,
  cmdMergeCheck,
  cmdTrace,
  cmdEvidence,
  cmdIndex,
  cmdNew,
  cmdNext,
  cmdPause,
  cmdPhase,
  removed,
  cmdStep,
  cmdTest,
  cmdSuggest,
  cmdPlanLoad,
  cmdProductInit,
  cmdReady,
  cmdRecords,
  cmdRepro,
  cmdRender,
  cmdResume,
  cmdTask,
  cmdStatus,
  cmdLinear,
  context,
  hookPostEdit,
  hookSessionStart,
  type Opts,
  type Result,
} from './commands.ts';
import { CliError, Refusal } from './util.ts';
import { due } from './linear.ts';
import { loadState } from './state.ts';
import { procedurePath } from './commands/status.ts';

const BOOLEAN = new Set(['json', 'all', 'replan', 'now', 'no-worktree', 'human', 'open', 'dismiss', 'lasting', 'refresh', 'board', 'merge', 'links']);
/** Flags that may repeat; the values are joined with newlines. */
const REPEATABLE = new Set(['where', 'for']);

export function parseArgs(argv: string[], cwd = process.cwd()): { pos: string[]; opts: Opts } {
  const pos: string[] = [];
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (BOOLEAN.has(name)) opts[name] = true;
    else {
      if (inline === undefined && i + 1 >= argv.length) throw new CliError(`--${name} needs a value`);
      const v = inline ?? argv[++i];
      const prev = opts[name];
      opts[name] = REPEATABLE.has(name) && typeof prev === 'string' ? `${prev}\n${v}` : v;
    }
  }
  const noteFile = opts['note-file'];
  if (typeof noteFile === 'string') {
    try {
      opts.note = readFileSync(resolve(cwd, noteFile), 'utf8');
    } catch (e) {
      throw new CliError(`cannot read --note-file ${noteFile}: ${(e as Error).message}`);
    }
  }
  const textFile = opts['text-file'];
  if (typeof textFile === 'string') {
    try {
      opts.text = readFileSync(resolve(cwd, textFile), 'utf8');
    } catch (e) {
      throw new CliError(`cannot read --text-file ${textFile}: ${(e as Error).message}`);
    }
  }
  return { pos, opts };
}

const USAGE = `cairn: plan state for the agent-driven lifecycle. See references/cli.md.
  next | status [--all] | new <slug> --title "…" [--from <branch> | --after <plan>] | product init | decide "<q>" "<a>" [--why] | decide --file <path>
  approve prd|plan|ship | level mvp|standard|polished [--human] | advance [--to <stage>] | plan load [--replan] | ready
  task start|step|done <id> | test | step <name> [--count N] | phase finish | evidence verify|review pass|fail | evidence phase | drift ack <path>|--all
  suggest add|list|resolve|merge|decline …
  index | pause [--now] | resume [<slug>] | close | render | records | migrate
  merge-check (right before merging the PR) | trace <path>:<start>[-<end>] [--base <branch>]
  repro "<command>" | escalate (fix plans)
  linear [status] | linear import|pending|sent|drop|depends|ack|release|board … (plans that pull Linear issues in)
Flags: --json, --note "…", --note-file <path>, --override "reason" (only when the user chose to skip a check)`;

/** Commands that move a plan along, and so may queue Linear updates: each says when updates are waiting to be sent. */
const MOVES = new Set(['task', 'phase', 'ready', 'advance', 'approve', 'plan']);

/** Appends "N Linear updates queued" to a result, so a build loop that never runs `cairn next` still sends them. */
function withLinearDue(cmd: string | undefined, cwd: string, r: Result): Result {
  if (!cmd || !MOVES.has(cmd)) return r;
  try {
    const ctx = context(cwd);
    if (!ctx.plan?.dir) return r;
    const n = due(loadState(ctx.plan.dir).linear).length;
    if (!n) return r;
    const line = `${n} Linear update${n === 1 ? '' : 's'} queued: send ${n === 1 ? 'it' : 'them'} now (follow ${procedurePath('linear-sync')}).`;
    return { message: r.message ? `${r.message}\n${line}` : line, data: { ...r.data, linearDue: n } };
  } catch {
    return r;
  }
}

/** `stdin` is what `cairn linear import` was piped; main() reads it, never run(). */
export function run(argv: string[], cwd = process.cwd(), stdin?: string): Result {
  const { pos } = parseArgs(argv, cwd);
  return withLinearDue(pos[0], cwd, dispatch(argv, cwd, stdin));
}

function dispatch(argv: string[], cwd: string, stdin?: string): Result {
  const { pos, opts } = parseArgs(argv, cwd);
  if (stdin !== undefined) opts.stdin = stdin;
  const [cmd, a, b, ...rest] = pos;
  const ctx = () => context(cwd);
  switch (cmd) {
    case 'next':
      return cmdNext(ctx());
    case 'status':
      return cmdStatus(ctx(), opts);
    case 'new':
      return cmdNew(ctx(), a, opts);
    case 'product':
      if (a !== 'init') throw new CliError('usage: cairn product init');
      return cmdProductInit(ctx());
    case 'decide':
      return cmdDecide(ctx(), a, b, opts);
    case 'approve':
      return cmdApprove(ctx(), a, opts);
    case 'level':
      return cmdLevel(ctx(), a, opts);
    case 'advance':
      return cmdAdvance(ctx(), opts);
    case 'plan':
      if (a !== 'load') throw new CliError('usage: cairn plan load [--replan]');
      return cmdPlanLoad(ctx(), opts);
    case 'ready':
      return cmdReady(ctx());
    case 'repro':
      return cmdRepro(ctx(), a, opts);
    case 'escalate':
      return cmdEscalate(ctx(), opts);
    case 'task':
      return cmdTask(ctx(), a, b, rest, opts);
    case 'evidence':
      return cmdEvidence(ctx(), a, b, opts);
    case 'step':
      return cmdStep(ctx(), a, opts);
    case 'test':
      return cmdTest(ctx(), opts);
    case 'phase':
      return cmdPhase(ctx(), a, opts);
    case 'suggest':
      return cmdSuggest(ctx(), a, b, opts, rest);
    case 'drift':
      if (a !== 'ack') throw new CliError('usage: cairn drift ack <path>|--all');
      return cmdDriftAck(ctx(), b, opts);
    case 'pause':
      return cmdPause(ctx(), opts);
    case 'resume':
      return cmdResume(ctx(), a, opts);
    case 'area':
      throw removed('cairn area');
    case 'recall':
      throw removed('cairn recall');
    case 'index':
      return cmdIndex(ctx());
    case 'close':
      return cmdClose(ctx(), opts);
    case 'records':
      return cmdRecords(ctx());
    case 'migrate':
      return cmdMigrate(ctx());
    case 'merge-check':
      return cmdMergeCheck(ctx(), opts);
    case 'trace':
      return cmdTrace(ctx(), a, opts);
    case 'render':
      return cmdRender(ctx());
    case 'linear':
      return cmdLinear(ctx(), a, b, opts);
    case undefined:
    case 'help':
    case '--help':
      return { message: USAGE };
    default:
      throw new CliError(`unknown command "${cmd}"\n${USAGE}`);
  }
}

function readStdin(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function main(argv: string[]): number {
  // Hooks never block the session: any failure is swallowed.
  if (argv[0] === 'hook') {
    try {
      const input = readStdin();
      const out = argv[1] === 'session-start' ? hookSessionStart(input) : argv[1] === 'post-edit' ? hookPostEdit(input) : '';
      if (out) process.stdout.write(out + '\n');
    } catch {}
    return 0;
  }
  const json = argv.includes('--json');
  try {
    // Only an import reads stdin, and only when something is piped in and no --file is given.
    const piped = argv[0] === 'linear' && argv[1] === 'import' && !argv.some((x) => x === '--file' || x.startsWith('--file=')) && !process.stdin.isTTY;
    const r = run(argv, process.cwd(), piped ? readFileSync(0, 'utf8') : undefined);
    // An empty message prints nothing at all (cairn index with no closed plans), not a blank line.
    if (json || r.message !== '') process.stdout.write((json ? JSON.stringify({ ok: true, message: r.message, ...r.data }, null, 2) : r.message) + '\n');
    return 0;
  } catch (e) {
    if (e instanceof Refusal) {
      process.stdout.write(
        (json ? JSON.stringify({ ok: false, refused: e.message, fixes: e.fixes }, null, 2) : `✗ Refused: ${e.message}${e.fixes.map((f) => `\n  → ${f}`).join('')}`) + '\n',
      );
      return 2;
    }
    const msg = e instanceof CliError ? e.message : (e as Error).stack ?? String(e);
    process.stdout.write((json ? JSON.stringify({ ok: false, error: msg }) : `✗ Error: ${msg}`) + '\n');
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cairn.mjs')) process.exitCode = main(process.argv.slice(2));
