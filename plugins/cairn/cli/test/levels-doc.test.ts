import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const procedures = readdirSync(join(root, 'procedures')).filter((f) => f.endsWith('.md'));
/** Text of one numbered or titled section: from its `## ` heading up to the next one. */
const sections = (src: string) => src.split(/^(?=## )/m);
const block = (src: string, heading: string) => {
  const s = sections(src).find((x) => x.startsWith(heading));
  assert.ok(s, `missing section ${heading}`);
  return s;
};

// The procedures `cairn next` routes a feature plan to, by stage.
const FEATURE = ['new', 'discover', 'prd', 'plan', 'execute', 'phase-end', 'verify', 'review', 'ship', 'learn'];

test('every feature-track procedure has an At this level block that cites levels.md', () => {
  for (const name of FEATURE) {
    const src = read(`procedures/${name}.md`);
    if (name === 'new') {
      assert.match(src, /references\/levels\.md/, 'new.md cites levels.md');
      continue;
    }
    const b = block(src, '## At this level');
    assert.match(b, /references\/levels\.md/, `${name}.md block cites levels.md`);
    assert.match(b, /`level`[^\n]*cairn status --json|cairn status --json[^\n]*`level`/, `${name}.md reads level from status`);
  }
});

test('verify.md keeps the scan and audit floor text outside any level condition', () => {
  const src = read('procedures/verify.md');
  const floor = block(src, '## 3. Security scan and dependency audit');
  assert.doesNotMatch(floor, /\b(MVP|Polished|Standard|at this level)\b/i, 'step 3 has no level condition');
  assert.match(floor, /Secret scan/);
  assert.match(floor, /Dependency audit/);
  const b = block(src, '## At this level');
  assert.match(b, /the scan and audit are floors/);
});

test('execute.md keeps "review every task" and never says "review only risky"', () => {
  const src = read('procedures/execute.md');
  assert.match(src, /review every task/i);
  assert.doesNotMatch(src, /review it only if it is risky|review only risky|Not risky: go straight/i);
});

test('levels.md states the security floors at every level', () => {
  const src = read('references/levels.md');
  const floors = block(src, '## Floors at every level');
  assert.match(floors, /secret scan and the dependency audit/);
  assert.match(floors, /touches a trust boundary gets a security review at every level, including MVP/);
  assert.match(floors, /whole-branch security review runs at every level/);
  assert.match(floors, /PRD, plan and ship approvals stay/);
  for (const signal of ['auth', 'money', 'deletes', 'migrations', 'public API', 'untrusted input', 'personal data', 'new dependency', 'model output', 'shell commands']) {
    assert.ok(floors.includes(signal), `levels.md names ${signal}`);
  }
});

test('MVP execute keeps the security reviewer for trust-boundary tasks and skips the task reviewer', () => {
  const b = block(read('procedures/execute.md'), '## At this level');
  assert.match(b, /MVP: skip `task-reviewer`/);
  assert.match(b, /trust boundary gets the `security-reviewer`/);
  assert.match(b, /one tier below/);
});

test('every line that runs `cairn level` is a --human command or sits in a step with the level menu', () => {
  const files = [...procedures.map((f) => `procedures/${f}`), 'references/levels.md'];
  let seen = 0;
  for (const f of files) {
    for (const sec of sections(read(f))) {
      for (const line of sec.split('\n')) {
        if (!/cairn level (mvp|standard|polished|<)/.test(line)) continue;
        seen++;
        assert.ok(/--human/.test(line) || sec.includes('[cairn:level '), `${f}: "${line.trim()}" runs cairn level bare`);
      }
    }
  }
  assert.ok(seen > 0, 'levels.md prints the --human command');
  const menu = block(read('references/levels.md'), '## Changing the level');
  assert.match(menu, /\[cairn:level <slug>\]/);
  assert.match(menu, /modActive/);
  assert.match(menu, /never runs `cairn level` on its own/);
});

test('new.md asks the level question and passes --level', () => {
  const src = read('procedures/new.md');
  const step = block(src, '## 4. Level');
  assert.match(step, /AskUserQuestion/);
  assert.match(step, /first and marked "\(Recommended\)"/);
  for (const l of ['MVP', 'Standard', 'Polished']) assert.ok(step.includes(`- ${l}:`), `option ${l}`);
  assert.match(block(src, '## 5. Create the plan'), /cairn new <slug> --title "<title>" --level /);
});

test('plan, execute and verify have the Polished requirements', () => {
  assert.match(block(read('procedures/plan.md'), '## At this level'), /Polished: every task lists Test cases[\s\S]*plan-reviewer/);
  assert.match(block(read('procedures/execute.md'), '## At this level'), /Polished: test-first for every task/);
  assert.match(block(read('procedures/verify.md'), '## At this level'), /Polished: every requirement must be met and tested/);
  assert.match(block(read('procedures/phase-end.md'), '## At this level'), /Polished:[^\n]*on-track check[^\n]*without being asked/);
});

test('MVP plan flags risky tasks and files untested areas as hardening', () => {
  const b = block(read('procedures/plan.md'), '## At this level');
  assert.match(b, /MVP:[^\n]*`risky: true`/);
  assert.match(b, /cairn suggest add --kind hardening/);
});

test('verify MVP uses cairn test and sends a red suite past the fix loop', () => {
  const b = block(read('procedures/verify.md'), '## At this level');
  assert.match(b, /cairn test/);
  assert.match(b, /A red suite is not a blocker/);
  assert.match(b, /not to the fix loop in step 5/);
});

test('MVP review uses a sonnet branch reviewer and files lesser findings as hardening', () => {
  const b = block(read('procedures/review.md'), '## At this level');
  assert.match(b, /`branch-reviewer` with `model: sonnet`/);
  assert.match(b, /--kind hardening/);
  assert.match(b, /whole-branch security review runs at every level/);
});

test('MVP ship runs cairn test and names failing commands; learn keeps its cap', () => {
  const ship = block(read('procedures/ship.md'), '## At this level');
  assert.match(ship, /cairn test/);
  assert.match(ship, /names each open failing test command/);
  const learn = read('procedures/learn.md');
  assert.match(learn, /at most 5/);
  assert.match(block(learn, '## At this level'), /Hardening items do not count toward the follow-up limit/);
});

test('model-tiers.md has a separate MVP table and keeps the existing rows', () => {
  const src = read('references/model-tiers.md');
  assert.match(src, /\| task-reviewer \(every task\) \| sonnet \|/);
  assert.match(src, /\| branch-reviewer \| opus \|/);
  const mvp = block(src, '## MVP plans');
  assert.match(mvp, /implementer \| one tier below/);
  assert.match(mvp, /branch-reviewer \| sonnet/);
});

test('skills pre-approve cairn level and cairn test', () => {
  for (const d of readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const s = read(`skills/${d.name}/SKILL.md`);
    assert.ok(s.includes('"Bash(cairn level:*)"') && s.includes('"Bash(cairn test:*)"'), `${d.name} allows level and test`);
  }
});
