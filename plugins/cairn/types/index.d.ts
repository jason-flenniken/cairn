// cairn's mod types contract, named in plugin.json "types". It adds no noun to `$`.
import type { SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

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
  followUps: { text: string; area: string; status: string }[]
}

/** The pane's last good read: every plan, and the slug of the one the session works on (isFallback: chosen from the repo root, not by location). */
export type CairnView = { plans: CairnPlanRow[]; here?: string; isFallback?: boolean }

/** One subagent's card in the pane's NOW section (hooks/mod/activity.ts). */
export type AgentCard = {
  agentId: string
  title: string
  type: string
  model: string
  startedAt: number
  steps: number
  action?: string
  actionSince?: number
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

/** The session's usage as `session.measure` last reported it, and the model in use. */
export type CairnUsage = { cost?: SessionCost; context: SessionContextUsage; rateLimits: SessionRateLimit[]; model?: string }

/** A read-back question open in the chat: its plan, question, card and the dialog's own option labels. */
export type CairnReadBack = { slug: string; question: string; card: string; options: string[] }

declare module 'claude-code' {
  interface PluginState {
    cairn: {
      view: CairnView | null
      isTurnRunning: boolean
      agents: AgentCard[]
      /** The main session's current action; null while no turn runs. */
      mainActivity: { action: string; since: number } | null
      /** The last few finished-agent lines. */
      feed: { at: number; text: string }[]
      /** Ticked while anything is active, so the pane redraws its timers. */
      now: number
      /** The pane's tab. */
      tab: 'now' | 'history' | 'records'
      /** The session's usage; null before the first measurement. */
      usage: CairnUsage | null
      /** The session cost recorded as a plan's starting point; null until one is. */
      planBaseline: { slug: string; usd: number } | null
      /** The document the pane's viewer shows; null while closed. */
      docOpen: { file: string; title: string; kind?: string } | null
      /** The shown plan's active time so far; null until a plan is shown. */
      activeTime: { slug: string; ms: number } | null
      /** The session folder's git state; null outside a repo or before the first read. */
      git: CairnGit | null
      /** The read-back question open in the chat; null while none is. */
      readBack: CairnReadBack | null
    }
  }
}
