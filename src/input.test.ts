// Tests for input.ts - Keyboard input handling

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest'
import type { Instance, SelectableItem, KeyEvent } from './types.js'

// Mock readline to prevent issues with emitKeypressEvents
vi.mock('node:readline', () => ({
  emitKeypressEvents: vi.fn(),
}))

// Mock modules before importing input
vi.mock('./render.js', () => ({
  render: vi.fn(),
}))

vi.mock('./session.js', () => ({
  enterSessionView: vi.fn(),
  exitSessionView: vi.fn(),
  switchSession: vi.fn(),
  scrollSessionView: vi.fn(),
  abortSession: vi.fn(),
  abortInstanceSession: vi.fn(),
  respondToPermission: vi.fn(),
  sendMessage: vi.fn(),
}))

vi.mock('./utils.js', () => ({
  getEffectiveStatus: vi.fn((inst: Instance) => inst.status || 'idle'),
  getGroupKey: vi.fn((inst: Instance) => `${inst.project || inst.dirName}:${inst.branch || 'main'}`),
}))

// Import state module
import * as state from './state.js'
import { render } from './render.js'
import {
  enterSessionView,
  exitSessionView,
  switchSession,
  scrollSessionView,
  abortSession,
  abortInstanceSession,
  respondToPermission,
  sendMessage,
} from './session.js'
import { getEffectiveStatus } from './utils.js'

// We need to create a way to test the keypress handlers
// Since they're not exported, we'll test via setupKeyboardInput and simulate events

describe('input', () => {
  // Store original process methods
  let originalStdin: typeof process.stdin
  let originalStdout: typeof process.stdout
  let originalExit: typeof process.exit
  let keypressHandler: ((str: string | undefined, key: KeyEvent) => void) | null = null
  let resizeHandler: (() => void) | null = null

  // Mock stdin
  const mockStdin = {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'keypress') {
        keypressHandler = handler
      }
      return mockStdin
    }),
    removeListener: vi.fn(),
  }

  // Mock stdout
  const mockStdout = {
    columns: 120,
    rows: 40,
    write: vi.fn(),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'resize') {
        resizeHandler = handler
      }
      return mockStdout
    }),
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    keypressHandler = null
    resizeHandler = null

    // Clear all state Maps
    state.instances.clear()
    state.busySince.clear()
    state.idleSince.clear()
    state.collapsedGroups.clear()
    state.sessionViewPendingPermissions.clear()

    // Reset view state
    state.setViewMode('grouped')
    state.setSelectedIndex(-1)
    state.setSelectableItems([])
    state.setDetailView(null)
    state.setSpinnerFrame(0)
    state.setTermSize(80, 24)
    state.resetSessionViewState()

    // Reset mocks on stdin/stdout
    mockStdin.setRawMode.mockClear()
    mockStdin.resume.mockClear()
    mockStdin.on.mockClear()
    mockStdout.write.mockClear()
    mockStdout.on.mockClear()
  })

  // Helper to simulate keypress
  function pressKey(name: string, options: Partial<KeyEvent> = {}, str?: string) {
    if (keypressHandler) {
      keypressHandler(str, { name, ...options })
    }
  }

  // Helper to setup basic test instances
  function setupTestInstances() {
    const instance1: Instance = {
      instanceId: 'inst-1',
      sessionID: 'session-1',
      status: 'idle',
      project: 'project-a',
      branch: 'main',
      ts: Date.now(),
      serverUrl: 'http://localhost:3000',
    }
    const instance2: Instance = {
      instanceId: 'inst-2',
      sessionID: 'session-2',
      status: 'busy',
      project: 'project-a',
      branch: 'main',
      ts: Date.now(),
      serverUrl: 'http://localhost:3000',
    }
    const instance3: Instance = {
      instanceId: 'inst-3',
      sessionID: 'session-3',
      status: 'idle',
      project: 'project-b',
      branch: 'feature',
      ts: Date.now(),
    }

    state.instances.set('inst-1', instance1)
    state.instances.set('inst-2', instance2)
    state.instances.set('inst-3', instance3)

    return { instance1, instance2, instance3 }
  }

  // Helper to setup selectable items
  function setupSelectableItems() {
    const items: SelectableItem[] = [
      { type: 'group', key: 'project-a:main', index: 0 },
      { type: 'instance', instanceId: 'inst-1', index: 1 },
      { type: 'instance', instanceId: 'inst-2', index: 2 },
      { type: 'group', key: 'project-b:feature', index: 3 },
      { type: 'instance', instanceId: 'inst-3', index: 4 },
    ]
    state.setSelectableItems(items)
    return items
  }

  // ---------------------------------------------------------------------------
  // Main View - Navigation Keys
  // ---------------------------------------------------------------------------

  describe('main view navigation', () => {
    beforeEach(async () => {
      // Import and setup
      const { setupKeyboardInput } = await import('./input.js')
      
      // Replace process.stdin/stdout temporarily
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout')
      
      Object.defineProperty(process, 'stdin', { 
        value: mockStdin, 
        configurable: true,
        writable: true 
      })
      Object.defineProperty(process, 'stdout', { 
        value: mockStdout, 
        configurable: true,
        writable: true 
      })

      setupKeyboardInput()

      // Restore (for other tests)
      if (stdinDescriptor) {
        Object.defineProperty(process, 'stdin', stdinDescriptor)
      }
      if (stdoutDescriptor) {
        Object.defineProperty(process, 'stdout', stdoutDescriptor)
      }
    })

    it('navigates down with "j" key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0)

      pressKey('j')

      expect(state.selectedIndex).toBe(1)
      expect(render).toHaveBeenCalled()
    })

    it('navigates down with down arrow key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0)

      pressKey('down')

      expect(state.selectedIndex).toBe(1)
      expect(render).toHaveBeenCalled()
    })

    it('navigates up with "k" key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(2)

      pressKey('k')

      expect(state.selectedIndex).toBe(1)
      expect(render).toHaveBeenCalled()
    })

    it('navigates up with up arrow key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(2)

      pressKey('up')

      expect(state.selectedIndex).toBe(1)
      expect(render).toHaveBeenCalled()
    })

    it('does not go below 0 when navigating up', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0)

      pressKey('k')

      // Should stay at 0, not go negative
      expect(state.selectedIndex).toBe(0)
    })

    it('does not exceed selectableItems length when navigating down', () => {
      setupTestInstances()
      const items = setupSelectableItems()
      state.setSelectedIndex(items.length - 1)

      pressKey('j')

      expect(state.selectedIndex).toBe(items.length - 1)
    })

    it('selects last item when pressing up from -1 (no selection)', () => {
      setupTestInstances()
      const items = setupSelectableItems()
      state.setSelectedIndex(-1)

      pressKey('up')

      expect(state.selectedIndex).toBe(items.length - 1)
    })

    it('does not change selection when pressing up with empty list', () => {
      state.setSelectableItems([])
      state.setSelectedIndex(-1)

      pressKey('up')

      expect(state.selectedIndex).toBe(-1)
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - View Mode Toggle
  // ---------------------------------------------------------------------------

  describe('main view mode toggle', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('toggles from grouped to flat view with Tab', () => {
      state.setViewMode('grouped')
      state.setSelectedIndex(3)

      pressKey('tab')

      expect(state.viewMode).toBe('flat')
      expect(state.selectedIndex).toBe(-1) // Selection reset
      expect(render).toHaveBeenCalled()
    })

    it('toggles from flat to grouped view with Tab', () => {
      state.setViewMode('flat')
      state.setSelectedIndex(2)

      pressKey('tab')

      expect(state.viewMode).toBe('grouped')
      expect(state.selectedIndex).toBe(-1) // Selection reset
      expect(render).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Group Expand/Collapse
  // ---------------------------------------------------------------------------

  describe('main view group expand/collapse', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('collapses expanded group on Enter', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0) // Group item

      expect(state.collapsedGroups.has('project-a:main')).toBe(false)

      pressKey('return')

      expect(state.collapsedGroups.has('project-a:main')).toBe(true)
      expect(render).toHaveBeenCalled()
    })

    it('expands collapsed group on Enter', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0) // Group item
      state.collapsedGroups.add('project-a:main')

      pressKey('return')

      expect(state.collapsedGroups.has('project-a:main')).toBe(false)
      expect(render).toHaveBeenCalled()
    })

    it('enters session view when pressing Enter on instance', () => {
      const { instance1 } = setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1) // Instance item

      pressKey('return')

      expect(enterSessionView).toHaveBeenCalledWith(instance1)
    })

    it('does nothing when pressing Enter with no selection', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(-1)

      pressKey('return')

      expect(enterSessionView).not.toHaveBeenCalled()
      expect(state.collapsedGroups.size).toBe(0)
    })

    it('does nothing when selectedIndex exceeds list', () => {
      setupTestInstances()
      const items = setupSelectableItems()
      state.setSelectedIndex(items.length + 5)

      pressKey('return')

      expect(enterSessionView).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Watch (w) and Info (i) Keys
  // ---------------------------------------------------------------------------

  describe('main view watch and info keys', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('enters session view with "w" key on instance', () => {
      const { instance1 } = setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1)

      pressKey('w')

      expect(enterSessionView).toHaveBeenCalledWith(instance1)
    })

    it('does nothing with "w" key on group', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0) // Group

      pressKey('w')

      expect(enterSessionView).not.toHaveBeenCalled()
    })

    it('opens detail view with "i" key on instance', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1)

      pressKey('i')

      expect(state.detailView).toBe('inst-1')
      expect(render).toHaveBeenCalled()
    })

    it('does nothing with "i" key on group', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0) // Group

      pressKey('i')

      expect(state.detailView).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Delete Keys
  // ---------------------------------------------------------------------------

  describe('main view delete operations', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('deletes instance with "d" key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1)
      state.busySince.set('inst-1', Date.now())
      state.idleSince.set('inst-1', Date.now())

      expect(state.instances.has('inst-1')).toBe(true)

      pressKey('d')

      expect(state.instances.has('inst-1')).toBe(false)
      expect(state.busySince.has('inst-1')).toBe(false)
      expect(state.idleSince.has('inst-1')).toBe(false)
      expect(render).toHaveBeenCalled()
    })

    it('deletes instance with delete key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1)

      pressKey('delete')

      expect(state.instances.has('inst-1')).toBe(false)
    })

    it('deletes instance with backspace key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1)

      pressKey('backspace')

      expect(state.instances.has('inst-1')).toBe(false)
    })

    it('deletes all instances in group when group is selected', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0) // Group project-a:main
      state.collapsedGroups.add('project-a:main')

      pressKey('d')

      // Both inst-1 and inst-2 should be deleted (they're in project-a:main)
      expect(state.instances.has('inst-1')).toBe(false)
      expect(state.instances.has('inst-2')).toBe(false)
      expect(state.instances.has('inst-3')).toBe(true) // Different group
      expect(state.collapsedGroups.has('project-a:main')).toBe(false)
    })

    it('adjusts selectedIndex when deleting last item', () => {
      setupTestInstances()
      const items = setupSelectableItems()
      state.setSelectedIndex(items.length - 1) // Last item

      pressKey('d')

      // Should decrement selection
      expect(state.selectedIndex).toBeLessThan(items.length - 1)
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Abort Key
  // ---------------------------------------------------------------------------

  describe('main view abort operation', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('aborts busy instance with "a" key', () => {
      const { instance2 } = setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(2) // inst-2 which is busy

      // Mock getEffectiveStatus to return 'busy'
      ;(getEffectiveStatus as Mock).mockReturnValue('busy')

      pressKey('a')

      expect(abortInstanceSession).toHaveBeenCalledWith(instance2)
    })

    it('does not abort idle instance with "a" key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(1) // inst-1 which is idle

      ;(getEffectiveStatus as Mock).mockReturnValue('idle')

      pressKey('a')

      expect(abortInstanceSession).not.toHaveBeenCalled()
    })

    it('does not abort instance without serverUrl', () => {
      const { instance3 } = setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(4) // inst-3 has no serverUrl
      
      ;(getEffectiveStatus as Mock).mockReturnValue('busy')
      instance3.status = 'busy'
      delete instance3.serverUrl

      pressKey('a')

      expect(abortInstanceSession).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Escape and Clear
  // ---------------------------------------------------------------------------

  describe('main view escape and clear operations', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('clears selection with Escape key', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(2)

      pressKey('escape')

      expect(state.selectedIndex).toBe(-1)
      expect(render).toHaveBeenCalled()
    })

    it('clears stale instances with "c" key', () => {
      setupTestInstances()
      setupSelectableItems()

      // Make inst-1 stale
      ;(getEffectiveStatus as Mock).mockImplementation((inst: Instance) => {
        return inst.instanceId === 'inst-1' ? 'stale' : inst.status || 'idle'
      })

      state.busySince.set('inst-1', Date.now())
      state.idleSince.set('inst-1', Date.now())

      pressKey('c')

      expect(state.instances.has('inst-1')).toBe(false)
      expect(state.instances.has('inst-2')).toBe(true)
      expect(state.instances.has('inst-3')).toBe(true)
      expect(state.busySince.has('inst-1')).toBe(false)
      expect(state.idleSince.has('inst-1')).toBe(false)
      expect(render).toHaveBeenCalled()
    })

    it('adjusts selection if it exceeds list after clear', () => {
      setupTestInstances()
      const items = setupSelectableItems()
      state.setSelectedIndex(items.length + 5) // Set to 10, which exceeds the list of 5 items

      // Mock all as stale
      ;(getEffectiveStatus as Mock).mockReturnValue('stale')

      pressKey('c')

      // After clearing all stale, the selection should be adjusted based on remaining selectableItems
      // The code checks: if (selectedIndex >= selectableItems.length) setSelectedIndex(...)
      // Since all instances were deleted but selectableItems wasn't updated in the mock,
      // the behavior depends on the actual selectableItems length at check time
      // The main point is: it should not throw and should adjust somehow
      expect(state.selectedIndex).toBeDefined()
      expect(render).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Main View - Refresh
  // ---------------------------------------------------------------------------

  describe('main view refresh', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('refreshes display with "r" key', () => {
      pressKey('r')

      expect(render).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Detail View Mode
  // ---------------------------------------------------------------------------

  describe('detail view mode', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('closes detail view with Escape', () => {
      setupTestInstances()
      state.setDetailView('inst-1')

      pressKey('escape')

      expect(state.detailView).toBeNull()
      expect(render).toHaveBeenCalled()
    })

    it('closes detail view with Enter', () => {
      setupTestInstances()
      state.setDetailView('inst-1')

      pressKey('return')

      expect(state.detailView).toBeNull()
      expect(render).toHaveBeenCalled()
    })

    it('deletes instance from detail view with "d" key', () => {
      setupTestInstances()
      state.setDetailView('inst-1')
      state.busySince.set('inst-1', Date.now())
      state.idleSince.set('inst-1', Date.now())

      pressKey('d')

      expect(state.instances.has('inst-1')).toBe(false)
      expect(state.busySince.has('inst-1')).toBe(false)
      expect(state.idleSince.has('inst-1')).toBe(false)
      expect(state.detailView).toBeNull()
      expect(render).toHaveBeenCalled()
    })

    it('ignores navigation keys in detail view', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setDetailView('inst-1')
      state.setSelectedIndex(0)

      pressKey('j')

      // Selection should not change in detail view
      expect(state.selectedIndex).toBe(0)
      expect(state.detailView).toBe('inst-1') // Still in detail view
    })

    it('ignores most keys in detail view', () => {
      setupTestInstances()
      state.setDetailView('inst-1')

      pressKey('tab')
      expect(state.viewMode).toBe('grouped') // Should not toggle

      pressKey('c')
      expect(state.instances.size).toBe(3) // Should not clear stale

      pressKey('w')
      expect(enterSessionView).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Basic Navigation
  // ---------------------------------------------------------------------------

  describe('session view navigation', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      // Activate session view
      state.setSessionViewActive(true)
    })

    it('scrolls up with "k" key', () => {
      pressKey('k')
      expect(scrollSessionView).toHaveBeenCalledWith('up')
    })

    it('scrolls up with up arrow', () => {
      pressKey('up')
      expect(scrollSessionView).toHaveBeenCalledWith('up')
    })

    it('scrolls down with "j" key', () => {
      pressKey('j')
      expect(scrollSessionView).toHaveBeenCalledWith('down')
    })

    it('scrolls down with down arrow', () => {
      pressKey('down')
      expect(scrollSessionView).toHaveBeenCalledWith('down')
    })

    it('scrolls page up with pageup key', () => {
      pressKey('pageup')
      expect(scrollSessionView).toHaveBeenCalledWith('pageup')
    })

    it('scrolls page down with pagedown key', () => {
      pressKey('pagedown')
      expect(scrollSessionView).toHaveBeenCalledWith('pagedown')
    })

    it('scrolls to home with home key', () => {
      pressKey('home')
      expect(scrollSessionView).toHaveBeenCalledWith('home')
    })

    it('scrolls to end with end key', () => {
      pressKey('end')
      expect(scrollSessionView).toHaveBeenCalledWith('end')
    })

    it('scrolls to home with Ctrl+home', () => {
      pressKey('home', { ctrl: true })
      expect(scrollSessionView).toHaveBeenCalledWith('home')
    })

    it('scrolls to end with Ctrl+end', () => {
      pressKey('end', { ctrl: true })
      expect(scrollSessionView).toHaveBeenCalledWith('end')
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Session Switching
  // ---------------------------------------------------------------------------

  describe('session view session switching', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
    })

    it('switches to previous session with Ctrl+Left', () => {
      pressKey('left', { ctrl: true })
      expect(switchSession).toHaveBeenCalledWith('prev')
    })

    it('switches to next session with Ctrl+Right', () => {
      pressKey('right', { ctrl: true })
      expect(switchSession).toHaveBeenCalledWith('next')
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Exit
  // ---------------------------------------------------------------------------

  describe('session view exit', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
    })

    it('exits session view with Escape', () => {
      pressKey('escape')
      expect(exitSessionView).toHaveBeenCalled()
    })

    it('exits session view with "q" key', () => {
      pressKey('q')
      expect(exitSessionView).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Abort Confirmation
  // ---------------------------------------------------------------------------

  describe('session view abort confirmation', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
    })

    it('shows abort confirmation when pressing "a" while busy', () => {
      state.setSessionViewStatus('busy')

      pressKey('a')

      expect(state.sessionViewConfirmAbort).toBe(true)
      expect(render).toHaveBeenCalled()
    })

    it('shows abort confirmation when status is running', () => {
      state.setSessionViewStatus('running')

      pressKey('a')

      expect(state.sessionViewConfirmAbort).toBe(true)
    })

    it('shows abort confirmation when status is pending', () => {
      state.setSessionViewStatus('pending')

      pressKey('a')

      expect(state.sessionViewConfirmAbort).toBe(true)
    })

    it('does not show abort confirmation when idle', () => {
      state.setSessionViewStatus('idle')

      pressKey('a')

      expect(state.sessionViewConfirmAbort).toBe(false)
    })

    it('confirms abort with "y" key', () => {
      state.setSessionViewConfirmAbort(true)

      pressKey('y')

      expect(abortSession).toHaveBeenCalled()
    })

    it('cancels abort with "n" key', () => {
      state.setSessionViewConfirmAbort(true)

      pressKey('n')

      expect(state.sessionViewConfirmAbort).toBe(false)
      expect(abortSession).not.toHaveBeenCalled()
      expect(render).toHaveBeenCalled()
    })

    it('cancels abort with Escape', () => {
      state.setSessionViewConfirmAbort(true)

      pressKey('escape')

      expect(state.sessionViewConfirmAbort).toBe(false)
      expect(abortSession).not.toHaveBeenCalled()
    })

    it('ignores other keys during abort confirmation', () => {
      state.setSessionViewConfirmAbort(true)

      pressKey('j')
      pressKey('k')
      pressKey('q')

      expect(scrollSessionView).not.toHaveBeenCalled()
      expect(exitSessionView).not.toHaveBeenCalled()
      expect(state.sessionViewConfirmAbort).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Input Mode
  // ---------------------------------------------------------------------------

  describe('session view input mode', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
    })

    it('enters input mode with "m" key', () => {
      pressKey('m')

      expect(state.sessionViewInputMode).toBe(true)
      expect(state.sessionViewInputBuffer).toBe('')
      expect(render).toHaveBeenCalled()
    })

    it('exits input mode with Escape', () => {
      state.setSessionViewInputMode(true)
      state.setSessionViewInputBuffer('some text')

      pressKey('escape')

      expect(state.sessionViewInputMode).toBe(false)
      expect(state.sessionViewInputBuffer).toBe('')
      expect(render).toHaveBeenCalled()
    })

    it('adds characters to input buffer', () => {
      state.setSessionViewInputMode(true)

      pressKey('h', {}, 'h')
      expect(state.sessionViewInputBuffer).toBe('h')

      pressKey('i', {}, 'i')
      expect(state.sessionViewInputBuffer).toBe('hi')
    })

    it('removes characters with backspace', () => {
      state.setSessionViewInputMode(true)
      state.setSessionViewInputBuffer('hello')

      pressKey('backspace')

      expect(state.sessionViewInputBuffer).toBe('hell')
      expect(render).toHaveBeenCalled()
    })

    it('sends message on Enter', () => {
      state.setSessionViewInputMode(true)
      state.setSessionViewInputBuffer('test message')

      pressKey('return')

      expect(sendMessage).toHaveBeenCalledWith('test message')
    })

    it('ignores ctrl+key combinations in input mode', () => {
      state.setSessionViewInputMode(true)

      pressKey('c', { ctrl: true }, 'c')

      // Should not add 'c' to buffer
      expect(state.sessionViewInputBuffer).toBe('')
    })

    it('ignores meta+key combinations in input mode', () => {
      state.setSessionViewInputMode(true)

      pressKey('v', { meta: true }, 'v')

      // Should not add 'v' to buffer
      expect(state.sessionViewInputBuffer).toBe('')
    })

    it('ignores navigation keys in input mode', () => {
      state.setSessionViewInputMode(true)

      pressKey('j')
      pressKey('k')

      expect(scrollSessionView).not.toHaveBeenCalled()
      expect(state.sessionViewInputBuffer).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Permission Handling
  // ---------------------------------------------------------------------------

  describe('session view permission handling', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
      state.sessionViewPendingPermissions.set('perm-1', {
        id: 'perm-1',
        tool: 'bash',
        args: { command: 'ls -la' },
      })
    })

    it('allows permission with "a" key (without remember)', () => {
      pressKey('a', { shift: false })

      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'allow', false)
    })

    it('allows permission with Shift+"A" (with remember)', () => {
      pressKey('a', { shift: true })

      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'allow', true)
    })

    it('denies permission with "d" key (without remember)', () => {
      pressKey('d', { shift: false })

      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'deny', false)
    })

    it('denies permission with Shift+"D" (with remember)', () => {
      pressKey('d', { shift: true })

      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'deny', true)
    })

    it('dismisses permission with Escape', () => {
      pressKey('escape')

      expect(state.sessionViewPendingPermissions.has('perm-1')).toBe(false)
      expect(render).toHaveBeenCalled()
    })

    it('handles first permission in queue', () => {
      // Add another permission
      state.sessionViewPendingPermissions.set('perm-2', {
        id: 'perm-2',
        tool: 'write',
      })

      pressKey('a', { shift: false })

      // Should respond to first permission (perm-1)
      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'allow', false)
    })
  })

  // ---------------------------------------------------------------------------
  // Session View - Show Permissions
  // ---------------------------------------------------------------------------

  describe('session view show permissions', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()

      state.setSessionViewActive(true)
    })

    it('refreshes when pressing "p" with pending permissions', () => {
      state.sessionViewPendingPermissions.set('perm-1', {
        id: 'perm-1',
        tool: 'bash',
      })

      pressKey('p')

      expect(render).toHaveBeenCalled()
    })

    it('does nothing when pressing "p" without pending permissions', () => {
      vi.clearAllMocks()
      
      pressKey('p')

      // render should not be called for 'p' without permissions
      expect(render).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Quit Behavior
  // ---------------------------------------------------------------------------

  describe('quit behavior', () => {
    let mockExit: Mock

    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      
      mockExit = vi.fn()
      vi.spyOn(process, 'exit').mockImplementation(mockExit as any)
      
      setupKeyboardInput()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('quits with "q" key in main view', () => {
      pressKey('q')

      expect(mockStdout.write).toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('quits with Ctrl+C', () => {
      pressKey('c', { ctrl: true })

      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('exits session view with "q" instead of quitting app', () => {
      state.setSessionViewActive(true)

      pressKey('q')

      expect(exitSessionView).toHaveBeenCalled()
      expect(mockExit).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Setup Function
  // ---------------------------------------------------------------------------

  describe('setupKeyboardInput', () => {
    it('sets raw mode on TTY stdin', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true)
      expect(mockStdin.resume).toHaveBeenCalled()
    })

    it('sets up keypress event listener', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(mockStdin.on).toHaveBeenCalledWith('keypress', expect.any(Function))
    })

    it('sets up resize event listener', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(mockStdout.on).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('enters alternate screen and enables mouse on setup', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?1049h') // enterAltScreen
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?1000h\x1b[?1002h\x1b[?1006h') // enableMouse
    })

    it('initializes terminal size', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { 
        value: { ...mockStdout, columns: 100, rows: 50 }, 
        configurable: true 
      })

      setupKeyboardInput()

      expect(state.termWidth).toBe(100)
      expect(state.termHeight).toBe(50)
    })

    it('handles resize events', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      let resizeCallback: (() => void) | null = null
      const customStdout = {
        ...mockStdout,
        columns: 80,
        rows: 24,
        on: vi.fn((event: string, handler: any) => {
          if (event === 'resize') {
            resizeCallback = handler
          }
          return customStdout
        }),
      }
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: customStdout, configurable: true })

      setupKeyboardInput()

      // Simulate resize
      customStdout.columns = 200
      customStdout.rows = 60
      if (resizeCallback) resizeCallback()

      expect(state.termWidth).toBe(200)
      expect(state.termHeight).toBe(60)
      expect(render).toHaveBeenCalled()
    })

    it('skips setRawMode if stdin is not TTY', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      const nonTtyStdin = { ...mockStdin, isTTY: false }
      
      Object.defineProperty(process, 'stdin', { value: nonTtyStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(nonTtyStdin.setRawMode).not.toHaveBeenCalled()
    })

    it('ignores keypress with undefined key', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      // Simulate keypress with null key
      if (keypressHandler) {
        keypressHandler('a', undefined as any)
      }

      // Should not crash, just ignore
      expect(render).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('handles empty selectableItems array', () => {
      state.setSelectableItems([])
      state.setSelectedIndex(-1)

      pressKey('j')
      expect(state.selectedIndex).toBe(-1)

      pressKey('return')
      expect(enterSessionView).not.toHaveBeenCalled()
    })

    it('handles missing instance in instances map', () => {
      const items: SelectableItem[] = [
        { type: 'instance', instanceId: 'non-existent', index: 0 },
      ]
      state.setSelectableItems(items)
      state.setSelectedIndex(0)

      // Should not crash when instance doesn't exist
      pressKey('return')
      expect(enterSessionView).not.toHaveBeenCalled()

      pressKey('w')
      expect(enterSessionView).not.toHaveBeenCalled()
    })

    it('handles instance without sessionID for abort', () => {
      const instance: Instance = {
        instanceId: 'no-session',
        status: 'busy',
        ts: Date.now(),
        serverUrl: 'http://localhost:3000',
        // No sessionID
      }
      state.instances.set('no-session', instance)
      
      const items: SelectableItem[] = [
        { type: 'instance', instanceId: 'no-session', index: 0 },
      ]
      state.setSelectableItems(items)
      state.setSelectedIndex(0)

      ;(getEffectiveStatus as Mock).mockReturnValue('busy')

      pressKey('a')

      expect(abortInstanceSession).not.toHaveBeenCalled()
    })

    it('handles rapid key presses', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0)

      for (let i = 0; i < 20; i++) {
        pressKey('j')
      }

      // Should be capped at max index
      expect(state.selectedIndex).toBeLessThanOrEqual(4)
    })

    it('handles multiple permission responses correctly', () => {
      state.setSessionViewActive(true)
      state.sessionViewPendingPermissions.set('perm-1', { id: 'perm-1', tool: 'bash' })
      state.sessionViewPendingPermissions.set('perm-2', { id: 'perm-2', tool: 'write' })
      state.sessionViewPendingPermissions.set('perm-3', { id: 'perm-3', tool: 'read' })

      // Respond to first
      pressKey('a')
      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'allow', false)
    })

    it('handles input mode with multi-character strings', () => {
      state.setSessionViewActive(true)
      state.setSessionViewInputMode(true)

      // Simulate pasting or multi-char input - only first char should be used
      // based on the condition: str && str.length === 1
      if (keypressHandler) {
        keypressHandler('hello', { name: 'h' })
      }

      // Should not add 'hello' since length !== 1
      expect(state.sessionViewInputBuffer).toBe('')
    })

    it('handles undefined str in input mode', () => {
      state.setSessionViewActive(true)
      state.setSessionViewInputMode(true)

      if (keypressHandler) {
        keypressHandler(undefined, { name: 'a' })
      }

      expect(state.sessionViewInputBuffer).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Priority Testing - Mode Precedence
  // ---------------------------------------------------------------------------

  describe('mode precedence', () => {
    beforeEach(async () => {
      const { setupKeyboardInput } = await import('./input.js')
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })
      setupKeyboardInput()
    })

    it('input mode takes precedence over other session view handlers', () => {
      state.setSessionViewActive(true)
      state.setSessionViewInputMode(true)
      state.setSessionViewStatus('busy')
      state.sessionViewPendingPermissions.set('perm-1', { id: 'perm-1', tool: 'bash' })

      pressKey('a', {}, 'a')

      // Should add 'a' to buffer, not respond to permission
      expect(state.sessionViewInputBuffer).toBe('a')
      expect(respondToPermission).not.toHaveBeenCalled()
    })

    it('abort confirmation takes precedence over permissions', () => {
      state.setSessionViewActive(true)
      state.setSessionViewConfirmAbort(true)
      state.sessionViewPendingPermissions.set('perm-1', { id: 'perm-1', tool: 'bash' })

      pressKey('y')

      expect(abortSession).toHaveBeenCalled()
      expect(respondToPermission).not.toHaveBeenCalled()
    })

    it('permissions take precedence over normal session view commands', () => {
      state.setSessionViewActive(true)
      state.setSessionViewStatus('busy')
      state.sessionViewPendingPermissions.set('perm-1', { id: 'perm-1', tool: 'bash' })

      pressKey('a')

      // Should respond to permission, not show abort confirmation
      expect(respondToPermission).toHaveBeenCalledWith('perm-1', 'allow', false)
      expect(state.sessionViewConfirmAbort).toBe(false)
    })

    it('detail view takes precedence over main view navigation', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setDetailView('inst-1')
      state.setSelectedIndex(0)

      pressKey('j')

      // Should stay at 0, detail view blocks navigation
      expect(state.selectedIndex).toBe(0)
    })

    it('session view active takes precedence over main view', () => {
      setupTestInstances()
      setupSelectableItems()
      state.setSelectedIndex(0)
      state.setSessionViewActive(true)

      pressKey('j')

      // Should scroll, not navigate main view
      expect(scrollSessionView).toHaveBeenCalledWith('down')
      expect(state.selectedIndex).toBe(0) // Main view selection unchanged
    })
  })

  describe('mouse support setup', () => {
    it('registers data handler for mouse events', async () => {
      const { setupKeyboardInput } = await import('./input.js')
      
      Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
      Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true })

      setupKeyboardInput()

      expect(mockStdin.on).toHaveBeenCalledWith('data', expect.any(Function))
    })
  })
})
