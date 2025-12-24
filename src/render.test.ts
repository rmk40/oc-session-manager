import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import type { Instance, SelectableItem, RenderedLine, Permission } from './types.js'

// ---------------------------------------------------------------------------
// Mock Storage - using module-level objects that get reset
// ---------------------------------------------------------------------------

// We use objects/Maps that are created at module load time and reset in beforeEach
const mockState = {
  instances: new Map<string, Instance>(),
  busySince: new Map<string, number>(),
  idleSince: new Map<string, number>(),
  collapsedGroups: new Set<string>(),
  sessionViewPendingPermissions: new Map<string, Permission>(),
  viewMode: 'grouped' as 'grouped' | 'flat',
  selectedIndex: -1,
  selectableItems: [] as SelectableItem[],
  detailView: null as string | null,
  spinnerFrame: 0,
  termWidth: 80,
  termHeight: 24,
  sessionViewActive: false,
  sessionViewInstance: null as Instance | null,
  sessionViewSessionID: null as string | null,
  sessionViewRenderedLines: [] as RenderedLine[],
  sessionViewInputMode: false,
  sessionViewInputBuffer: '',
  sessionViewConfirmAbort: false,
  sessionViewError: null as string | null,
  sessionViewConnecting: false,
  sessionViewStatus: 'idle',
  sessionViewSessions: [] as any[],
  sessionViewSessionIndex: 0,
  sessionViewSessionTitle: '',
  sessionViewScrollOffset: 0,
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./state.js', () => ({
  get instances() { return mockState.instances },
  get busySince() { return mockState.busySince },
  get idleSince() { return mockState.idleSince },
  get collapsedGroups() { return mockState.collapsedGroups },
  get viewMode() { return mockState.viewMode },
  get selectedIndex() { return mockState.selectedIndex },
  get selectableItems() { return mockState.selectableItems },
  get detailView() { return mockState.detailView },
  get spinnerFrame() { return mockState.spinnerFrame },
  get termWidth() { return mockState.termWidth },
  get termHeight() { return mockState.termHeight },
  get sessionViewActive() { return mockState.sessionViewActive },
  get sessionViewInstance() { return mockState.sessionViewInstance },
  get sessionViewSessionID() { return mockState.sessionViewSessionID },
  get sessionViewRenderedLines() { return mockState.sessionViewRenderedLines },
  get sessionViewPendingPermissions() { return mockState.sessionViewPendingPermissions },
  get sessionViewInputMode() { return mockState.sessionViewInputMode },
  get sessionViewInputBuffer() { return mockState.sessionViewInputBuffer },
  get sessionViewConfirmAbort() { return mockState.sessionViewConfirmAbort },
  get sessionViewError() { return mockState.sessionViewError },
  get sessionViewConnecting() { return mockState.sessionViewConnecting },
  get sessionViewStatus() { return mockState.sessionViewStatus },
  get sessionViewSessions() { return mockState.sessionViewSessions },
  get sessionViewSessionIndex() { return mockState.sessionViewSessionIndex },
  get sessionViewSessionTitle() { return mockState.sessionViewSessionTitle },
  get sessionViewScrollOffset() { return mockState.sessionViewScrollOffset },
  setViewMode: vi.fn((mode: 'grouped' | 'flat') => { mockState.viewMode = mode }),
  setSelectedIndex: vi.fn((idx: number) => { mockState.selectedIndex = idx }),
  setSelectableItems: vi.fn((items: SelectableItem[]) => { mockState.selectableItems = items }),
  setDetailView: vi.fn((view: string | null) => { mockState.detailView = view }),
  setSpinnerFrame: vi.fn((frame: number) => { mockState.spinnerFrame = frame }),
  setTermSize: vi.fn((width: number, height: number) => {
    mockState.termWidth = width
    mockState.termHeight = height
  }),
}))

// Mock config module
vi.mock('./config.js', () => ({
  ANSI: {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h',
    cursorHome: '\x1b[H',
    clearScreen: '\x1b[2J',
    clearLine: '\x1b[2K',
    inverse: '\x1b[7m',
  },
  SPINNER: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  STALE_TIMEOUT_MS: 120000,
  LONG_RUNNING_MS: 600000,
}))

// Mock utils module
vi.mock('./utils.js', () => ({
  formatRelativeTime: vi.fn((ts: number) => {
    const diff = Date.now() - ts
    if (diff < 1000) return 'now'
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
    return `${Math.floor(diff / 60000)}m ago`
  }),
  formatDuration: vi.fn((ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }),
  formatCost: vi.fn((cost: number | undefined) => {
    if (!cost || cost === 0) return ''
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
  }),
  formatTokens: vi.fn((tokens: number | undefined) => {
    if (!tokens) return ''
    if (tokens < 1000) return String(tokens)
    return `${(tokens / 1000).toFixed(1)}k`
  }),
  truncate: vi.fn((str: string, maxLen: number) => {
    if (!str) return ''
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 3) + '...'
  }),
  getEffectiveStatus: vi.fn((inst: Instance) => {
    if (inst.status === 'shutdown') return 'stale'
    if (inst.status === 'busy' || inst.status === 'running' || inst.status === 'pending') return 'busy'
    return 'idle'
  }),
  isLongRunning: vi.fn(() => false),
  getBusyDuration: vi.fn((inst: Instance) => {
    const busyStart = mockState.busySince.get(inst.instanceId)
    if (!busyStart) return 0
    return Date.now() - busyStart
  }),
  getGroupKey: vi.fn((inst: Instance) => {
    const project = inst.project || inst.dirName || 'unknown'
    const branch = inst.branch || 'main'
    return `${project}:${branch}`
  }),
  getSortedInstances: vi.fn(() => {
    return Array.from(mockState.instances.values()).sort((a, b) =>
      (a.instanceId || '').localeCompare(b.instanceId || '')
    )
  }),
  getGroupedInstances: vi.fn(() => {
    const sorted = Array.from(mockState.instances.values()).sort((a, b) =>
      (a.instanceId || '').localeCompare(b.instanceId || '')
    )
    const groups = new Map<string, Instance[]>()
    for (const inst of sorted) {
      const project = inst.project || inst.dirName || 'unknown'
      const branch = inst.branch || 'main'
      const key = `${project}:${branch}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(inst)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }),
  countByStatus: vi.fn(() => {
    const counts = { idle: 0, busy: 0, stale: 0 }
    for (const inst of mockState.instances.values()) {
      if (inst.status === 'shutdown') counts.stale++
      else if (inst.status === 'busy' || inst.status === 'running' || inst.status === 'pending') counts.busy++
      else counts.idle++
    }
    return counts
  }),
  getGroupStats: vi.fn((insts: Instance[]) => {
    const stats = { idle: 0, busy: 0, stale: 0, cost: 0, tokens: 0 }
    for (const inst of insts) {
      if (inst.status === 'shutdown') stats.stale++
      else if (inst.status === 'busy' || inst.status === 'running' || inst.status === 'pending') stats.busy++
      else stats.idle++
      stats.cost += inst.cost || 0
      stats.tokens += inst.tokens?.total || 0
    }
    return stats
  }),
  formatToolArgs: vi.fn((args: Record<string, unknown> | undefined) => {
    if (!args || Object.keys(args).length === 0) return ''
    return Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(', ')
  }),
}))

// Import render module after mocks are set up
import { render } from './render.js'
import {
  setSelectableItems,
  setSpinnerFrame,
  setDetailView,
} from './state.js'
import {
  isLongRunning,
} from './utils.js'

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    instanceId: 'test-instance-1',
    status: 'idle',
    ts: Date.now(),
    ...overrides,
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function resetMockState(): void {
  mockState.instances.clear()
  mockState.busySince.clear()
  mockState.idleSince.clear()
  mockState.collapsedGroups.clear()
  mockState.sessionViewPendingPermissions.clear()
  mockState.viewMode = 'grouped'
  mockState.selectedIndex = -1
  mockState.selectableItems = []
  mockState.detailView = null
  mockState.spinnerFrame = 0
  mockState.termWidth = 80
  mockState.termHeight = 24
  mockState.sessionViewActive = false
  mockState.sessionViewInstance = null
  mockState.sessionViewSessionID = null
  mockState.sessionViewRenderedLines = []
  mockState.sessionViewInputMode = false
  mockState.sessionViewInputBuffer = ''
  mockState.sessionViewConfirmAbort = false
  mockState.sessionViewError = null
  mockState.sessionViewConnecting = false
  mockState.sessionViewStatus = 'idle'
  mockState.sessionViewSessions = []
  mockState.sessionViewSessionIndex = 0
  mockState.sessionViewSessionTitle = ''
  mockState.sessionViewScrollOffset = 0

  // Reset mocks
  vi.mocked(setSelectableItems).mockClear()
  vi.mocked(setSpinnerFrame).mockClear()
  vi.mocked(setDetailView).mockClear()
  vi.mocked(isLongRunning).mockReset()
  vi.mocked(isLongRunning).mockReturnValue(false)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('render', () => {
  let stdoutWriteMock: Mock
  let originalWrite: typeof process.stdout.write

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    resetMockState()

    // Mock process.stdout.write
    originalWrite = process.stdout.write
    stdoutWriteMock = vi.fn()
    process.stdout.write = stdoutWriteMock as any
  })

  afterEach(() => {
    vi.useRealTimers()
    process.stdout.write = originalWrite
  })

  // =========================================================================
  // Main Render Function
  // =========================================================================

  describe('render()', () => {
    it('writes output to stdout', () => {
      render()
      expect(stdoutWriteMock).toHaveBeenCalled()
    })

    it('starts output with clear screen and cursor home', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      expect(output.startsWith('\x1b[2J\x1b[H')).toBe(true)
    })

    it('renders grouped view by default', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('oc-session-manager')
      expect(plain).not.toContain('(flat)')
    })

    it('renders flat view when viewMode is flat', () => {
      mockState.viewMode = 'flat'
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('oc-session-manager (flat)')
    })

    it('renders detail view when detailView is set', () => {
      const inst = createInstance({
        instanceId: 'detail-test',
        sessionID: 'session-abc123',
        dirName: 'my-project',
        branch: 'main',
        status: 'idle',
      })
      mockState.instances.set('detail-test', inst)
      mockState.detailView = 'detail-test'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('my-project:main:c123')
      expect(plain).toContain('Status:')
      expect(plain).toContain('Session ID:')
    })

    it('clears detail view and renders main view when instance not found', () => {
      mockState.detailView = 'non-existent-id'

      render()

      expect(setDetailView).toHaveBeenCalledWith(null)
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('oc-session-manager')
    })

    it('renders session view when sessionViewActive is true', () => {
      mockState.sessionViewActive = true
      mockState.sessionViewInstance = createInstance({
        instanceId: 'session-inst',
        dirName: 'test-project',
        branch: 'feature',
      })
      mockState.sessionViewSessionID = 'session-xyz789'
      mockState.sessionViewStatus = 'idle'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('test-project:feature:z789')
      expect(plain).toContain('IDLE')
    })
  })

  // =========================================================================
  // Grouped View
  // =========================================================================

  describe('grouped view', () => {
    beforeEach(() => {
      mockState.viewMode = 'grouped'
    })

    it('shows "No OpenCode instances detected" when empty', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('No OpenCode instances detected')
    })

    it('displays status summary bar', () => {
      mockState.instances.set('idle-1', createInstance({ instanceId: 'idle-1', status: 'idle' }))
      mockState.instances.set('busy-1', createInstance({ instanceId: 'busy-1', status: 'busy' }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('IDLE')
      expect(plain).toContain('BUSY')
      expect(plain).toContain('STALE')
      expect(plain).toContain('Total:')
    })

    it('displays group headers with project:branch', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        project: 'my-project',
        branch: 'main',
        status: 'idle',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('my-project')
      expect(plain).toContain(':main')
    })

    it('displays instance rows with session ID and title', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        sessionID: 'session-abcd1234',
        project: 'my-project',
        branch: 'main',
        status: 'idle',
        title: 'Working on feature',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('1234') // Last 4 chars of session ID
      expect(plain).toContain('Working on feature')
    })

    it('displays cost and token information', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        sessionID: 'session-abcd1234',
        project: 'my-project',
        branch: 'main',
        status: 'idle',
        cost: 0.50,
        tokens: { input: 1000, output: 500, total: 1500 },
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('$0.50')
      expect(plain).toContain('1.5k')
    })

    it('shows expand/collapse icon for groups', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        project: 'my-project',
        branch: 'main',
      }))

      render()
      let output = stdoutWriteMock.mock.calls[0][0]
      let plain = stripAnsi(output)
      expect(plain).toContain('▼') // Expanded by default

      // Collapse the group
      mockState.collapsedGroups.add('my-project:main')
      render()
      output = stdoutWriteMock.mock.calls[1][0]
      plain = stripAnsi(output)
      expect(plain).toContain('▶') // Collapsed
    })

    it('hides instances when group is collapsed', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        sessionID: 'session-uniqueid1',
        project: 'my-project',
        branch: 'main',
        title: 'Unique Title ABC',
      }))

      // Expanded - should show instance
      render()
      let output = stdoutWriteMock.mock.calls[0][0]
      let plain = stripAnsi(output)
      expect(plain).toContain('Unique Title ABC')

      // Collapsed - should not show instance
      mockState.collapsedGroups.add('my-project:main')
      render()
      output = stdoutWriteMock.mock.calls[1][0]
      plain = stripAnsi(output)
      expect(plain).not.toContain('Unique Title ABC')
    })

    it('updates selectable items', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        project: 'proj-a',
        branch: 'main',
      }))
      mockState.instances.set('inst-2', createInstance({
        instanceId: 'inst-2',
        project: 'proj-a',
        branch: 'main',
      }))

      render()

      expect(setSelectableItems).toHaveBeenCalled()
      const items = vi.mocked(setSelectableItems).mock.calls[0][0]
      // Should have 1 group + 2 instances
      expect(items.length).toBe(3)
      expect(items[0].type).toBe('group')
      expect(items[1].type).toBe('instance')
      expect(items[2].type).toBe('instance')
    })

    it('increments spinner frame on each render', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        status: 'busy',
        project: 'my-project',
      }))

      render()
      expect(setSpinnerFrame).toHaveBeenCalledWith(1)

      mockState.spinnerFrame = 1
      render()
      expect(setSpinnerFrame).toHaveBeenCalledWith(2)
    })

    it('shows status icons with correct colors', () => {
      mockState.instances.set('idle-1', createInstance({
        instanceId: 'idle-1',
        status: 'idle',
        project: 'proj-a',
      }))
      mockState.instances.set('busy-1', createInstance({
        instanceId: 'busy-1',
        status: 'busy',
        project: 'proj-b',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]

      // Check for green color code with idle icon
      expect(output).toContain('\x1b[32m●') // Green idle
      // Check for yellow color code with spinner (first spinner char)
      expect(output).toContain('\x1b[33m') // Yellow for busy
    })

    it('shows help line at the bottom', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('q: quit')
      expect(plain).toContain('Enter: watch')
      expect(plain).toContain('Tab: flat')
    })

    it('highlights selected row with inverse', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        project: 'my-project',
        branch: 'main',
      }))
      mockState.selectedIndex = 0 // Select the group header

      render()
      const output = stdoutWriteMock.mock.calls[0][0]

      // Should contain inverse ANSI code
      expect(output).toContain('\x1b[7m')
    })

    it('limits displayed rows to terminal height', () => {
      // Create many instances
      for (let i = 0; i < 50; i++) {
        mockState.instances.set(`inst-${i}`, createInstance({
          instanceId: `inst-${i}`,
          project: 'proj',
          branch: 'main',
        }))
      }

      mockState.termHeight = 15 // Very small terminal

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      const lines = plain.split('\n')

      // Should not exceed terminal height
      expect(lines.length).toBeLessThanOrEqual(mockState.termHeight + 2) // +2 for help line
    })

    it('changes title color to yellow when sessions are busy', () => {
      mockState.instances.set('busy-1', createInstance({
        instanceId: 'busy-1',
        status: 'busy',
        project: 'my-project',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]

      // Title should be yellow when busy
      expect(output).toContain('\x1b[33m oc-session-manager') // Yellow title
    })

    it('keeps title white when no sessions are busy', () => {
      mockState.instances.set('idle-1', createInstance({
        instanceId: 'idle-1',
        status: 'idle',
        project: 'my-project',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]

      // Title should be white when idle
      expect(output).toContain('\x1b[37m oc-session-manager') // White title
    })
  })

  // =========================================================================
  // Flat View
  // =========================================================================

  describe('flat view', () => {
    beforeEach(() => {
      mockState.viewMode = 'flat'
    })

    it('shows (flat) in title', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('oc-session-manager (flat)')
    })

    it('shows "No OpenCode instances detected" when empty', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('No OpenCode instances detected')
    })

    it('displays instances with full identifier', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        sessionID: 'session-abcd1234',
        dirName: 'my-project',
        branch: 'feature-x',
        status: 'idle',
        title: 'Testing feature',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      // Flat view shows project:branch:shortSession, may be truncated
      expect(plain).toContain('my-project:feature-x')
      expect(plain).toContain('Testing feature')
    })

    it('shows truncation notice when there are more instances than fit', () => {
      for (let i = 0; i < 30; i++) {
        mockState.instances.set(`inst-${i}`, createInstance({
          instanceId: `inst-${i}`,
          dirName: 'proj',
          branch: 'main',
        }))
      }

      mockState.termHeight = 15 // Small terminal

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('... and')
      expect(plain).toContain('more instances')
    })

    it('shows Tab: grouped in help line', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)
      expect(plain).toContain('Tab: grouped')
    })

    it('displays status icons correctly', () => {
      mockState.instances.set('idle-1', createInstance({
        instanceId: 'idle-1',
        status: 'idle',
        dirName: 'proj',
      }))
      mockState.instances.set('busy-1', createInstance({
        instanceId: 'busy-1',
        status: 'busy',
        dirName: 'proj',
      }))
      mockState.instances.set('stale-1', createInstance({
        instanceId: 'stale-1',
        status: 'shutdown',
        dirName: 'proj',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('●') // Idle icon
      expect(plain).toContain('◌') // Stale icon
    })

    it('updates selectable items with all instances', () => {
      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        dirName: 'proj',
      }))
      mockState.instances.set('inst-2', createInstance({
        instanceId: 'inst-2',
        dirName: 'proj',
      }))

      render()

      expect(setSelectableItems).toHaveBeenCalled()
      const items = vi.mocked(setSelectableItems).mock.calls[0][0]
      expect(items.length).toBe(2)
      expect(items.every(i => i.type === 'instance')).toBe(true)
    })
  })

  // =========================================================================
  // Detail View
  // =========================================================================

  describe('detail view', () => {
    it('shows instance status', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        status: 'idle',
        dirName: 'my-proj',
        branch: 'main',
        sessionID: 'sess-1234',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Status:')
      expect(plain).toContain('IDLE')
    })

    it('shows session ID', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'session-full-id-12345',
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Session ID: session-full-id-12345')
    })

    it('shows parent ID when present', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'child-session',
        parentID: 'parent-session-id',
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Parent ID: parent-session-id')
    })

    it('shows title, directory, and host', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        title: 'Implementing feature X',
        directory: '/home/user/projects/my-proj',
        host: 'dev-machine',
        dirName: 'my-proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Title: Implementing feature X')
      expect(plain).toContain('Directory: /home/user/projects/my-proj')
      expect(plain).toContain('Host: dev-machine')
    })

    it('shows model and cost information', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        model: 'claude-sonnet-4',
        cost: 0.25,
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Model: claude-sonnet-4')
      expect(plain).toContain('Cost: $0.25')
    })

    it('shows token breakdown', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        tokens: { input: 1500, output: 800, total: 2300 },
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Tokens:')
      expect(plain).toContain('2,300 total')
      expect(plain).toContain('1,500 in')
      expect(plain).toContain('800 out')
    })

    it('shows last update time', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        ts: Date.now() - 30000, // 30 seconds ago
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Last Update:')
      expect(plain).toContain('30s ago')
    })

    it('shows busy duration for busy instances', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        status: 'busy',
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.busySince.set('detail-1', Date.now() - 120000) // 2 minutes
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Busy For:')
      expect(plain).toContain('2m 0s')
    })

    it('shows long running warning for sessions busy > threshold', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        status: 'busy',
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.busySince.set('detail-1', Date.now() - 700000) // 11+ minutes
      mockState.detailView = 'detail-1'

      // Make isLongRunning return true
      vi.mocked(isLongRunning).mockReturnValue(true)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('LONG RUNNING')
    })

    it('shows total busy time when present', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        busyTime: 300000, // 5 minutes total
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Total Busy Time:')
      expect(plain).toContain('5m 0s')
    })

    it('shows help line with Esc/Enter to go back', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        sessionID: 'sess',
        dirName: 'proj',
        branch: 'main',
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Esc/Enter: back')
      expect(plain).toContain('d: remove')
    })

    it('shows N/A for missing optional fields', () => {
      const inst = createInstance({
        instanceId: 'detail-1',
        status: 'idle',
        dirName: 'proj',
        branch: 'main',
        // No sessionID, title, directory, host, model
      })
      mockState.instances.set('detail-1', inst)
      mockState.detailView = 'detail-1'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Session ID: N/A')
      expect(plain).toContain('Title: N/A')
      expect(plain).toContain('Model: N/A')
    })
  })

  // =========================================================================
  // Session View
  // =========================================================================

  describe('session view', () => {
    beforeEach(() => {
      mockState.sessionViewActive = true
      mockState.sessionViewInstance = createInstance({
        instanceId: 'session-inst',
        dirName: 'test-project',
        branch: 'feature',
      })
      mockState.sessionViewSessionID = 'session-xyz789'
    })

    it('shows instance identifier in header', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('test-project:feature:z789')
    })

    it('shows session status', () => {
      mockState.sessionViewStatus = 'busy'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('BUSY')
    })

    it('shows session title when available', () => {
      mockState.sessionViewSessionTitle = 'Working on tests'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Working on tests')
    })

    it('shows connecting message when connecting', () => {
      mockState.sessionViewConnecting = true

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Connecting...')
    })

    it('shows error message when error is set', () => {
      mockState.sessionViewError = 'Connection failed'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Error: Connection failed')
    })

    it('shows "No messages yet" when no rendered lines', () => {
      mockState.sessionViewRenderedLines = []

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('No messages yet')
    })

    it('shows message content when rendered lines exist', () => {
      mockState.sessionViewRenderedLines = [
        { type: 'text', text: 'Hello world', plain: 'Hello world' },
        { type: 'text', text: 'Second line', plain: 'Second line' },
      ]

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Hello world')
      expect(plain).toContain('Second line')
    })

    it('shows help line with navigation hints', () => {
      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('[Esc] back')
      expect(plain).toContain('[↑↓] scroll')
      expect(plain).toContain('[m]essage')
    })

    it('shows abort option when session is busy', () => {
      mockState.sessionViewStatus = 'busy'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('[a]bort')
    })

    it('shows session navigation when multiple sessions', () => {
      mockState.sessionViewSessions = [
        { id: 'sess-1', title: 'First', status: 'idle' },
        { id: 'sess-2', title: 'Second', status: 'busy' },
      ]
      mockState.sessionViewSessionIndex = 0

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('[1/2]')
      expect(plain).toContain('[Ctrl+←/→] switch session')
    })

    it('shows confirm abort dialog when confirmAbort is true', () => {
      mockState.sessionViewConfirmAbort = true

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Abort this session?')
      expect(plain).toContain('[y]es')
      expect(plain).toContain('[n]o')
    })

    it('shows input mode with input buffer', () => {
      mockState.sessionViewInputMode = true
      mockState.sessionViewInputBuffer = 'Hello Claude'

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('>')
      expect(plain).toContain('Hello Claude')
      expect(plain).toContain('[Enter] send')
      expect(plain).toContain('[Esc] cancel')
    })

    it('shows permission request when pending permissions exist', () => {
      mockState.sessionViewPendingPermissions.set('perm-1', {
        id: 'perm-1',
        tool: 'bash',
        args: { command: 'rm -rf /' },
      })

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Permission Request')
      expect(plain).toContain('Tool: bash')
      expect(plain).toContain('[a]llow')
      expect(plain).toContain('[d]eny')
    })
  })

  // =========================================================================
  // Instance Tree Building
  // =========================================================================

  describe('instance tree building', () => {
    beforeEach(() => {
      mockState.viewMode = 'grouped'
    })

    it('renders parent and child sessions with tree structure', () => {
      const parent = createInstance({
        instanceId: 'parent-inst',
        sessionID: 'parent-session',
        project: 'my-proj',
        branch: 'main',
        title: 'Parent Task',
      })
      const child = createInstance({
        instanceId: 'child-inst',
        sessionID: 'child-session',
        parentID: 'parent-session',
        project: 'my-proj',
        branch: 'main',
        title: 'Child Task',
      })
      mockState.instances.set('parent-inst', parent)
      mockState.instances.set('child-inst', child)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Parent Task')
      expect(plain).toContain('Child Task')
      // Should have tree structure indicators
      expect(plain).toContain('└─')
    })

    it('handles instances without session ID as roots', () => {
      const inst = createInstance({
        instanceId: 'no-session-inst',
        project: 'my-proj',
        branch: 'main',
        title: 'No Session ID',
      })
      mockState.instances.set('no-session-inst', inst)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('No Session ID')
    })

    it('handles orphaned children (parent not in group) as roots', () => {
      const orphan = createInstance({
        instanceId: 'orphan-inst',
        sessionID: 'orphan-session',
        parentID: 'non-existent-parent',
        project: 'my-proj',
        branch: 'main',
        title: 'Orphan Task',
      })
      mockState.instances.set('orphan-inst', orphan)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('Orphan Task')
    })

    it('sorts children by instanceId', () => {
      const parent = createInstance({
        instanceId: 'parent-inst',
        sessionID: 'parent-session',
        project: 'my-proj',
        branch: 'main',
      })
      const childZ = createInstance({
        instanceId: 'z-child',
        sessionID: 'z-session',
        parentID: 'parent-session',
        project: 'my-proj',
        branch: 'main',
        title: 'Z Child',
      })
      const childA = createInstance({
        instanceId: 'a-child',
        sessionID: 'a-session',
        parentID: 'parent-session',
        project: 'my-proj',
        branch: 'main',
        title: 'A Child',
      })
      mockState.instances.set('parent-inst', parent)
      mockState.instances.set('z-child', childZ)
      mockState.instances.set('a-child', childA)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      // A Child should appear before Z Child
      const aIndex = plain.indexOf('A Child')
      const zIndex = plain.indexOf('Z Child')
      expect(aIndex).toBeLessThan(zIndex)
    })
  })

  // =========================================================================
  // Long Running Instances
  // =========================================================================

  describe('long running instances', () => {
    it('shows ! indicator for long running busy instances', () => {
      vi.mocked(isLongRunning).mockReturnValue(true)

      mockState.instances.set('long-running', createInstance({
        instanceId: 'long-running',
        status: 'busy',
        project: 'my-proj',
        branch: 'main',
      }))
      mockState.busySince.set('long-running', Date.now() - 700000)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('!')
    })

    it('uses red color for long running instances', () => {
      vi.mocked(isLongRunning).mockReturnValue(true)

      mockState.instances.set('long-running', createInstance({
        instanceId: 'long-running',
        status: 'busy',
        project: 'my-proj',
        branch: 'main',
      }))
      mockState.busySince.set('long-running', Date.now() - 700000)

      render()
      const output = stdoutWriteMock.mock.calls[0][0]

      // Should contain red ANSI code
      expect(output).toContain('\x1b[31m')
    })
  })

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles narrow terminal width', () => {
      mockState.termWidth = 40

      mockState.instances.set('inst-1', createInstance({
        instanceId: 'inst-1',
        sessionID: 'session-very-long-id-12345',
        project: 'very-long-project-name',
        branch: 'feature-branch',
        title: 'This is a very long title that should be truncated',
        cost: 10.50,
        tokens: { input: 10000, output: 5000, total: 15000 },
      }))

      // Should not throw
      expect(() => render()).not.toThrow()

      // The render completes without error - that's the main test
      // Content may overflow in edge cases, but it shouldn't crash
      const output = stdoutWriteMock.mock.calls[0][0]
      expect(output.length).toBeGreaterThan(0)
    })

    it('handles very short terminal height', () => {
      mockState.termHeight = 8

      for (let i = 0; i < 10; i++) {
        mockState.instances.set(`inst-${i}`, createInstance({
          instanceId: `inst-${i}`,
          project: 'proj',
          branch: 'main',
        }))
      }

      expect(() => render()).not.toThrow()
    })

    it('handles instance with all undefined optional fields', () => {
      mockState.instances.set('minimal', createInstance({
        instanceId: 'minimal',
        status: 'idle',
        ts: Date.now(),
      }))

      expect(() => render()).not.toThrow()

      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      // Should show default values or handle gracefully
      expect(plain).toContain('unknown')
      expect(plain).toContain('main')
    })

    it('handles empty session ID gracefully', () => {
      mockState.instances.set('no-session', createInstance({
        instanceId: 'no-session',
        sessionID: '',
        project: 'proj',
        branch: 'main',
      }))

      // Should not throw - graceful handling is the main test
      expect(() => render()).not.toThrow()

      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      // The instance should still be rendered (project and branch visible)
      expect(plain).toContain('proj')
      expect(plain).toContain('main')
    })

    it('handles special characters in title', () => {
      mockState.instances.set('special', createInstance({
        instanceId: 'special',
        project: 'proj',
        branch: 'main',
        title: 'Title with "quotes" and <brackets>',
      }))

      expect(() => render()).not.toThrow()
    })

    it('handles zero tokens and cost', () => {
      mockState.instances.set('zero-stats', createInstance({
        instanceId: 'zero-stats',
        project: 'proj',
        branch: 'main',
        cost: 0,
        tokens: { input: 0, output: 0, total: 0 },
      }))

      expect(() => render()).not.toThrow()
    })

    it('handles multiple groups correctly', () => {
      mockState.instances.set('inst-a', createInstance({
        instanceId: 'inst-a',
        project: 'proj-alpha',
        branch: 'main',
      }))
      mockState.instances.set('inst-b', createInstance({
        instanceId: 'inst-b',
        project: 'proj-beta',
        branch: 'develop',
      }))
      mockState.instances.set('inst-c', createInstance({
        instanceId: 'inst-c',
        project: 'proj-gamma',
        branch: 'feature',
      }))

      render()
      const output = stdoutWriteMock.mock.calls[0][0]
      const plain = stripAnsi(output)

      expect(plain).toContain('proj-alpha')
      expect(plain).toContain('proj-beta')
      expect(plain).toContain('proj-gamma')
    })
  })

  // =========================================================================
  // stripAnsi Helper
  // =========================================================================

  describe('stripAnsi helper', () => {
    it('removes ANSI escape codes from string', () => {
      const input = '\x1b[32mGreen\x1b[0m \x1b[1m\x1b[33mBold Yellow\x1b[0m'
      expect(stripAnsi(input)).toBe('Green Bold Yellow')
    })

    it('handles string with no ANSI codes', () => {
      const input = 'Plain text'
      expect(stripAnsi(input)).toBe('Plain text')
    })

    it('handles empty string', () => {
      expect(stripAnsi('')).toBe('')
    })

    it('handles complex ANSI sequences', () => {
      const input = '\x1b[38;5;196mExtended Color\x1b[0m'
      expect(stripAnsi(input)).toBe('Extended Color')
    })
  })
})
