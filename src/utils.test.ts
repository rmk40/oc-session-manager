import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Instance } from './types.js'

// Mock the state module before importing utils
vi.mock('./state.js', () => ({
  instances: new Map<string, Instance>(),
  busySince: new Map<string, number>(),
}))

// Mock the config module
vi.mock('./config.js', () => ({
  STALE_TIMEOUT_MS: 120000, // 2 minutes
  LONG_RUNNING_MS: 600000,  // 10 minutes
}))

import {
  formatRelativeTime,
  formatDuration,
  formatCost,
  formatTokens,
  truncate,
  wrapText,
  escapeShell,
  getEffectiveStatus,
  isLongRunning,
  getBusyDuration,
  getGroupKey,
  getSortedInstances,
  getGroupedInstances,
  countByStatus,
  getGroupStats,
  formatToolArgs,
} from './utils.js'

import { instances, busySince } from './state.js'

// Helper to create a mock instance
function createInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    instanceId: 'test-instance-1',
    status: 'idle',
    ts: Date.now(),
    ...overrides,
  }
}

describe('utils', () => {
  // =========================================================================
  // Time Formatting
  // =========================================================================

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "now" for timestamps less than 1 second ago', () => {
      const ts = Date.now() - 500
      expect(formatRelativeTime(ts)).toBe('now')
    })

    it('returns "now" for timestamps exactly 0ms ago', () => {
      expect(formatRelativeTime(Date.now())).toBe('now')
    })

    it('returns "now" for timestamps 999ms ago', () => {
      const ts = Date.now() - 999
      expect(formatRelativeTime(ts)).toBe('now')
    })

    it('returns seconds for timestamps 1-59 seconds ago', () => {
      expect(formatRelativeTime(Date.now() - 1000)).toBe('1s ago')
      expect(formatRelativeTime(Date.now() - 30000)).toBe('30s ago')
      expect(formatRelativeTime(Date.now() - 59999)).toBe('59s ago')
    })

    it('returns minutes for timestamps 1-59 minutes ago', () => {
      expect(formatRelativeTime(Date.now() - 60000)).toBe('1m ago')
      expect(formatRelativeTime(Date.now() - 1800000)).toBe('30m ago')
      expect(formatRelativeTime(Date.now() - 3599999)).toBe('59m ago')
    })

    it('returns hours for timestamps 1-23 hours ago', () => {
      expect(formatRelativeTime(Date.now() - 3600000)).toBe('1h ago')
      expect(formatRelativeTime(Date.now() - 43200000)).toBe('12h ago')
      expect(formatRelativeTime(Date.now() - 86399999)).toBe('23h ago')
    })

    it('returns days for timestamps 1+ days ago', () => {
      expect(formatRelativeTime(Date.now() - 86400000)).toBe('1d ago')
      expect(formatRelativeTime(Date.now() - 172800000)).toBe('2d ago')
      expect(formatRelativeTime(Date.now() - 604800000)).toBe('7d ago')
    })
  })

  describe('formatDuration', () => {
    it('returns milliseconds for durations under 1 second', () => {
      expect(formatDuration(0)).toBe('0ms')
      expect(formatDuration(1)).toBe('1ms')
      expect(formatDuration(500)).toBe('500ms')
      expect(formatDuration(999)).toBe('999ms')
    })

    it('returns seconds for durations 1-59 seconds', () => {
      expect(formatDuration(1000)).toBe('1s')
      expect(formatDuration(30000)).toBe('30s')
      expect(formatDuration(59999)).toBe('59s')
    })

    it('returns minutes and seconds for durations 1-59 minutes', () => {
      expect(formatDuration(60000)).toBe('1m 0s')
      expect(formatDuration(90000)).toBe('1m 30s')
      expect(formatDuration(3599999)).toBe('59m 59s')
    })

    it('returns hours and minutes for durations 1+ hours', () => {
      expect(formatDuration(3600000)).toBe('1h 0m')
      expect(formatDuration(5400000)).toBe('1h 30m')
      expect(formatDuration(7200000)).toBe('2h 0m')
      expect(formatDuration(86400000)).toBe('24h 0m')
    })
  })

  // =========================================================================
  // Value Formatting
  // =========================================================================

  describe('formatCost', () => {
    it('returns empty string for undefined cost', () => {
      expect(formatCost(undefined)).toBe('')
    })

    it('returns empty string for zero cost', () => {
      expect(formatCost(0)).toBe('')
    })

    it('returns 4 decimal places for costs under $0.01', () => {
      expect(formatCost(0.001)).toBe('$0.0010')
      expect(formatCost(0.0099)).toBe('$0.0099')
      expect(formatCost(0.00001)).toBe('$0.0000')
    })

    it('returns 2 decimal places for costs $0.01 and above', () => {
      expect(formatCost(0.01)).toBe('$0.01')
      expect(formatCost(0.10)).toBe('$0.10')
      expect(formatCost(1.00)).toBe('$1.00')
      expect(formatCost(10.50)).toBe('$10.50')
      expect(formatCost(100.999)).toBe('$101.00')
    })
  })

  describe('formatTokens', () => {
    it('returns empty string for undefined tokens', () => {
      expect(formatTokens(undefined)).toBe('')
    })

    it('returns empty string for zero tokens', () => {
      expect(formatTokens(0)).toBe('')
    })

    it('returns raw number for tokens under 1000', () => {
      expect(formatTokens(1)).toBe('1')
      expect(formatTokens(500)).toBe('500')
      expect(formatTokens(999)).toBe('999')
    })

    it('returns k format for tokens 1000-999999', () => {
      expect(formatTokens(1000)).toBe('1.0k')
      expect(formatTokens(1500)).toBe('1.5k')
      expect(formatTokens(10000)).toBe('10.0k')
      expect(formatTokens(999999)).toBe('1000.0k')
    })

    it('returns M format for tokens 1000000+', () => {
      expect(formatTokens(1000000)).toBe('1.00M')
      expect(formatTokens(1500000)).toBe('1.50M')
      expect(formatTokens(10000000)).toBe('10.00M')
    })
  })

  // =========================================================================
  // Text Manipulation
  // =========================================================================

  describe('truncate', () => {
    it('returns empty string for empty input', () => {
      expect(truncate('', 10)).toBe('')
    })

    it('returns original string if shorter than maxLen', () => {
      expect(truncate('hello', 10)).toBe('hello')
      expect(truncate('hello', 5)).toBe('hello')
    })

    it('truncates and adds ellipsis for strings longer than maxLen', () => {
      expect(truncate('hello world', 8)).toBe('hello...')
      expect(truncate('hello world', 10)).toBe('hello w...')
    })

    it('handles edge case where maxLen equals string length', () => {
      expect(truncate('hello', 5)).toBe('hello')
    })

    it('handles very short maxLen values', () => {
      expect(truncate('hello', 4)).toBe('h...')
      expect(truncate('hello', 3)).toBe('...')
    })
  })

  describe('wrapText', () => {
    it('returns array with empty string for empty input', () => {
      expect(wrapText('', 10)).toEqual([''])
    })

    it('returns original text as single line if shorter than maxWidth', () => {
      expect(wrapText('hello', 10)).toEqual(['hello'])
    })

    it('returns original text for zero or negative maxWidth', () => {
      expect(wrapText('hello world', 0)).toEqual(['hello world'])
      expect(wrapText('hello world', -5)).toEqual(['hello world'])
    })

    it('wraps text at word boundaries', () => {
      expect(wrapText('hello world foo bar', 11)).toEqual(['hello world', 'foo bar'])
    })

    it('breaks long words that exceed maxWidth', () => {
      expect(wrapText('superlongword', 5)).toEqual(['super', 'longw', 'ord'])
    })

    it('handles multiple spaces correctly', () => {
      const result = wrapText('hello world', 6)
      expect(result).toEqual(['hello', 'world'])
    })

    it('handles text that wraps into multiple lines', () => {
      const text = 'The quick brown fox jumps over the lazy dog'
      const result = wrapText(text, 15)
      expect(result.length).toBeGreaterThan(1)
      result.forEach(line => {
        expect(line.length).toBeLessThanOrEqual(15)
      })
    })

    it('handles text that ends exactly at maxWidth boundary', () => {
      // This tests the edge case where remaining becomes empty
      const result = wrapText('hello', 5)
      expect(result).toEqual(['hello'])
    })

    it('handles single word exactly at boundary with trailing content', () => {
      // Tests breakPoint at exactly maxWidth
      const result = wrapText('12345 67890', 5)
      expect(result).toEqual(['12345', '67890'])
    })
  })

  describe('escapeShell', () => {
    it('returns unmodified string if no single quotes', () => {
      expect(escapeShell('hello world')).toBe('hello world')
      expect(escapeShell('test 123')).toBe('test 123')
    })

    it('escapes single quotes properly', () => {
      expect(escapeShell("don't")).toBe("don'\\''t")
      expect(escapeShell("it's")).toBe("it'\\''s")
    })

    it('handles multiple single quotes', () => {
      expect(escapeShell("it's a 'test'")).toBe("it'\\''s a '\\''test'\\''")
    })

    it('handles empty string', () => {
      expect(escapeShell('')).toBe('')
    })
  })

  // =========================================================================
  // Status Helpers
  // =========================================================================

  describe('getEffectiveStatus', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "stale" if timestamp is older than STALE_TIMEOUT_MS', () => {
      const instance = createInstance({
        status: 'idle',
        ts: Date.now() - 130000, // 130 seconds ago (stale timeout is 120s)
      })
      expect(getEffectiveStatus(instance)).toBe('stale')
    })

    it('returns "stale" for shutdown status', () => {
      const instance = createInstance({
        status: 'shutdown',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('stale')
    })

    it('returns "busy" for busy status', () => {
      const instance = createInstance({
        status: 'busy',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('busy')
    })

    it('returns "busy" for running status', () => {
      const instance = createInstance({
        status: 'running',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('busy')
    })

    it('returns "busy" for pending status', () => {
      const instance = createInstance({
        status: 'pending',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('busy')
    })

    it('returns "idle" for idle status', () => {
      const instance = createInstance({
        status: 'idle',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('idle')
    })

    it('returns "idle" for unknown status values', () => {
      const instance = createInstance({
        status: 'unknown',
        ts: Date.now(),
      })
      expect(getEffectiveStatus(instance)).toBe('idle')
    })
  })

  describe('isLongRunning', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      busySince.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
      busySince.clear()
    })

    it('returns false for non-busy instances', () => {
      const instance = createInstance({
        status: 'idle',
        ts: Date.now(),
      })
      expect(isLongRunning(instance)).toBe(false)
    })

    it('returns false for busy instances without busySince entry', () => {
      const instance = createInstance({
        status: 'busy',
        ts: Date.now(),
      })
      expect(isLongRunning(instance)).toBe(false)
    })

    it('returns false for busy instances under the threshold', () => {
      const instance = createInstance({
        instanceId: 'test-1',
        status: 'busy',
        ts: Date.now(),
      })
      busySince.set('test-1', Date.now() - 300000) // 5 minutes ago
      expect(isLongRunning(instance)).toBe(false)
    })

    it('returns true for busy instances over the threshold', () => {
      const instance = createInstance({
        instanceId: 'test-1',
        status: 'busy',
        ts: Date.now(),
      })
      busySince.set('test-1', Date.now() - 700000) // 11+ minutes ago
      expect(isLongRunning(instance)).toBe(true)
    })

    it('returns true for busy instances exactly at the threshold', () => {
      const instance = createInstance({
        instanceId: 'test-1',
        status: 'busy',
        ts: Date.now(),
      })
      busySince.set('test-1', Date.now() - 600001) // Just over 10 minutes
      expect(isLongRunning(instance)).toBe(true)
    })
  })

  describe('getBusyDuration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      busySince.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
      busySince.clear()
    })

    it('returns 0 if no busySince entry exists', () => {
      const instance = createInstance({ instanceId: 'test-1' })
      expect(getBusyDuration(instance)).toBe(0)
    })

    it('returns correct duration from busySince', () => {
      const instance = createInstance({ instanceId: 'test-1' })
      busySince.set('test-1', Date.now() - 30000) // 30 seconds ago
      expect(getBusyDuration(instance)).toBe(30000)
    })
  })

  // =========================================================================
  // Instance Grouping
  // =========================================================================

  describe('getGroupKey', () => {
    it('uses project and branch if available', () => {
      const instance = createInstance({
        project: 'my-project',
        branch: 'feature-x',
      })
      expect(getGroupKey(instance)).toBe('my-project:feature-x')
    })

    it('falls back to dirName if project is not available', () => {
      const instance = createInstance({
        dirName: 'my-dir',
        branch: 'main',
      })
      expect(getGroupKey(instance)).toBe('my-dir:main')
    })

    it('uses "unknown" if neither project nor dirName is available', () => {
      const instance = createInstance({
        branch: 'main',
      })
      expect(getGroupKey(instance)).toBe('unknown:main')
    })

    it('defaults to "main" if branch is not available', () => {
      const instance = createInstance({
        project: 'my-project',
      })
      expect(getGroupKey(instance)).toBe('my-project:main')
    })

    it('handles all defaults', () => {
      const instance = createInstance({})
      expect(getGroupKey(instance)).toBe('unknown:main')
    })
  })

  describe('getSortedInstances', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      instances.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
      instances.clear()
    })

    it('returns empty array when no instances', () => {
      expect(getSortedInstances()).toEqual([])
    })

    it('returns instances sorted by instanceId', () => {
      instances.set('c', createInstance({ instanceId: 'c', ts: Date.now() }))
      instances.set('a', createInstance({ instanceId: 'a', ts: Date.now() }))
      instances.set('b', createInstance({ instanceId: 'b', ts: Date.now() }))

      const result = getSortedInstances()
      expect(result.map(i => i.instanceId)).toEqual(['a', 'b', 'c'])
    })

    it('removes instances older than 2x STALE_TIMEOUT_MS', () => {
      const oldTs = Date.now() - 250000 // Older than 2x 120000
      const newTs = Date.now()

      instances.set('old', createInstance({ instanceId: 'old', ts: oldTs }))
      instances.set('new', createInstance({ instanceId: 'new', ts: newTs }))

      getSortedInstances()

      expect(instances.has('old')).toBe(false)
      expect(instances.has('new')).toBe(true)
    })

    it('handles instances with undefined instanceId gracefully', () => {
      instances.set('a', createInstance({ instanceId: 'a', ts: Date.now() }))
      instances.set('b', { ...createInstance({ ts: Date.now() }), instanceId: undefined as any })

      const result = getSortedInstances()
      expect(result.length).toBe(2)
    })

    it('handles instances with empty string instanceId', () => {
      instances.set('a', createInstance({ instanceId: 'a', ts: Date.now() }))
      instances.set('', createInstance({ instanceId: '', ts: Date.now() }))

      const result = getSortedInstances()
      // Empty string sorts before 'a'
      expect(result[0].instanceId).toBe('')
      expect(result[1].instanceId).toBe('a')
    })

    it('sorts correctly when both instanceIds are falsy', () => {
      instances.set('key1', { ...createInstance({ ts: Date.now() }), instanceId: '' as any })
      instances.set('key2', { ...createInstance({ ts: Date.now() }), instanceId: undefined as any })

      const result = getSortedInstances()
      expect(result.length).toBe(2)
    })
  })

  describe('getGroupedInstances', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      instances.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
      instances.clear()
    })

    it('returns empty array when no instances', () => {
      expect(getGroupedInstances()).toEqual([])
    })

    it('groups instances by project:branch', () => {
      instances.set('1', createInstance({
        instanceId: '1',
        project: 'proj-a',
        branch: 'main',
        ts: Date.now(),
      }))
      instances.set('2', createInstance({
        instanceId: '2',
        project: 'proj-a',
        branch: 'main',
        ts: Date.now(),
      }))
      instances.set('3', createInstance({
        instanceId: '3',
        project: 'proj-b',
        branch: 'feature',
        ts: Date.now(),
      }))

      const result = getGroupedInstances()

      expect(result.length).toBe(2)
      expect(result.map(([key]) => key).sort()).toEqual(['proj-a:main', 'proj-b:feature'])
    })

    it('sorts groups alphabetically by key', () => {
      instances.set('1', createInstance({
        instanceId: '1',
        project: 'zebra',
        branch: 'main',
        ts: Date.now(),
      }))
      instances.set('2', createInstance({
        instanceId: '2',
        project: 'alpha',
        branch: 'main',
        ts: Date.now(),
      }))

      const result = getGroupedInstances()

      expect(result[0][0]).toBe('alpha:main')
      expect(result[1][0]).toBe('zebra:main')
    })
  })

  // =========================================================================
  // Statistics
  // =========================================================================

  describe('countByStatus', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      instances.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
      instances.clear()
    })

    it('returns zeros when no instances', () => {
      expect(countByStatus()).toEqual({ idle: 0, busy: 0, stale: 0 })
    })

    it('counts instances by effective status', () => {
      instances.set('idle-1', createInstance({
        instanceId: 'idle-1',
        status: 'idle',
        ts: Date.now(),
      }))
      instances.set('idle-2', createInstance({
        instanceId: 'idle-2',
        status: 'idle',
        ts: Date.now(),
      }))
      instances.set('busy-1', createInstance({
        instanceId: 'busy-1',
        status: 'busy',
        ts: Date.now(),
      }))
      instances.set('stale-1', createInstance({
        instanceId: 'stale-1',
        status: 'shutdown',
        ts: Date.now(),
      }))

      expect(countByStatus()).toEqual({ idle: 2, busy: 1, stale: 1 })
    })
  })

  describe('getGroupStats', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns zeros for empty instance array', () => {
      expect(getGroupStats([])).toEqual({
        idle: 0,
        busy: 0,
        stale: 0,
        cost: 0,
        tokens: 0,
      })
    })

    it('aggregates status counts', () => {
      const insts = [
        createInstance({ status: 'idle', ts: Date.now() }),
        createInstance({ status: 'busy', ts: Date.now() }),
        createInstance({ status: 'idle', ts: Date.now() }),
      ]

      const stats = getGroupStats(insts)

      expect(stats.idle).toBe(2)
      expect(stats.busy).toBe(1)
      expect(stats.stale).toBe(0)
    })

    it('aggregates cost', () => {
      const insts = [
        createInstance({ cost: 0.10, ts: Date.now() }),
        createInstance({ cost: 0.25, ts: Date.now() }),
        createInstance({ cost: undefined, ts: Date.now() }),
      ]

      const stats = getGroupStats(insts)

      expect(stats.cost).toBeCloseTo(0.35)
    })

    it('aggregates tokens', () => {
      const insts = [
        createInstance({ tokens: { input: 100, output: 50, total: 150 }, ts: Date.now() }),
        createInstance({ tokens: { input: 200, output: 100, total: 300 }, ts: Date.now() }),
        createInstance({ tokens: undefined, ts: Date.now() }),
      ]

      const stats = getGroupStats(insts)

      expect(stats.tokens).toBe(450)
    })
  })

  // =========================================================================
  // Tool Arguments Formatting
  // =========================================================================

  describe('formatToolArgs', () => {
    it('returns empty string for undefined args', () => {
      expect(formatToolArgs(undefined)).toBe('')
    })

    it('returns empty string for empty object', () => {
      expect(formatToolArgs({})).toBe('')
    })

    it('formats string values', () => {
      const args = { name: 'test', value: 'hello' }
      expect(formatToolArgs(args)).toBe('name: test, value: hello')
    })

    it('truncates long string values to 50 chars', () => {
      const longString = 'a'.repeat(60)
      const args = { text: longString }
      const result = formatToolArgs(args)
      expect(result).toBe(`text: ${'a'.repeat(47)}...`)
    })

    it('formats object values as [object]', () => {
      const args = { config: { nested: 'value' } }
      expect(formatToolArgs(args)).toBe('config: [object]')
    })

    it('formats numeric values', () => {
      const args = { count: 42, price: 3.14 }
      expect(formatToolArgs(args)).toBe('count: 42, price: 3.14')
    })

    it('formats boolean values', () => {
      const args = { enabled: true, disabled: false }
      expect(formatToolArgs(args)).toBe('enabled: true, disabled: false')
    })

    it('formats null values as [object]', () => {
      // Note: typeof null === 'object' in JavaScript
      const args = { value: null }
      expect(formatToolArgs(args)).toBe('value: [object]')
    })

    it('handles mixed value types', () => {
      const args = {
        name: 'test',
        count: 5,
        active: true,
        config: { foo: 'bar' },
      }
      expect(formatToolArgs(args)).toBe('name: test, count: 5, active: true, config: [object]')
    })

    it('formats array values as [object]', () => {
      const args = { items: [1, 2, 3] }
      expect(formatToolArgs(args)).toBe('items: [object]')
    })
  })
})
