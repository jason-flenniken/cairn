import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, linkSync, openSync, readFileSync, readSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir } from './git.ts';
import type { Ctx } from './locate.ts';
import type { Opts } from './shared.ts';
import { readText, Refusal } from './util.ts';

/** How long a written heartbeat counts as a live mod. */
const HEARTBEAT_FRESH_MS = 10_000;

const cairnDir = (common: string) => join(common, 'cairn');
const hashPath = (common: string) => join(cairnDir(common), 'mod-secret.sha256');

export interface ProofIO {
  isTTY(): boolean;
  readLine(prompt: string): string;
}

/** Read one line from fd 0 synchronously, so a terminal approval needs a person at the keyboard. */
function readLineFromStdin(prompt: string): string {
  process.stderr.write(prompt);
  const buf = Buffer.alloc(1);
  let line = '';
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EAGAIN') continue;
      throw e;
    }
    if (n === 0 || buf[0] === 0x0a) return line;
    line += String.fromCharCode(buf[0]);
  }
}

const terminalIO: ProofIO = {
  isTTY: () => !!process.stdin.isTTY && !!process.stdout.isTTY,
  readLine: readLineFromStdin,
};

/** Read a regular file, never through a symlink; anything else reads as absent. */
function readRegularFile(path: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, 'utf8') : undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * True when the given secret hashes to the one-time hash the mod stored. The file is claimed by an atomic
 * rename first, so of any concurrent callers only one can see it. A match spends it; a mismatch puts it back.
 */
export function secretMatches(common: string, given: string | undefined): boolean {
  if (!given) return false;
  const original = hashPath(common);
  const claimed = `${original}.claimed.${randomBytes(8).toString('hex')}`;
  try {
    renameSync(original, claimed);
  } catch {
    return false;
  }
  const stored = readRegularFile(claimed)?.trim() ?? '';
  const a = Buffer.from(stored);
  const b = Buffer.from(createHash('sha256').update(given).digest('hex'));
  const match = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    try {
      linkSync(claimed, original); // no-clobber: a fresh hash may already exist
    } catch {
      // EEXIST or an unrestorable file: nothing more to do
    }
  }
  try {
    rmSync(claimed, { force: true });
  } catch {
    // a non-file planted here stays; it is not proof
  }
  return match;
}

/**
 * Proof that the user, not the model, is behind this command: the mod's one-time secret in
 * CAIRN_APPROVER (its SHA-256 is on disk and is deleted on use), or `--human` at a real terminal with the plan slug typed.
 */
export function humanProof(ctx: Ctx, opts: Opts, io: ProofIO = terminalIO): { source: 'mod' | 'terminal' } | undefined {
  const common = commonDir(ctx.mainRoot);
  const secret = process.env.CAIRN_APPROVER;
  // Read once, then gone: git and its hooks (which the model can write) never see it.
  delete process.env.CAIRN_APPROVER;
  if (secretMatches(common, secret)) return { source: 'mod' };
  if (!opts.human) return undefined;
  if (!io.isTTY()) throw new Refusal('--human needs an interactive terminal: run this in your own terminal, not through the agent');
  const slug = ctx.plan?.slug;
  const typed = io.readLine('Type the plan name to confirm: ').trim();
  return slug && typed === slug ? { source: 'terminal' } : undefined;
}

/** The mod writes a heartbeat every 2 s; under 10 s old means it is running. */
export function modActive(common: string): boolean {
  const t = Number(readText(join(cairnDir(common), 'mod-heartbeat'))?.trim());
  const age = Date.now() - t;
  return Number.isFinite(t) && t > 0 && age >= 0 && age < HEARTBEAT_FRESH_MS;
}
