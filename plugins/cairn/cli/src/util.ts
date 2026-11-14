import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A checkpoint refused the action: exit 2, name what's missing and how to fix it. */
export class Refusal extends Error {
  fixes: string[];
  constructor(message: string, fixes: string[] = []) {
    super(message);
    this.fixes = fixes;
  }
}

export class CliError extends Error {}

export const now = (): string => new Date().toISOString();

export const readText = (p: string): string | undefined => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);

export function writeText(p: string, s: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}

/** Replace a file all at once: write a sibling temp file, flush it, then rename it over the target. A reader sees the old file or the new one, never part of either. */
export function writeAtomic(p: string, s: string): void {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, s);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, p);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

export const hashText =(s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Find the plugin root (the folder holding .claude-plugin/plugin.json) from this module's location. */
export function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json'))) return dir;
    dir = dirname(dir);
  }
  throw new CliError('cannot locate plugin root');
}

/** The plugin's version, from its plugin.json. */
export function pluginVersion(): string {
  return JSON.parse(readFileSync(join(pluginRoot(), '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

/** How old a lock must be before a waiter may take it over, and then only when its owner has exited. */
export const LOCK_STALE_MS = 30_000;

/** Whether the process named in a lock's owner file is still running. A lock with no readable owner counts as abandoned. */
function ownerAlive(lock: string): boolean {
  const pid = Number(readText(join(lock, 'owner'))?.split(' ')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Serialize read-modify-write of a plan's state across concurrent hooks and commands. The lock is a directory holding
 * an owner file (`<pid> <token>`). A waiter takes over a lock only when it is older than LOCK_STALE_MS and its owner
 * has exited; a holder removes the lock on release only while the token is still its own.
 */
export function withLock<T>(dir: string, fn: () => T, waitMs = 10_000): T {
  const lock = join(dir, '.lock');
  const token = randomBytes(8).toString('hex');
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner'), `${process.pid} ${token}`);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS && !ownerAlive(lock)) rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new CliError(`state is locked (${lock}); remove it if no cairn command is running`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (readText(join(lock, 'owner'))?.split(' ')[1] === token) rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}

/** Drop control characters (terminal escapes, bell, carriage return, C1) so model-written text cannot drive the terminal. Newlines and tabs stay. */
export const stripControl = (s: string): string => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
