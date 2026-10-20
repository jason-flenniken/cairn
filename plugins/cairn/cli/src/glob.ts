/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. */
export function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A bare directory ("src/cart" or "src/cart/") covers everything under it.
  if (!/[*?]/.test(glob)) re = re.replace(/\/$/, '') + '(?:/.*)?';
  return new RegExp(`^${re}$`);
}

export const matchesAny = (path: string, globs: string[]): boolean => globs.some((g) => globToRegex(g).test(path));

const staticPrefix = (glob: string): string => glob.split(/[*?[]/)[0];

/** Conservative: true when two scopes could touch the same file. */
export function scopesOverlap(a: string[], b: string[]): boolean {
  for (const x of a)
    for (const y of b) {
      if (globToRegex(x).test(y) || globToRegex(y).test(x)) return true;
      const px = staticPrefix(x);
      const py = staticPrefix(y);
      if (px.startsWith(py) || py.startsWith(px)) return true;
    }
  return false;
}
