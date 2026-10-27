/** Folder names cairn owns. The legacy names stay readable so existing repos keep working. */
export const CAIRN_DIR = '.cairn';
export const LEGACY_CAIRN_DIR = '.sdlc';
export const DOCS_DIR = 'docs/cairn';
export const LEGACY_DOCS_DIR = 'docs/sdlc';
export const DOCS_DIRS: readonly string[] = [DOCS_DIR, LEGACY_DOCS_DIR];

const under = (rel: string, dir: string) => rel === dir || rel.startsWith(`${dir}/`);

/** Paths the edit hook ignores: either docs root, either config root, or `.claude/`. */
export function isCairnPath(rel: string): boolean {
  return [...DOCS_DIRS, CAIRN_DIR, LEGACY_CAIRN_DIR, '.claude'].some((d) => under(rel, d));
}

/** Git pathspecs that leave both docs roots out of a diff. */
export const cairnPathspecExcludes = (): string[] => DOCS_DIRS.map((d) => `:!${d}`);
