import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
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

export const hashText = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

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

/** Serialize read-modify-write of a plan's state across concurrent hooks and commands. */
export function withLock<T>(dir: string, fn: () => T): T {
  const lock = join(dir, '.lock');
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmdirSync(lock);
      } catch {}
      if (Date.now() > deadline) throw new CliError(`state is locked (${lock}); remove it if no cairn command is running`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {}
  }
}
