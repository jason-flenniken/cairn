// cairn's mod types contract, named in plugin.json "types". It adds no noun to `$`.

/** What `cairn($, args)` in hooks/mod/cli.ts resolves with. */
export type CairnRun = {
  exitCode: number
  stdout: string
  stderr: string
  /** stdout parsed as JSON, when it parses. */
  json?: any
}

/** A plan's state.json as the pane reads it: the fields it draws, each possibly absent in an old plan. */
export type CairnPlanState = {
  slug: string
  title?: string
  /** `feature` or `fix`; an old plan without it is a feature plan. */
  track?: string
  stage?: string
  /** The plan's depth level as stored; absent until one is chosen. */
  level?: string
  /** The step the plan is on inside its stage, as the CLI last recorded it. */
  step?: { stage: string; name: string; count?: number; at: string }
  updated?: string
  paused?: { at?: string } | null
  approvals?: Record<string, unknown>
  phases?: unknown
  drift?: unknown
  log?: unknown
}

/** The stop a plan waits on a human for, when the CLI says it is ready: the file to read and a short markdown summary. */
export type CairnReady = { kind: 'prd' | 'plan' | 'ship'; file: string; summary: string }

/** One row of `cairn status --all --json`. */
export type CairnPlanRow = {
  state: CairnPlanState
  worktree?: string
  /** True while a closed or learn plan's branch is not merged yet; the CLI works it out, the pane never does. */
  prOpen?: boolean
  /** Absolute plan folder (dated folders included); the pane watches `${dir}/state.json`. */
  dir?: string
  next?: { text?: string }
  /** The recorded step for the plan's current stage in words ("fixing 3 findings"); the CLI words it, the pane only shows it. */
  stepText?: string
  /** The level in words, from the CLI ("Polished"); empty when the plan never chose one. The pane shows it as given. */
  levelLabel?: string
  /** Milliseconds spent in each stage, paused time left out; null for a plan with no history. */
  timing?: Record<string, number> | null
  /** Suggestions nobody has closed; absent until the CLI reports them. */
  openSuggestions?: number
  /** The plan's config.maxParallel, when the CLI reports it. */
  maxParallel?: number
  /** Set only while the plan's document is ready for the human; absent while it is still being drafted. */
  ready?: CairnReady
  /** True when the plan wants the person: a document is ready, or its step is `approving` or `asking`; the CLI works it out. */
  needsUser?: boolean
  /** The Linear issue keys each task of the plan builds, by task name; absent until the plan is linked to Linear. */
  taskIssues?: Record<string, string[]>
  /** The Linear epic key the plan belongs to; absent when it has none. */
  epic?: string
  /** Linear updates cairn queued for this plan that are not sent yet; absent when none are waiting. */
  linearDue?: number
}

/** One plan of `cairn records --json`: in progress first, then newest first. */
export type CairnRecord = {
  slug: string
  title: string
  date: string
  stage: string
  why: string
  /** Absolute path to RECORD.md, when the plan has one. */
  record?: string
  /** The plan's changelog paragraph, when it has one. */
  entry?: string
  followUps: { text: string; area: string; status: string }[]
}

/** One issue of `cairn linear board --json`. */
export type CairnBoardIssue = {
  key: string
  title: string
  milestone?: string
  parent?: string
  status: 'done' | 'in plan' | 'ready' | 'alongside' | 'blocked'
  plan?: { slug: string; stage: string; progress: string }
  /** The issues this one waits on; `where` names the milestone or plan they sit in, when the CLI knows it. */
  blockedBy: { key: string; where?: string }[]
  /** How many other issues this one unblocks when it finishes. */
  unblocks?: number
  /** On `alongside` issues: each open blocker and the plan holding it. */
  after?: CairnBoardAfter[]
}

/** A plan an alongside issue or epic would stack on. */
export type CairnBoardAfter = { key: string; slug: string; stage: string; branch: string }

/** One epic of a milestone in `cairn linear board --json`, with where it stands. */
export type CairnBoardEpic = {
  key: string
  title: string
  done: number
  total: number
  plans: string[]
  issues: CairnBoardIssue[]
  /** Where the epic stands: `active` has work under way, `ready` can start, `waiting` is blocked, `done` is finished. */
  state: 'active' | 'ready' | 'alongside' | 'waiting' | 'done'
  /** The keys of the epics or issues this epic waits on. */
  waitsOn: string[]
  /** How many other items this epic unblocks when it finishes. */
  unblocks?: number
  /** On `alongside` epics: the plans its sub-issues would stack on. */
  after?: CairnBoardAfter[]
}

/** `cairn linear board --json`: the Linear project's progress across milestones, epics and plans. */
export type CairnBoard = {
  project: string
  readAt: string
  ageMinutes: number
  milestones: {
    name: string
    counts: { total: number; done: number; inPlan: number; ready: number; alongside?: number; blocked: number }
    epics: CairnBoardEpic[]
    issues: CairnBoardIssue[]
    /** The milestones this one waits on. */
    waitsOn?: string[]
  }[]
  plans: { slug: string; title?: string; stage: string; issues: string[]; stalled: boolean }[]
  cycle: string[] | null
  /** The keys of the epics that can start now. */
  readyEpics?: string[]
  /** The name of the first milestone that is not all done; null when every milestone is done. */
  focus?: string | null
  /** The plans under way, with the epic and issues each one builds and their progress. */
  inProgress?: {
    slug: string
    /** The plan's stage in words, as the CLI last recorded it. */
    stage: string
    /** The Linear epic the plan belongs to. */
    epic?: string
    /** The epic's title when the plan's epic is on the board, otherwise the plan's title. */
    title?: string
    /** Issues the plan has finished. */
    done: number
    /** Issues the plan builds in all. */
    total: number
    issues: { key: string; title: string; progress: string }[]
  }[]
  /** The epics and issues that can start now, with what each one unblocks. */
  ready?: { key: string; title: string; kind: 'epic' | 'issue'; milestone: string; unblocks: number }[]
  /** Work that can start now stacked on another open plan's branch, because its blockers are built or in review there. */
  alongside?: { key: string; title: string; kind: 'epic' | 'issue'; milestone: string; unblocks: number; after: CairnBoardAfter[] }[]
  /** The epics and issues that wait on something, with the keys they wait on. */
  waiting?: { key: string; title: string; kind: 'epic' | 'issue'; done?: number; total?: number; waitsOn: string[] }[]
  /** How many issues in the project are done. */
  done?: number
  /** Blocked-by links set on an epic itself, to an issue not done, while the epic has 3 or more open sub-issues (`holds`). */
  wideLinks?: { epic: string; on: string; holds: number }[]
}

/** The pane's last good read: every plan, and the slug of the one the session works on (isFallback: chosen from the repo root, not by location). */
/** A plan's usage in one session's ledger file, or summed over all of them. */
export type CairnLedgerEntry = {
  /** US dollars, from the session's cost. */
  usd: number
  /** Tokens by kind, main thread and agents together. */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** All tokens by the model that answered. */
  tokensByModel: Record<string, number>
  /** Points of the 7-day limit that rose while the plan was worked on (approximate: other use of the account counts too). */
  weekPct: number
  /** The same figures by the plan's stage at the time. */
  byStage: Record<string, { usd: number; tokens: number; weekPct: number }>
}

export type CairnView = { plans: CairnPlanRow[]; here?: string; isFallback?: boolean }

/** One subagent's card in the pane's NOW section (hooks/mod/activity.ts). */
export type AgentCard = {
  agentId: string
  /** Assigned once when the agent starts, counting up from 1 for the session; never reused. */
  number: number
  title: string
  type: string
  model: string
  startedAt: number
  steps: number
  action?: string
  actionSince?: number
  /** The tool call under way, as `Tool arg` (activity.ts `toolCall`). */
  call?: string
  /** The last tool call that ended, kept for the card's third row once `call` is gone. */
  lastCall?: string
  status: 'working' | 'done' | 'failed'
  endedAt?: number
  durationMs?: number
  tokens?: number
  /** Tokens so far while the agent still works. */
  tokensLive?: number
  /** What the agent cost, in US dollars. */
  usd?: number
}

/** `git status --porcelain=v2 --branch` in the session folder, and the linked worktree it is in, if any. */
export type CairnGit = {
  branch: string
  isDetached: boolean
  hasUpstream: boolean
  ahead: number
  behind: number
  staged: number
  changed: number
  untracked: number
  conflicts: number
  /** The linked worktree's folder name; absent in the main checkout. */
  worktree?: string
}

/** A read-back question open in the chat: its plan, question, card and the dialog's own option labels. */
export type CairnReadBack = { slug: string; question: string; card: string; options: string[] }

declare module 'claude-code' {
  interface PluginState {
    cairn: {
      view: CairnView | null
      isTurnRunning: boolean
      agents: AgentCard[]
      /** How many agents have been numbered this session; the next card is this plus one. */
      agentSeq: number
      /** The main session's current action; null while no turn runs. */
      mainActivity: { action: string; since: number; isWaiting?: boolean; call?: string; lastCall?: string; turnAt?: number } | null
      /** When the main turn last ended, epoch ms; 0 before any has. */
      mainIdleSince: number
      /** The last few finished-agent lines. */
      feed: { at: number; text: string }[]
      /** Ticked while anything is active, so the pane redraws its timers. */
      now: number
      /** The pane's tab. */
      tab: 'now' | 'history' | 'records' | 'changelog' | 'linear'
      /** The session's usage as `session.measure` last reported it, and the model in use; null before the first measurement. */
      usage: { cost?: SessionCost; context: SessionContextUsage; rateLimits: SessionRateLimit[]; model?: string } | null
      /** This session's usage ledger: its id, the last cost and 7-day readings, and its totals per plan; null before the session starts it. */
      ledger: { sessionId: string; lastUsd?: number; lastWeek?: { pct: number; resetsAt?: string }; plans: Record<string, CairnLedgerEntry> } | null
      /** The other sessions' summed totals for the plan this session works on; null until first read. */
      planUsage: { slug: string; others: CairnLedgerEntry } | null
      /** The document the pane's viewer shows; null while closed. */
      docOpen: { file: string; title: string; kind?: string } | null
      /** The shown plan's active time so far; null until a plan is shown. */
      activeTime: { slug: string; ms: number } | null
      /** The session folder's git state; null outside a repo or before the first read. */
      git: CairnGit | null
      /** The read-back question open in the chat; null while none is. */
      readBack: CairnReadBack | null
      /** The Records tab's list; null until first loaded. */
      records: CairnRecord[] | null
      /** The record whose details the Records tab shows; null while none is open. */
      openRecord: string | null
      /** Whether the repo's cairn config has a "linear" block; the Linear tab shows only then. */
      linearSetup: boolean
      /** The Linear tab's last good board read; null until read or when no project has been read. */
      linearBoard: CairnBoard | null
      /** The CLI's refusal for the last board read (for example no project read yet); null after a good read. */
      linearNote: string | null
    }
  }
}
