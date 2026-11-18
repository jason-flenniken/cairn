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
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** The shared hash file older mods write; kept so a session still running one can approve. */
const hashPath = (common: string) => join(cairnDir(common), 'mod-secret.sha256');
/** The mod's one-time file for one secret, named by its hash: each use and each session has its own. */
const tokenPath = (common: string, secret: string) => join(cairnDir(common), `approver-${sha256(secret)}`);

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

/** A real terminal on stdin and stdout: the model's tool runs have none, and the guard denies pty wrappers around cairn. */
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
 * True when the given secret is the mod's: its hash names a regular file the mod wrote for it, or matches the
 * shared hash an older mod wrote. Each file is claimed by an atomic rename first, so of any concurrent callers
 * only one can see it, and a match spends it.
 */
export function secretMatches(common: string, given: string | undefined): boolean {
  if (!given) return false;
  return spendToken(common, given) || spendLegacyHash(common, given);
}

/** Claims `path` by renaming it aside; the claimed name, or undefined when another caller got it or it is absent. */
function claim(path: string): string | undefined {
  const claimed = `${path}.claimed.${randomBytes(8).toString('hex')}`;
  try {
    renameSync(path, claimed);
    return claimed;
  } catch {
    return undefined;
  }
}

function removeClaimed(claimed: string): void {
  try {
    rmSync(claimed, { force: true });
  } catch {
    // a non-file planted here stays; it is not proof
  }
}

/** The secret's own file: present and a regular file is proof, and it is spent whatever it was. */
function spendToken(common: string, given: string): boolean {
  const claimed = claim(tokenPath(common, given));
  if (claimed === undefined) return false;
  const isFile = readRegularFile(claimed) !== undefined;
  removeClaimed(claimed);
  return isFile;
}

/** The shared hash file: a match spends it, a mismatch puts it back. */
function spendLegacyHash(common: string, given: string): boolean {
  const original = hashPath(common);
  const claimed = claim(original);
  if (claimed === undefined) return false;
  const stored = readRegularFile(claimed)?.trim() ?? '';
  const a = Buffer.from(stored);
  const b = Buffer.from(sha256(given));
  const match = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    try {
      linkSync(claimed, original); // no-clobber: a fresh hash may already exist
    } catch {
      // EEXIST or an unrestorable file: nothing more to do
    }
  }
  removeClaimed(claimed);
  return match;
}

/**
 * Proof that the user, not the model, is behind this command: the mod's one-time secret in
 * CAIRN_APPROVER (its SHA-256 names a file on disk, deleted on use), or `--human` at a real terminal with Enter pressed.
 * The keypress, not its content, is the proof: a terminal window the model opens itself waits there for a person.
 */
export function humanProof(ctx: Ctx, opts: Opts, io: ProofIO = terminalIO): { source: 'mod' | 'terminal' } | undefined {
  const common = commonDir(ctx.mainRoot);
  const secret = process.env.CAIRN_APPROVER;
  // Read once, then gone: git and its hooks (which the model can write) never see it.
  delete process.env.CAIRN_APPROVER;
  if (secretMatches(common, secret)) return { source: 'mod' };
  if (!opts.human) return undefined;
  if (!io.isTTY()) throw new Refusal('--human needs an interactive terminal: run this in your own terminal, not through the agent');
  const typed = io.readLine(`Confirm for plan ${ctx.plan?.slug ?? '?'}: press Enter (Ctrl-C cancels) `).trim();
  return typed === '' || /^y(es)?$/i.test(typed) ? { source: 'terminal' } : undefined;
}

/** The mod writes a heartbeat every 2 s; under 10 s old means it is running. */
export function modActive(common: string): boolean {
  const t = Number(readText(join(cairnDir(common), 'mod-heartbeat'))?.trim());
  const age = Date.now() - t;
  return Number.isFinite(t) && t > 0 && age >= 0 && age < HEARTBEAT_FRESH_MS;
}
