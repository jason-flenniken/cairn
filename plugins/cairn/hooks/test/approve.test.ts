import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { isApproveLabel, parseTags } from '../mod/approve.ts'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const HASH_FILE = '/repo/.git/cairn/mod-secret.sha256'

type Run = { argv: readonly string[]; init?: { cwd?: string; env?: Record<string, string> } }
type Plan = { slug: string; stage: string; approvals?: Record<string, unknown>; phases?: unknown[]; worktree?: string }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The world beneath the mod: git names /repo/.git, `cairn status --all --json` lists
 * `plans`, and `cairn approve`/`--override` act as the CLI's proof does: the env's
 * CAIRN_APPROVER must hash to the last hash written, and a match spends it.
 */
function world(on: On, plans: Plan[], { refuse, cwd = '/repo', writable = Infinity }: { refuse?: string; cwd?: string; writable?: number } = {}) {
  const runs: Run[] = []
  const hashes: string[] = []
  const toasts: string[] = []
  let onDisk: string | undefined
  on('process.run', async (_$, e) => {
    runs.push({ argv: e.argv, init: e.init })
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string) => ({ value: { ...RAN, exitCode, stdout } })
    if (bin === 'git') return answer(0, '/repo/.git\n')
    if (bin === 'chmod') return answer(0, '')
    if (args.join(' ') === 'status --all --json') {
      const rows = plans.map(({ worktree, ...p }) => ({
        state: { approvals: {}, phases: [], ...p }, live: worktree !== undefined, worktree, next: {},
      }))
      return answer(0, JSON.stringify({ ok: true, plans: rows, modActive: true }))
    }
    const given = e.init?.env?.CAIRN_APPROVER
    if (refuse !== undefined) return answer(2, `✗ Refused: ${refuse}\n`)
    if (given !== undefined && onDisk !== undefined && (await sha256(given)) === onDisk) {
      onDisk = undefined
      return answer(0, args[0] === 'approve' ? `${args[1]} approved.\n` : 'Advanced (override recorded).\n')
    }
    return answer(2, '✗ Refused: no human proof\n')
  })
  on('fs.write', (_$, e) => {
    if (e.path === HASH_FILE && hashes.length >= writable) return { deny: 'EACCES: permission denied' }
    if (e.path === HASH_FILE) {
      hashes.push(e.text)
      onDisk = e.text
    }
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const approveRuns = () => runs.filter(r => r.argv[1] === 'approve')
  const cliRuns = () => runs.filter(r => /\/bin\/cairn$/.test(r.argv[0] ?? '') && r.argv[1] !== 'status')
  return { runs, hashes, toasts, approveRuns, cliRuns }
}

/** The dialog beneath the mod: the user's `answers`, plus any `extra` fields of the result. */
function dialog(on: On, answers: Record<string, string>, extra: Record<string, unknown> = {}) {
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({
    result: { questions: e.questions, answers, ...extra } as never,
  }))
}

function ask(...questions: string[]) {
  return {
    tool: 'AskUserQuestion' as const,
    questions: questions.map(question => ({
      question,
      header: 'cairn',
      multiSelect: false,
      options: [
        { label: 'Approve (Recommended)', description: 'Approve it' },
        { label: 'Revise', description: 'Change it first' },
      ],
    })),
  }
}

describe('parseTags', () => {
  test('reads approve and override tags, with the question text they came from', () => {
    const questions = [
      { question: 'Approve the PRD? [cairn:approve prd alpha]' },
      { question: 'Skip the failing review? [cairn:override beta-2]' },
      { question: 'Which library?' },
    ]
    expect(parseTags(questions)).toEqual([
      { kind: 'prd', slug: 'alpha', question: 'Approve the PRD? [cairn:approve prd alpha]' },
      { slug: 'beta-2', question: 'Skip the failing review? [cairn:override beta-2]', override: true },
    ])
  })

  test('takes each of the four kinds and nothing else', () => {
    const tag = (kind: string) => ({ question: `ok? [cairn:approve ${kind} x]` })
    expect(parseTags(['prd', 'plan', 'phase', 'ship'].map(tag)).map(t => t.kind)).toEqual(['prd', 'plan', 'phase', 'ship'])
    expect(parseTags([tag('deploy'), tag('PRD'), { question: '[cairn:approve prd]' }])).toEqual([])
  })

  test('ignores questions that are not strings', () => {
    expect(parseTags([{ question: undefined as never }, {} as never])).toEqual([])
  })
})

describe('isApproveLabel', () => {
  test('is true only for the exact labels', () => {
    expect(isApproveLabel('Approve')).toBe(true)
    expect(isApproveLabel('Approve (Recommended)')).toBe(true)
    for (const label of ['approve', 'Approve ', 'Approve the revised wording', 'Revise', 'Approve,Revise', '', undefined]) {
      expect(isApproveLabel(label)).toBe(false)
    }
  })
})

describe('menu approval (FR-02)', () => {
  test('"Approve (Recommended)" on a tagged question at the matching stop approves with the secret', async ($, on) => {
    const { hashes, toasts, approveRuns } = world(on, [{ slug: 'happy', stage: 'prd', worktree: '/wt/happy' }])
    const q = 'Approve the PRD? [cairn:approve prd happy]'
    dialog(on, { [q]: 'Approve (Recommended)' })

    const got = await $.tool.call(ask(q))

    const [run] = approveRuns()
    expect(approveRuns()).toHaveLength(1)
    expect(run?.argv.slice(1)).toEqual(['approve', 'prd'])
    expect(run?.argv[0]).toMatch(/\/bin\/cairn$/)
    expect(run?.init?.cwd).toBe('/wt/happy')
    const secret = run?.init?.env?.CAIRN_APPROVER ?? ''
    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(hashes[0]).toBe(await sha256(secret))
    expect(hashes).not.toContain(secret)
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Approve (Recommended)' } })
    expect(got.context?.join('\n')).toMatch(/prd approved/)
    expect(toasts.join('\n')).toMatch(/prd approved/)
  })

  const unanswered: [string, string][] = [
    ['Approve the revised wording', /answer was not "Approve"/.source],
    ['Revise', /answer was not "Approve"/.source],
  ]
  for (const [answer, why] of unanswered) {
    test(`"${answer}" approves nothing and says why`, async ($, on) => {
      const { approveRuns, toasts } = world(on, [{ slug: 'wording', stage: 'prd', worktree: '/wt/wording' }])
      const q = 'Approve? [cairn:approve prd wording]'
      dialog(on, { [q]: answer })
      const got = await $.tool.call(ask(q))
      expect(approveRuns()).toEqual([])
      expect(got.context?.join('\n')).toMatch(new RegExp(why))
      expect(toasts).toEqual([])
    })
  }

  test('an auto-answered dialog (user away) approves nothing and says why', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'afk', stage: 'prd', worktree: '/wt/afk' }])
    const q = 'Approve? [cairn:approve prd afk]'
    dialog(on, { [q]: 'Approve (Recommended)' }, { afkTimeoutMs: 60_000 })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/answered itself while you were away/)
  })

  test('a dismissed dialog approves nothing and says why', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'dismissed', stage: 'prd', worktree: '/wt/dismissed' }])
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'The user dismissed the question.' }))
    const q = 'Approve? [cairn:approve prd dismissed]'
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.deny).toBe('The user dismissed the question.')
  })

  test('answers the model put in the input are not the user\'s', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'prefilled', stage: 'prd', worktree: '/wt/prefilled' }])
    const q = 'Approve? [cairn:approve prd prefilled]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call({ ...ask(q), answers: { [q]: 'Approve' } })
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/came from the model's call, not from you/)
  })

  test('a tag for a stop that is not waiting approves nothing and says why', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'early', stage: 'plan', worktree: '/wt/early' }])
    const q = 'Approve? [cairn:approve prd early]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/not waiting for prd approval/)
    expect(toasts.join('\n')).toMatch(/not waiting for prd approval/)
  })

  test('an approval that landed is reported even when the next secret cannot be written', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'unwritable', stage: 'prd', worktree: '/wt/unwritable' }], { writable: 1 })
    const q = 'Approve? [cairn:approve prd unwritable]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join()).toMatch(/prd approved/)
    expect(toasts.join()).toMatch(/prd approved/)
  })

  test('a phase tag approves only while the current phase awaits approval', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'ph-ready', stage: 'execute', worktree: '/wt/ph-ready', phases: [{ status: 'done' }, { status: 'awaiting_approval' }] },
      { slug: 'ph-busy', stage: 'execute', worktree: '/wt/ph-busy', phases: [{ status: 'in_progress' }] },
    ])
    const ready = 'Approve? [cairn:approve phase ph-ready]'
    const busy = 'Approve? [cairn:approve phase ph-busy]'
    dialog(on, { [ready]: 'Approve', [busy]: 'Approve' })
    await $.tool.call(ask(ready, busy))
    expect(approveRuns().map(r => r.init?.cwd)).toEqual(['/wt/ph-ready'])
  })

  test('a refusal from cairn approve is carried in context and a toast', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'refused', stage: 'ship', worktree: '/wt/refused' }], {
      refuse: 'review has not passed',
    })
    const q = 'Ship it? [cairn:approve ship refused]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join('\n')).toMatch(/refused: .*review has not passed/)
    expect(toasts.join('\n')).toMatch(/refused: .*review has not passed/)
  })

  test('a subagent\'s dialog is left alone', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'sub', stage: 'prd', worktree: '/wt/sub' }])
    const q = 'Approve? [cairn:approve prd sub]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call({ ...ask(q), agentId: 'a1' } as never)
    expect(approveRuns()).toEqual([])
    expect(got.context).toBeUndefined()
  })

  test('a throwing hook still returns the user\'s result (NFR-02)', async ($, on) => {
    on('process.run', () => ({ deny: 'EIO: cannot start' }))
    const q = 'Approve? [cairn:approve prd broken]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(got.deny).toBeUndefined()
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Approve' } })
  })
})

describe('the secret (FR-01, Review focus 1 and 2)', () => {
  test('the hash is written with mode 0600 before the secret is used, and again after', async ($, on) => {
    const { hashes, runs, approveRuns } = world(on, [{ slug: 'mode', stage: 'prd', worktree: '/wt/mode' }])
    const q = 'Approve? [cairn:approve prd mode]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    const order = runs.map(r => (r.argv[1] === 'approve' ? 'approve' : r.argv.join(' ')))
    const chmod = `chmod 600 ${HASH_FILE}`
    expect(order.slice(order.indexOf('approve') - 1, order.indexOf('approve') + 1)).toEqual([chmod, 'approve'])
    expect(order.slice(order.indexOf('approve') + 1).filter(c => c === chmod)).toHaveLength(1)
    expect(hashes).toHaveLength(2)
    expect(hashes[1]).not.toBe(hashes[0])
    expect(approveRuns()).toHaveLength(1)
  })

  test('with two plans waiting, the tag\'s slug picks the plan that is approved', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'first', stage: 'prd', worktree: '/wt/first' },
      { slug: 'second', stage: 'prd', worktree: '/wt/second' },
    ])
    const q = 'Approve the PRD? [cairn:approve prd second]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    expect(approveRuns().map(r => r.init?.cwd)).toEqual(['/wt/second'])
  })

  test('back-to-back approvals each use the rotated secret, and both land', async ($, on) => {
    const { approveRuns, hashes } = world(on, [
      { slug: 'one', stage: 'prd', worktree: '/wt/one' },
      { slug: 'two', stage: 'plan', worktree: '/wt/two' },
    ])
    const one = 'Approve? [cairn:approve prd one]'
    const two = 'Approve? [cairn:approve plan two]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const first = await $.tool.call(ask(one))
    const second = await $.tool.call(ask(two))
    const [a, b] = approveRuns().map(r => r.init?.env?.CAIRN_APPROVER ?? '')
    expect(a).not.toBe(b)
    expect(hashes).toContain(await sha256(a ?? ''))
    expect(hashes).toContain(await sha256(b ?? ''))
    expect(first.context?.join()).toMatch(/prd approved/)
    expect(second.context?.join()).toMatch(/plan approved/)
  })

  test('approvals that land at once take turns with the secret, and both land', async ($, on) => {
    world(on, [
      { slug: 'c1', stage: 'prd', worktree: '/wt/c1' },
      { slug: 'c2', stage: 'ship', worktree: '/wt/c2' },
    ])
    const one = 'Approve? [cairn:approve prd c1]'
    const two = 'Ship? [cairn:approve ship c2]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const [first, second] = await Promise.all([$.tool.call(ask(one)), $.tool.call(ask(two))])
    expect(first.context?.join()).toMatch(/prd approved/)
    expect(second.context?.join()).toMatch(/ship approved/)
  })
})

describe('mod-run overrides (FR-34)', () => {
  const ADVANCE = 'cairn advance --override "r"'

  /** The Bash tool beneath the mod: records what it ran. */
  function shell(on: On) {
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: 'shell ran it', stderr: '', interrupted: false } }
    })
    return ran
  }

  async function grantOverride($: Engine, on: On, slug: string, answer = 'Override') {
    const q = `Override the review? [cairn:override ${slug}]`
    dialog(on, { [q]: answer })
    return $.tool.call(ask(q))
  }

  test('after an exact "Override", the next plain cairn --override is run by the mod with the secret', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const { cliRuns, hashes } = world(on, [{ slug: 'ov', stage: 'review', worktree: '/wt/ov' }])
    const ran = shell(on)
    const granted = await grantOverride($, on, 'ov')
    expect(granted.context?.join()).toMatch(/override for "ov" is ready/)

    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })

    expect(ran).toEqual([])
    const [run] = cliRuns()
    expect(cliRuns()).toHaveLength(1)
    expect(run?.argv.slice(1)).toEqual(['advance', '--override', 'r'])
    expect(run?.init?.cwd).toBe('/wt/ov')
    expect(hashes).toContain(await sha256(run?.init?.env?.CAIRN_APPROVER ?? ''))
    expect(got.result).toEqual({ stdout: 'Advanced (override recorded).\n', stderr: '', interrupted: false })

    // Spent: the next one runs as the model wrote it, and the CLI refuses it there.
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(ran).toEqual([ADVANCE])
    expect(cliRuns()).toHaveLength(1)
  })

  for (const answer of ['Override?', 'override']) {
    test(`"${answer}" leaves no override pending`, async ($, on) => {
      mock.clock(on)
      const { cliRuns } = world(on, [{ slug: `ov-${answer.length}`, stage: 'review', worktree: '/wt/x' }])
      const ran = shell(on)
      await grantOverride($, on, `ov-${answer.length}`, answer)
      await $.tool.call({ tool: 'Bash', command: ADVANCE })
      expect(cliRuns()).toEqual([])
      expect(ran).toEqual([ADVANCE])
    })
  }

  const unplain = [
    'cairn advance --override "r"; rm -rf x',
    'cairn advance --override "$(cat /tmp/r)"',
    'cairn advance --override "`whoami`"',
    'cairn advance --override r && echo ok',
    'cairn advance --override r | tee log',
    'cairn advance --override r > log',
    'cairn advance --override "r\nx"',
    'cairn advance --override "r',
    'cd /wt/x && cairn advance --override r',
  ]
  for (const command of unplain) {
    test(`not run by the mod: ${command}`, async ($, on) => {
      mock.clock(on)
      const slug = `unplain-${unplain.indexOf(command)}`
      const { cliRuns } = world(on, [{ slug, stage: 'review', worktree: '/wt/u' }])
      const ran = shell(on)
      await grantOverride($, on, slug)
      const got = await $.tool.call({ tool: 'Bash', command })
      expect(cliRuns()).toEqual([])
      expect(ran).toEqual([command])
      expect(got.context?.join()).toMatch(/not a plain cairn --override command/)
    })
  }

  test('a quoted reason glued to --override= is one argument, as a shell reads it', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'glued', stage: 'review', worktree: '/wt/glued' }])
    shell(on)
    await grantOverride($, on, 'glued')
    await $.tool.call({ tool: 'Bash', command: `cairn advance --override="user's call" --note 'two words'` })
    expect(cliRuns().map(r => r.argv.slice(1))).toEqual([['advance', "--override=user's call", '--note', 'two words']])
  })

  test('an override pending more than 10 minutes is not used', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const { cliRuns } = world(on, [{ slug: 'stale', stage: 'review', worktree: '/wt/stale' }])
    const ran = shell(on)
    await grantOverride($, on, 'stale')
    await clock.advance(10 * 60_000 + 1)
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  test('a pending override does not turn cairn approve into an approval', async ($, on) => {
    mock.clock(on)
    const { approveRuns } = world(on, [{ slug: 'sneak', stage: 'prd', worktree: '/wt/sneak' }])
    const ran = shell(on)
    await grantOverride($, on, 'sneak')
    const got = await $.tool.call({ tool: 'Bash', command: 'cairn approve prd --override "r"' })
    expect(approveRuns()).toEqual([])
    expect(ran).toEqual([])
    expect(got.deny).toMatch(/approvals and plan state come from the user/)
  })

  test('a session inside another plan\'s worktree runs the command normally', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [
      { slug: 'granted', stage: 'review', worktree: '/wt/granted' },
      { slug: 'other', stage: 'review', worktree: '/wt/other' },
    ], { cwd: '/wt/other/src' })
    const ran = shell(on)
    await grantOverride($, on, 'granted')
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  test('with nothing pending, a Bash call goes straight through', async ($, on) => {
    const { runs } = world(on, [])
    const ran = shell(on)
    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(ran).toEqual([ADVANCE])
    expect(runs).toEqual([])
    expect(got.context).toBeUndefined()
  })
})
