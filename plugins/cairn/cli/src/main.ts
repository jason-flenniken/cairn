import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cmdAdvance,
  cmdApprove,
  cmdClose,
  cmdDecide,
  cmdDriftAck,
  cmdEscalate,
  cmdEvidence,
  cmdNew,
  cmdNext,
  cmdPause,
  cmdPlanLoad,
  cmdProductInit,
  cmdReady,
  cmdRepro,
  cmdRender,
  cmdResume,
  cmdTask,
  cmdStatus,
  context,
  hookPostEdit,
  hookSessionStart,
  type Opts,
  type Result,
} from './commands.ts';
import { CliError, Refusal } from './util.ts';

const BOOLEAN = new Set(['json', 'all', 'replan', 'now', 'no-worktree', 'human']);

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
    else if (inline !== undefined) opts[name] = inline;
    else {
      if (i + 1 >= argv.length) throw new CliError(`--${name} needs a value`);
      opts[name] = argv[++i];
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
  return { pos, opts };
}

const USAGE = `cairn: plan state for the agent-driven lifecycle. See references/cli.md.
  next | status [--all] | new <slug> --title "…" | product init | decide "<q>" "<a>" [--why] | decide --file <path>
  approve prd|plan|phase|ship | advance [--to <stage>] | plan load [--replan] | ready
  task start|step|done <id> | evidence verify|review pass|fail | evidence phase | drift ack <path>|--all
  pause [--now] | resume [<slug>] | close | render
  repro "<command>" | escalate (fix plans)
Flags: --json, --note "…", --note-file <path>, --override "reason" (only when the user chose to skip a check)`;

export function run(argv: string[], cwd = process.cwd()): Result {
  const { pos, opts } = parseArgs(argv, cwd);
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
    case 'drift':
      if (a !== 'ack') throw new CliError('usage: cairn drift ack <path>|--all');
      return cmdDriftAck(ctx(), b, opts);
    case 'pause':
      return cmdPause(ctx(), opts);
    case 'resume':
      return cmdResume(ctx(), a, opts);
    case 'close':
      return cmdClose(ctx(), opts);
    case 'render':
      return cmdRender(ctx());
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
    const r = run(argv);
    process.stdout.write((json ? JSON.stringify({ ok: true, message: r.message, ...r.data }, null, 2) : r.message) + '\n');
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
