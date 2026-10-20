import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir } from './git.ts';
import type { Ctx } from './locate.ts';
import type { Opts } from './shared.ts';
import { readText, Refusal, SLUG } from './util.ts';

/** How long a written heartbeat counts as a live mod, and how long an override grant stays valid. */
const HEARTBEAT_FRESH_MS = 10_000;
const GRANT_TTL_MS = 10 * 60_000;

const cairnDir = (common: string) => join(common, 'cairn');
const secretPath = (common: string) => join(cairnDir(common), 'mod-secret');

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

/** Replace the mod secret atomically with mode 0600: a new temp file (random name, exclusive create), then rename. */
export function rotateSecret(common: string): void {
  const tmp = `${secretPath(common)}.${randomBytes(8).toString('hex')}.tmp`;
  mkdirSync(cairnDir(common), { recursive: true });
  let created = false;
  try {
    writeFileSync(tmp, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    created = true;
    chmodSync(tmp, 0o600);
    renameSync(tmp, secretPath(common));
  } catch (e) {
    if (created) rmSync(tmp, { force: true });
    throw e;
  }
}

function secretMatches(common: string, given: string | undefined): boolean {
  if (!given) return false;
  const secret = readRegularFile(secretPath(common))?.trim() ?? '';
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Proof that the user, not the model, is behind this command: the mod's current secret in
 * CAIRN_APPROVER (rotated on use), or `--human` at a real terminal with the plan slug typed.
 */
export function humanProof(ctx: Ctx, opts: Opts, io: ProofIO = terminalIO): { source: 'mod' | 'terminal' } | undefined {
  const common = commonDir(ctx.mainRoot);
  if (secretMatches(common, process.env.CAIRN_APPROVER)) {
    rotateSecret(common);
    return { source: 'mod' };
  }
  if (!opts.human) return undefined;
  if (!io.isTTY()) throw new Refusal('--human needs an interactive terminal: run this in your own terminal, not through the agent');
  const slug = ctx.plan?.slug;
  const typed = io.readLine('Type the plan name to confirm: ').trim();
  return slug && typed === slug ? { source: 'terminal' } : undefined;
}

/** Take the plan's override grant if it is valid: single use, at most 10 minutes old. */
export function consumeGrant(common: string, slug: string): { reason: string } | undefined {
  if (!SLUG.test(slug)) return undefined;
  const file = join(cairnDir(common), 'grants', `${slug}.json`);
  const raw = readRegularFile(file);
  if (raw === undefined) return undefined;
  try {
    rmSync(file);
  } catch {
    return undefined;
  }
  try {
    const g = JSON.parse(raw) as { reason?: unknown; createdAt?: unknown; slug?: unknown };
    const age = Date.now() - Number(g.createdAt);
    if (g.slug !== slug || typeof g.reason !== 'string' || !(age >= 0 && age <= GRANT_TTL_MS)) return undefined;
    return { reason: g.reason };
  } catch {
    return undefined;
  }
}

/** The mod writes a heartbeat every 2 s; under 10 s old means it is running. */
export function modActive(common: string): boolean {
  const t = Number(readText(join(cairnDir(common), 'mod-heartbeat'))?.trim());
  const age = Date.now() - t;
  return Number.isFinite(t) && t > 0 && age >= 0 && age < HEARTBEAT_FRESH_MS;
}
