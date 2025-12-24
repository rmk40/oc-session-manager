// Utility functions for formatting, text manipulation, and status helpers

import type { Instance, EffectiveStatus, GroupStats } from './types.js'
import { STALE_TIMEOUT_MS, LONG_RUNNING_MS } from './config.js'
import { instances, busySince } from './state.js'

// ---------------------------------------------------------------------------
// Time Formatting
// ---------------------------------------------------------------------------

export function formatRelativeTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  
  if (diff < 1000) return 'now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const hours = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${mins}m`
}

// ---------------------------------------------------------------------------
// Value Formatting
// ---------------------------------------------------------------------------

export function formatCost(cost: number | undefined): string {
  if (!cost || cost === 0) return ''
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number | undefined): string {
  if (!tokens) return ''
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

// ---------------------------------------------------------------------------
// Text Manipulation
// ---------------------------------------------------------------------------

export function truncate(str: string, maxLen: number): string {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return ['']
  if (maxWidth <= 0) return [text]
  
  const lines: string[] = []
  let remaining = text
  
  while (remaining.length > maxWidth) {
    // Try to break at a space
    let breakPoint = remaining.lastIndexOf(' ', maxWidth)
    if (breakPoint <= 0) {
      // No space found, hard break
      breakPoint = maxWidth
    }
    lines.push(remaining.slice(0, breakPoint))
    remaining = remaining.slice(breakPoint).trimStart()
  }
  
  if (remaining) {
    lines.push(remaining)
  }
  
  return lines.length > 0 ? lines : ['']
}

export function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

// ---------------------------------------------------------------------------
// Status Helpers
// ---------------------------------------------------------------------------

export function getEffectiveStatus(instance: Instance): EffectiveStatus {
  const age = Date.now() - instance.ts
  if (age > STALE_TIMEOUT_MS) return 'stale'
  if (instance.status === 'shutdown') return 'stale'
  if (instance.status === 'busy' || instance.status === 'running' || instance.status === 'pending') {
    return 'busy'
  }
  return 'idle'
}

export function isLongRunning(instance: Instance): boolean {
  const status = getEffectiveStatus(instance)
  if (status !== 'busy') return false
  
  const busyStart = busySince.get(instance.instanceId)
  if (!busyStart) return false
  
  return Date.now() - busyStart > LONG_RUNNING_MS
}

export function getBusyDuration(instance: Instance): number {
  const busyStart = busySince.get(instance.instanceId)
  if (!busyStart) return 0
  return Date.now() - busyStart
}

// ---------------------------------------------------------------------------
// Instance Grouping
// ---------------------------------------------------------------------------

export function getGroupKey(instance: Instance): string {
  const project = instance.project || instance.dirName || 'unknown'
  const branch = instance.branch || 'main'
  return `${project}:${branch}`
}

export function getSortedInstances(): Instance[] {
  const all = Array.from(instances.values())
  
  // Remove very old stale instances (> 2x timeout)
  const cutoff = Date.now() - (STALE_TIMEOUT_MS * 2)
  for (const [id, inst] of instances) {
    if (inst.ts < cutoff) instances.delete(id)
  }

  // Sort purely by instanceId for stable ordering
  return all.sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
}

export function getGroupedInstances(): [string, Instance[]][] {
  const sorted = getSortedInstances()
  const groups = new Map<string, Instance[]>()
  
  for (const inst of sorted) {
    const key = getGroupKey(inst)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(inst)
  }
  
  // Sort groups purely alphabetically for stable ordering
  const groupEntries = Array.from(groups.entries())
  groupEntries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
  
  return groupEntries
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function countByStatus(): { idle: number; busy: number; stale: number } {
  const counts = { idle: 0, busy: 0, stale: 0 }
  
  for (const inst of instances.values()) {
    const status = getEffectiveStatus(inst)
    counts[status]++
  }
  
  return counts
}

export function getGroupStats(insts: Instance[]): GroupStats {
  const stats: GroupStats = { idle: 0, busy: 0, stale: 0, cost: 0, tokens: 0 }
  
  for (const inst of insts) {
    const status = getEffectiveStatus(inst)
    stats[status]++
    stats.cost += inst.cost || 0
    stats.tokens += inst.tokens?.total || 0
  }
  
  return stats
}

// ---------------------------------------------------------------------------
// Tool Arguments Formatting
// ---------------------------------------------------------------------------

export function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return ''
  
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    let valueStr: string
    if (typeof value === 'string') {
      valueStr = truncate(value, 50)
    } else if (typeof value === 'object') {
      valueStr = '[object]'
    } else {
      valueStr = String(value)
    }
    parts.push(`${key}: ${valueStr}`)
  }
  
  return parts.join(', ')
}
