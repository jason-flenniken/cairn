/** `## ` sections of a markdown doc, keyed by lowercased title. Fenced code is not scanned for headings. */
export function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  let title: string | undefined;
  let body: string[] = [];
  let fenced = false;
  const flush = () => {
    if (title !== undefined) out.set(title, body.join('\n').trim());
  };
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      flush();
      title = m[1].toLowerCase();
      body = [];
    } else if (title !== undefined) body.push(line);
  }
  flush();
  return out;
}

export function missingSections(md: string, required: readonly string[]): string[] {
  const have = sections(md);
  return required.filter((r) => !have.has(r.toLowerCase()));
}

/** Section bodies that are empty or still template placeholders. */
export function emptySections(md: string, required: readonly string[]): string[] {
  const have = sections(md);
  return required.filter((r) => {
    const body = have.get(r.toLowerCase());
    return body !== undefined && body.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
  });
}

export const uncheckedItems = (body = ''): string[] =>
  body.split('\n').filter((l) => /^\s*[-*]\s+\[ \]/.test(l)).map((l) => l.trim());

export const wordCount = (md: string): number =>
  md.replace(/<!--[\s\S]*?-->/g, '').split(/\s+/).filter(Boolean).length;

export const PRD_SECTIONS = [
  'Problem',
  'Solution',
  'User stories',
  'Functional requirements',
  'Non-functional requirements',
  'Non-goals',
  'Acceptance criteria',
  'Unhappy paths',
  'Security considerations',
  'Open questions',
] as const;
export const PLAN_SECTIONS = ['Goal', 'Architecture', 'Global constraints', 'Review focus', 'Phases'] as const;
export const RECORD_SECTIONS = ['Links', 'Why', 'What was built', 'How it works', 'Evidence', 'Deviations', 'Follow-ups'] as const;
export const HANDOFF_SECTIONS = ['In flight', 'Open questions', 'Next action'] as const;
export const RECORD_WORD_BUDGET = 900;

export const FR_ID = /\bFR-\d+\b/g;
export const ids = (text = ''): string[] => [...new Set(text.match(FR_ID) ?? [])];
