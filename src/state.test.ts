// Tests for state.ts - Global state management

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Instance, ViewMode, SelectableItem, RenderedLine, Message, Permission, ServerConnection } from './types.js'

// Import state module - we need to import everything to test exports
import * as state from './state.js'

describe('state', () => {
  // Reset all state before each test to ensure isolation
  beforeEach(() => {
    // Clear all Maps
    state.instances.clear()
    state.busySince.clear()
    state.idleSince.clear()
    state.serverConnections.clear()
    state.sessionViewPendingPermissions.clear()
    
    // Clear collapsed groups
    state.collapsedGroups.clear()
    
    // Reset all state via setters and reset function
    state.setViewMode('grouped')
    state.setSelectedIndex(-1)
    state.setSelectableItems([])
    state.setDetailView(null)
    state.setSpinnerFrame(0)
    state.setTermSize(80, 24)
    state.resetSessionViewState()
  })

  // ---------------------------------------------------------------------------
  // Maps - Instance Tracking
  // ---------------------------------------------------------------------------

  describe('instances Map', () => {
    it('starts empty', () => {
      expect(state.instances.size).toBe(0)
    })

    it('can add instances', () => {
      const instance: Instance = {
        instanceId: 'test-123',
        status: 'idle',
        ts: Date.now(),
      }
      state.instances.set('test-123', instance)
      expect(state.instances.size).toBe(1)
      expect(state.instances.get('test-123')).toEqual(instance)
    })

    it('can update existing instances', () => {
      const instance: Instance = {
        instanceId: 'test-123',
        status: 'idle',
        ts: Date.now(),
      }
      state.instances.set('test-123', instance)
      
      const updated: Instance = { ...instance, status: 'busy' }
      state.instances.set('test-123', updated)
      
      expect(state.instances.size).toBe(1)
      expect(state.instances.get('test-123')?.status).toBe('busy')
    })

    it('can delete instances', () => {
      state.instances.set('test-123', { instanceId: 'test-123', status: 'idle', ts: Date.now() })
      state.instances.delete('test-123')
      expect(state.instances.size).toBe(0)
    })

    it('can store multiple instances', () => {
      state.instances.set('a', { instanceId: 'a', status: 'idle', ts: 1 })
      state.instances.set('b', { instanceId: 'b', status: 'busy', ts: 2 })
      state.instances.set('c', { instanceId: 'c', status: 'idle', ts: 3 })
      expect(state.instances.size).toBe(3)
    })
  })

  describe('busySince Map', () => {
    it('starts empty', () => {
      expect(state.busySince.size).toBe(0)
    })

    it('can track when instances became busy', () => {
      const now = Date.now()
      state.busySince.set('test-123', now)
      expect(state.busySince.get('test-123')).toBe(now)
    })

    it('can clear busy tracking', () => {
      state.busySince.set('test-123', Date.now())
      state.busySince.delete('test-123')
      expect(state.busySince.has('test-123')).toBe(false)
    })
  })

  describe('idleSince Map', () => {
    it('starts empty', () => {
      expect(state.idleSince.size).toBe(0)
    })

    it('can track when instances became idle', () => {
      const now = Date.now()
      state.idleSince.set('test-456', now)
      expect(state.idleSince.get('test-456')).toBe(now)
    })

    it('can clear idle tracking', () => {
      state.idleSince.set('test-456', Date.now())
      state.idleSince.delete('test-456')
      expect(state.idleSince.has('test-456')).toBe(false)
    })
  })

  describe('serverConnections Map', () => {
    it('starts empty', () => {
      expect(state.serverConnections.size).toBe(0)
    })

    it('can store server connections', () => {
      const connection: ServerConnection = {
        client: { mock: true },
        sessions: [],
        lastFetch: Date.now(),
        error: null,
      }
      state.serverConnections.set('http://localhost:3000', connection)
      expect(state.serverConnections.size).toBe(1)
      expect(state.serverConnections.get('http://localhost:3000')).toEqual(connection)
    })

    it('can store connections with sessions', () => {
      const connection: ServerConnection = {
        client: {},
        sessions: [
          { id: 'session-1', title: 'Test Session', status: 'idle' },
          { id: 'session-2', title: 'Another Session', status: 'busy' },
        ],
        lastFetch: Date.now(),
        error: null,
      }
      state.serverConnections.set('http://localhost:3000', connection)
      expect(state.serverConnections.get('http://localhost:3000')?.sessions.length).toBe(2)
    })

    it('can store connections with errors', () => {
      const connection: ServerConnection = {
        client: null,
        sessions: [],
        lastFetch: Date.now(),
        error: 'Connection refused',
      }
      state.serverConnections.set('http://localhost:3000', connection)
      expect(state.serverConnections.get('http://localhost:3000')?.error).toBe('Connection refused')
    })
  })

  // ---------------------------------------------------------------------------
  // View State Setters
  // ---------------------------------------------------------------------------

  describe('setViewMode', () => {
    it('updates viewMode to flat', () => {
      state.setViewMode('flat')
      expect(state.viewMode).toBe('flat')
    })

    it('updates viewMode to grouped', () => {
      state.setViewMode('flat')
      state.setViewMode('grouped')
      expect(state.viewMode).toBe('grouped')
    })
  })

  describe('setSelectedIndex', () => {
    it('updates selectedIndex to positive value', () => {
      state.setSelectedIndex(5)
      expect(state.selectedIndex).toBe(5)
    })

    it('updates selectedIndex to zero', () => {
      state.setSelectedIndex(0)
      expect(state.selectedIndex).toBe(0)
    })

    it('updates selectedIndex to negative value (no selection)', () => {
      state.setSelectedIndex(5)
      state.setSelectedIndex(-1)
      expect(state.selectedIndex).toBe(-1)
    })
  })

  describe('setSelectableItems', () => {
    it('updates selectableItems to empty array', () => {
      state.setSelectableItems([])
      expect(state.selectableItems).toEqual([])
    })

    it('updates selectableItems with group items', () => {
      const items: SelectableItem[] = [
        { type: 'group', key: 'project:main', index: 0 },
        { type: 'group', key: 'project:dev', index: 1 },
      ]
      state.setSelectableItems(items)
      expect(state.selectableItems).toEqual(items)
      expect(state.selectableItems.length).toBe(2)
    })

    it('updates selectableItems with instance items', () => {
      const items: SelectableItem[] = [
        { type: 'instance', instanceId: 'abc123', index: 0 },
        { type: 'instance', instanceId: 'def456', index: 1 },
      ]
      state.setSelectableItems(items)
      expect(state.selectableItems).toEqual(items)
    })

    it('updates selectableItems with mixed items', () => {
      const items: SelectableItem[] = [
        { type: 'group', key: 'project:main', index: 0 },
        { type: 'instance', instanceId: 'abc123', index: 1 },
        { type: 'instance', instanceId: 'def456', index: 2 },
      ]
      state.setSelectableItems(items)
      expect(state.selectableItems.length).toBe(3)
      expect(state.selectableItems[0].type).toBe('group')
      expect(state.selectableItems[1].type).toBe('instance')
    })
  })

  describe('setDetailView', () => {
    it('sets detailView to instance ID', () => {
      state.setDetailView('test-instance-123')
      expect(state.detailView).toBe('test-instance-123')
    })

    it('clears detailView with null', () => {
      state.setDetailView('test-instance')
      state.setDetailView(null)
      expect(state.detailView).toBeNull()
    })
  })

  describe('setSpinnerFrame', () => {
    it('sets spinner frame to specific value', () => {
      state.setSpinnerFrame(5)
      expect(state.spinnerFrame).toBe(5)
    })

    it('can cycle through spinner frames', () => {
      for (let i = 0; i < 10; i++) {
        state.setSpinnerFrame(i)
        expect(state.spinnerFrame).toBe(i)
      }
    })

    it('wraps spinner frame value', () => {
      state.setSpinnerFrame(0)
      expect(state.spinnerFrame).toBe(0)
      state.setSpinnerFrame(9)
      expect(state.spinnerFrame).toBe(9)
    })
  })

  describe('setTermSize', () => {
    it('sets terminal dimensions', () => {
      state.setTermSize(120, 40)
      expect(state.termWidth).toBe(120)
      expect(state.termHeight).toBe(40)
    })

    it('handles small terminal sizes', () => {
      state.setTermSize(40, 10)
      expect(state.termWidth).toBe(40)
      expect(state.termHeight).toBe(10)
    })

    it('handles large terminal sizes', () => {
      state.setTermSize(300, 100)
      expect(state.termWidth).toBe(300)
      expect(state.termHeight).toBe(100)
    })

    it('resets to default values', () => {
      state.setTermSize(120, 40)
      state.setTermSize(80, 24)
      expect(state.termWidth).toBe(80)
      expect(state.termHeight).toBe(24)
    })
  })

  describe('collapsedGroups Set', () => {
    it('starts empty', () => {
      expect(state.collapsedGroups.size).toBe(0)
    })

    it('can add collapsed groups', () => {
      state.collapsedGroups.add('project:main')
      expect(state.collapsedGroups.has('project:main')).toBe(true)
    })

    it('can remove collapsed groups', () => {
      state.collapsedGroups.add('project:main')
      state.collapsedGroups.delete('project:main')
      expect(state.collapsedGroups.has('project:main')).toBe(false)
    })

    it('can toggle collapsed state', () => {
      const key = 'project:feature'
      
      // Add (collapse)
      state.collapsedGroups.add(key)
      expect(state.collapsedGroups.has(key)).toBe(true)
      
      // Remove (expand)
      state.collapsedGroups.delete(key)
      expect(state.collapsedGroups.has(key)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Session Viewer Setters
  // ---------------------------------------------------------------------------

  describe('setSessionViewActive', () => {
    it('sets session view active to true', () => {
      state.setSessionViewActive(true)
      expect(state.sessionViewActive).toBe(true)
    })

    it('sets session view active to false', () => {
      state.setSessionViewActive(true)
      state.setSessionViewActive(false)
      expect(state.sessionViewActive).toBe(false)
    })
  })

  describe('setSessionViewClient', () => {
    it('sets client to mock object', () => {
      const mockClient = { connect: vi.fn(), disconnect: vi.fn() }
      state.setSessionViewClient(mockClient)
      expect(state.sessionViewClient).toBe(mockClient)
    })

    it('sets client to null', () => {
      state.setSessionViewClient({ mock: true })
      state.setSessionViewClient(null)
      expect(state.sessionViewClient).toBeNull()
    })
  })

  describe('setSessionViewInstance', () => {
    it('sets instance', () => {
      const instance: Instance = {
        instanceId: 'test-123',
        status: 'busy',
        ts: Date.now(),
        title: 'Working on feature',
      }
      state.setSessionViewInstance(instance)
      expect(state.sessionViewInstance).toEqual(instance)
    })

    it('clears instance with null', () => {
      state.setSessionViewInstance({ instanceId: 'test', status: 'idle', ts: 1 })
      state.setSessionViewInstance(null)
      expect(state.sessionViewInstance).toBeNull()
    })
  })

  describe('setSessionViewSessionID', () => {
    it('sets session ID', () => {
      state.setSessionViewSessionID('session-abc-123')
      expect(state.sessionViewSessionID).toBe('session-abc-123')
    })

    it('clears session ID with null', () => {
      state.setSessionViewSessionID('session-123')
      state.setSessionViewSessionID(null)
      expect(state.sessionViewSessionID).toBeNull()
    })
  })

  describe('setSessionViewMessages', () => {
    it('sets empty messages array', () => {
      state.setSessionViewMessages([])
      expect(state.sessionViewMessages).toEqual([])
    })

    it('sets messages array', () => {
      const messages: Message[] = [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'Hello' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Hi there!' }] },
      ]
      state.setSessionViewMessages(messages)
      expect(state.sessionViewMessages).toEqual(messages)
      expect(state.sessionViewMessages.length).toBe(2)
    })

    it('replaces existing messages', () => {
      state.setSessionViewMessages([{ info: { role: 'user' }, parts: [] }])
      state.setSessionViewMessages([{ info: { role: 'assistant' }, parts: [] }])
      expect(state.sessionViewMessages.length).toBe(1)
      expect(state.sessionViewMessages[0].info.role).toBe('assistant')
    })
  })

  describe('setSessionViewScrollOffset', () => {
    it('sets scroll offset to zero', () => {
      state.setSessionViewScrollOffset(0)
      expect(state.sessionViewScrollOffset).toBe(0)
    })

    it('sets scroll offset to positive value', () => {
      state.setSessionViewScrollOffset(100)
      expect(state.sessionViewScrollOffset).toBe(100)
    })

    it('sets scroll offset to negative value (scrolled up)', () => {
      state.setSessionViewScrollOffset(-50)
      expect(state.sessionViewScrollOffset).toBe(-50)
    })
  })

  describe('setSessionViewRenderedLines', () => {
    it('sets empty rendered lines', () => {
      state.setSessionViewRenderedLines([])
      expect(state.sessionViewRenderedLines).toEqual([])
    })

    it('sets rendered lines array', () => {
      const lines: RenderedLine[] = [
        { type: 'text', text: '\x1b[32mHello\x1b[0m', plain: 'Hello' },
        { type: 'tool', text: 'Running tool...', plain: 'Running tool...' },
      ]
      state.setSessionViewRenderedLines(lines)
      expect(state.sessionViewRenderedLines).toEqual(lines)
    })
  })

  describe('setSessionViewInputMode', () => {
    it('enables input mode', () => {
      state.setSessionViewInputMode(true)
      expect(state.sessionViewInputMode).toBe(true)
    })

    it('disables input mode', () => {
      state.setSessionViewInputMode(true)
      state.setSessionViewInputMode(false)
      expect(state.sessionViewInputMode).toBe(false)
    })
  })

  describe('setSessionViewInputBuffer', () => {
    it('sets empty input buffer', () => {
      state.setSessionViewInputBuffer('')
      expect(state.sessionViewInputBuffer).toBe('')
    })

    it('sets input buffer with text', () => {
      state.setSessionViewInputBuffer('Hello, world!')
      expect(state.sessionViewInputBuffer).toBe('Hello, world!')
    })

    it('appends to input buffer conceptually', () => {
      state.setSessionViewInputBuffer('Hello')
      state.setSessionViewInputBuffer(state.sessionViewInputBuffer + ', world!')
      expect(state.sessionViewInputBuffer).toBe('Hello, world!')
    })
  })

  describe('setSessionViewConfirmAbort', () => {
    it('sets confirm abort to true', () => {
      state.setSessionViewConfirmAbort(true)
      expect(state.sessionViewConfirmAbort).toBe(true)
    })

    it('sets confirm abort to false', () => {
      state.setSessionViewConfirmAbort(true)
      state.setSessionViewConfirmAbort(false)
      expect(state.sessionViewConfirmAbort).toBe(false)
    })
  })

  describe('setSessionViewError', () => {
    it('sets error message', () => {
      state.setSessionViewError('Connection failed')
      expect(state.sessionViewError).toBe('Connection failed')
    })

    it('clears error with null', () => {
      state.setSessionViewError('Some error')
      state.setSessionViewError(null)
      expect(state.sessionViewError).toBeNull()
    })
  })

  describe('setSessionViewConnecting', () => {
    it('sets connecting to true', () => {
      state.setSessionViewConnecting(true)
      expect(state.sessionViewConnecting).toBe(true)
    })

    it('sets connecting to false', () => {
      state.setSessionViewConnecting(true)
      state.setSessionViewConnecting(false)
      expect(state.sessionViewConnecting).toBe(false)
    })
  })

  describe('setSessionViewStatus', () => {
    it('sets status to idle', () => {
      state.setSessionViewStatus('idle')
      expect(state.sessionViewStatus).toBe('idle')
    })

    it('sets status to busy', () => {
      state.setSessionViewStatus('busy')
      expect(state.sessionViewStatus).toBe('busy')
    })

    it('sets status to custom value', () => {
      state.setSessionViewStatus('connecting')
      expect(state.sessionViewStatus).toBe('connecting')
    })
  })

  describe('setSessionViewSessions', () => {
    it('sets empty sessions array', () => {
      state.setSessionViewSessions([])
      expect(state.sessionViewSessions).toEqual([])
    })

    it('sets sessions array', () => {
      const sessions = [
        { id: '1', title: 'Session 1' },
        { id: '2', title: 'Session 2' },
      ]
      state.setSessionViewSessions(sessions)
      expect(state.sessionViewSessions).toEqual(sessions)
    })
  })

  describe('setSessionViewSessionIndex', () => {
    it('sets session index to zero', () => {
      state.setSessionViewSessionIndex(0)
      expect(state.sessionViewSessionIndex).toBe(0)
    })

    it('sets session index to positive value', () => {
      state.setSessionViewSessionIndex(5)
      expect(state.sessionViewSessionIndex).toBe(5)
    })
  })

  describe('setSessionViewSessionTitle', () => {
    it('sets empty title', () => {
      state.setSessionViewSessionTitle('')
      expect(state.sessionViewSessionTitle).toBe('')
    })

    it('sets session title', () => {
      state.setSessionViewSessionTitle('Implementing feature X')
      expect(state.sessionViewSessionTitle).toBe('Implementing feature X')
    })
  })

  describe('setSessionViewEventAbort', () => {
    it('sets abort controller', () => {
      const controller = new AbortController()
      state.setSessionViewEventAbort(controller)
      expect(state.sessionViewEventAbort).toBe(controller)
    })

    it('clears abort controller with null', () => {
      state.setSessionViewEventAbort(new AbortController())
      state.setSessionViewEventAbort(null)
      expect(state.sessionViewEventAbort).toBeNull()
    })
  })

  describe('sessionViewPendingPermissions Map', () => {
    it('starts empty', () => {
      expect(state.sessionViewPendingPermissions.size).toBe(0)
    })

    it('can add pending permissions', () => {
      const permission: Permission = {
        id: 'perm-123',
        tool: 'bash',
        args: { command: 'ls -la' },
        message: 'Allow shell command?',
      }
      state.sessionViewPendingPermissions.set('perm-123', permission)
      expect(state.sessionViewPendingPermissions.size).toBe(1)
      expect(state.sessionViewPendingPermissions.get('perm-123')).toEqual(permission)
    })

    it('can remove pending permissions', () => {
      state.sessionViewPendingPermissions.set('perm-123', {
        id: 'perm-123',
        tool: 'bash',
      })
      state.sessionViewPendingPermissions.delete('perm-123')
      expect(state.sessionViewPendingPermissions.size).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // resetSessionViewState
  // ---------------------------------------------------------------------------

  describe('resetSessionViewState', () => {
    it('resets all session view state to defaults', () => {
      // Set up various state
      state.setSessionViewActive(true)
      state.setSessionViewClient({ mock: true })
      state.setSessionViewInstance({ instanceId: 'test', status: 'busy', ts: Date.now() })
      state.setSessionViewSessionID('session-123')
      state.setSessionViewMessages([{ info: { role: 'user' }, parts: [] }])
      state.setSessionViewScrollOffset(50)
      state.setSessionViewRenderedLines([{ type: 'text', text: 'test', plain: 'test' }])
      state.sessionViewPendingPermissions.set('perm-1', { id: 'perm-1', tool: 'bash' })
      state.setSessionViewInputMode(true)
      state.setSessionViewInputBuffer('some input')
      state.setSessionViewConfirmAbort(true)
      state.setSessionViewError('Some error')
      state.setSessionViewConnecting(true)
      state.setSessionViewStatus('busy')
      state.setSessionViewSessions([{ id: '1' }])
      state.setSessionViewSessionIndex(5)
      state.setSessionViewSessionTitle('Test Title')
      state.setSessionViewEventAbort(new AbortController())

      // Reset
      state.resetSessionViewState()

      // Verify all reset
      expect(state.sessionViewActive).toBe(false)
      expect(state.sessionViewClient).toBeNull()
      expect(state.sessionViewInstance).toBeNull()
      expect(state.sessionViewSessionID).toBeNull()
      expect(state.sessionViewMessages).toEqual([])
      expect(state.sessionViewScrollOffset).toBe(0)
      expect(state.sessionViewRenderedLines).toEqual([])
      expect(state.sessionViewPendingPermissions.size).toBe(0)
      expect(state.sessionViewInputMode).toBe(false)
      expect(state.sessionViewInputBuffer).toBe('')
      expect(state.sessionViewConfirmAbort).toBe(false)
      expect(state.sessionViewError).toBeNull()
      expect(state.sessionViewConnecting).toBe(false)
      expect(state.sessionViewStatus).toBe('idle')
      expect(state.sessionViewSessions).toEqual([])
      expect(state.sessionViewSessionIndex).toBe(0)
      expect(state.sessionViewSessionTitle).toBe('')
      expect(state.sessionViewEventAbort).toBeNull()
    })

    it('aborts the event abort controller if present', () => {
      const controller = new AbortController()
      const abortSpy = vi.spyOn(controller, 'abort')
      
      state.setSessionViewEventAbort(controller)
      state.resetSessionViewState()
      
      expect(abortSpy).toHaveBeenCalledOnce()
      expect(state.sessionViewEventAbort).toBeNull()
    })

    it('does not throw if abort controller is null', () => {
      state.setSessionViewEventAbort(null)
      expect(() => state.resetSessionViewState()).not.toThrow()
    })

    it('clears pending permissions map', () => {
      state.sessionViewPendingPermissions.set('a', { id: 'a', tool: 'bash' })
      state.sessionViewPendingPermissions.set('b', { id: 'b', tool: 'edit' })
      state.sessionViewPendingPermissions.set('c', { id: 'c', tool: 'write' })
      
      state.resetSessionViewState()
      
      expect(state.sessionViewPendingPermissions.size).toBe(0)
    })

    it('can be called multiple times safely', () => {
      state.setSessionViewActive(true)
      state.setSessionViewSessionID('test-123')
      
      state.resetSessionViewState()
      state.resetSessionViewState()
      state.resetSessionViewState()
      
      expect(state.sessionViewActive).toBe(false)
      expect(state.sessionViewSessionID).toBeNull()
    })

    it('resets arrays to new empty arrays (not same reference)', () => {
      const originalMessages = state.sessionViewMessages
      const originalRenderedLines = state.sessionViewRenderedLines
      const originalSessions = state.sessionViewSessions
      
      state.setSessionViewMessages([{ info: { role: 'user' }, parts: [] }])
      state.resetSessionViewState()
      
      // Should be new arrays, not the same reference
      expect(state.sessionViewMessages).not.toBe(originalMessages)
      expect(state.sessionViewRenderedLines).not.toBe(originalRenderedLines)
      expect(state.sessionViewSessions).not.toBe(originalSessions)
    })
  })

  // ---------------------------------------------------------------------------
  // Default Values
  // ---------------------------------------------------------------------------

  describe('default values', () => {
    // Note: These test the module's initial state, but since we reset in beforeEach,
    // we're effectively testing that reset returns to these defaults

    it('viewMode defaults to grouped', () => {
      // Reset sets it back to 'grouped'
      expect(state.viewMode).toBe('grouped')
    })

    it('selectedIndex defaults to -1', () => {
      expect(state.selectedIndex).toBe(-1)
    })

    it('selectableItems defaults to empty array', () => {
      expect(state.selectableItems).toEqual([])
    })

    it('detailView defaults to null', () => {
      expect(state.detailView).toBeNull()
    })

    it('spinnerFrame defaults to 0', () => {
      expect(state.spinnerFrame).toBe(0)
    })

    it('termWidth defaults to 80', () => {
      expect(state.termWidth).toBe(80)
    })

    it('termHeight defaults to 24', () => {
      expect(state.termHeight).toBe(24)
    })

    it('sessionViewActive defaults to false', () => {
      expect(state.sessionViewActive).toBe(false)
    })

    it('sessionViewStatus defaults to idle', () => {
      expect(state.sessionViewStatus).toBe('idle')
    })

    it('sessionViewScrollOffset defaults to 0', () => {
      expect(state.sessionViewScrollOffset).toBe(0)
    })

    it('sessionViewSessionIndex defaults to 0', () => {
      expect(state.sessionViewSessionIndex).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles setting same value multiple times', () => {
      state.setViewMode('flat')
      state.setViewMode('flat')
      state.setViewMode('flat')
      expect(state.viewMode).toBe('flat')
    })

    it('handles rapid state changes', () => {
      for (let i = 0; i < 100; i++) {
        state.setSelectedIndex(i)
        state.setSpinnerFrame(i % 10)
      }
      expect(state.selectedIndex).toBe(99)
      expect(state.spinnerFrame).toBe(9)
    })

    it('handles large terminal dimensions', () => {
      state.setTermSize(10000, 5000)
      expect(state.termWidth).toBe(10000)
      expect(state.termHeight).toBe(5000)
    })

    it('handles empty string values', () => {
      state.setSessionViewInputBuffer('')
      state.setSessionViewSessionTitle('')
      state.setSessionViewError(null)
      expect(state.sessionViewInputBuffer).toBe('')
      expect(state.sessionViewSessionTitle).toBe('')
      expect(state.sessionViewError).toBeNull()
    })

    it('handles unicode in strings', () => {
      state.setSessionViewInputBuffer('Hello 世界 🚀')
      state.setSessionViewSessionTitle('Testing émojis 🎉')
      expect(state.sessionViewInputBuffer).toBe('Hello 世界 🚀')
      expect(state.sessionViewSessionTitle).toBe('Testing émojis 🎉')
    })

    it('instances Map preserves complex instance data', () => {
      const complexInstance: Instance = {
        instanceId: 'complex-123',
        sessionID: 'session-456',
        parentID: 'parent-789',
        status: 'busy',
        project: 'my-project',
        directory: '/home/user/projects/my-project',
        dirName: 'my-project',
        branch: 'feature/new-thing',
        host: 'docker-host-01',
        title: 'Implementing new feature with special chars: "quotes" & <brackets>',
        serverUrl: 'http://localhost:3000',
        ts: 1703123456789,
        cost: 0.1234,
        tokens: { input: 1500, output: 500, total: 2000 },
        model: 'anthropic/claude-sonnet-4',
        busyTime: 60000,
        _isChildSession: true,
        _fromServer: true,
        children: [
          { instanceId: 'child-1', status: 'idle', ts: 1703123456000 },
        ],
      }
      
      state.instances.set('complex-123', complexInstance)
      const retrieved = state.instances.get('complex-123')
      
      expect(retrieved).toEqual(complexInstance)
      expect(retrieved?.children?.length).toBe(1)
      expect(retrieved?.tokens?.total).toBe(2000)
    })
  })
})
