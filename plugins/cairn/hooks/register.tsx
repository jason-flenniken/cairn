// cairn's mod: this file only wires the feature modules under mod/, one concern each.
import type { Register } from 'claude-code'
import { install as installApprove } from './mod/approve.ts'
import { install as installGuards } from './mod/guards.ts'
import { install as installHeartbeat } from './mod/heartbeat.ts'
import { install as installPane } from './mod/pane.tsx'
import { install as installPause } from './mod/pause.ts'

export const register: Register = on => {
  installGuards(on)
  installHeartbeat(on)
  installApprove(on)
  installPause(on)
  installPane(on)
}
