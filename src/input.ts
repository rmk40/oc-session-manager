// Keyboard input handling

import * as readline from 'node:readline'
import type { KeyEvent } from './types.js'
import { ANSI } from './config.js'
import {
  instances,
  busySince,
  idleSince,
  viewMode,
  selectedIndex,
  selectableItems,
  collapsedGroups,
  detailView,
  termWidth,
  termHeight,
  sessionViewActive,
  sessionViewInputMode,
  sessionViewInputBuffer,
  sessionViewConfirmAbort,
  sessionViewPendingPermissions,
  sessionViewStatus,
  setViewMode,
  setSelectedIndex,
  setDetailView,
  setTermSize,
  setSessionViewInputMode,
  setSessionViewInputBuffer,
  setSessionViewConfirmAbort,
} from './state.js'
import { getEffectiveStatus, getGroupKey } from './utils.js'
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

// ---------------------------------------------------------------------------
// Main List Keyboard Handler
// ---------------------------------------------------------------------------

function handleMainKeypress(str: string, key: KeyEvent): void {
  // Quit
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    process.stdout.write(ANSI.showCursor)
    process.stdout.write(ANSI.clearScreen + ANSI.cursorHome)
    process.exit(0)
  }
  
  // Detail view mode
  if (detailView) {
    if (key.name === 'escape' || key.name === 'return') {
      setDetailView(null)
      render()
      return
    }
    if (key.name === 'd') {
      instances.delete(detailView)
      busySince.delete(detailView)
      idleSince.delete(detailView)
      setDetailView(null)
      render()
      return
    }
    return
  }
  
  // Navigation
  if (key.name === 'up' || key.name === 'k') {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1)
    } else if (selectedIndex === -1 && selectableItems.length > 0) {
      setSelectedIndex(selectableItems.length - 1)
    }
    render()
    return
  }
  
  if (key.name === 'down' || key.name === 'j') {
    if (selectedIndex < selectableItems.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    }
    render()
    return
  }
  
  // Toggle view mode
  if (key.name === 'tab') {
    setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')
    setSelectedIndex(-1)
    render()
    return
  }
  
  // Enter: expand/collapse group or open session viewer
  if (key.name === 'return') {
    if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
      const item = selectableItems[selectedIndex]
      if (item.type === 'group' && item.key) {
        if (collapsedGroups.has(item.key)) {
          collapsedGroups.delete(item.key)
        } else {
          collapsedGroups.add(item.key)
        }
        render()
      } else if (item.type === 'instance' && item.instanceId) {
        const inst = instances.get(item.instanceId)
        if (inst) {
          enterSessionView(inst)
        }
      }
    }
    return
  }
  
  // 'w' for watch (alternative to Enter for session viewer)
  if (key.name === 'w') {
    if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
      const item = selectableItems[selectedIndex]
      if (item.type === 'instance' && item.instanceId) {
        const inst = instances.get(item.instanceId)
        if (inst) {
          enterSessionView(inst)
        }
      }
    }
    return
  }
  
  // 'i' for info (detail view)
  if (key.name === 'i') {
    if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
      const item = selectableItems[selectedIndex]
      if (item.type === 'instance' && item.instanceId) {
        setDetailView(item.instanceId)
        render()
      }
    }
    return
  }
  
  // Delete selected instance
  if (key.name === 'd' || key.name === 'delete' || key.name === 'backspace') {
    if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
      const item = selectableItems[selectedIndex]
      if (item.type === 'instance' && item.instanceId) {
        instances.delete(item.instanceId)
        busySince.delete(item.instanceId)
        idleSince.delete(item.instanceId)
        if (selectedIndex >= selectableItems.length - 1) {
          setSelectedIndex(Math.max(-1, selectableItems.length - 2))
        }
      } else if (item.type === 'group' && item.key) {
        // Delete all instances in group
        for (const inst of instances.values()) {
          if (getGroupKey(inst) === item.key) {
            instances.delete(inst.instanceId)
            busySince.delete(inst.instanceId)
            idleSince.delete(inst.instanceId)
          }
        }
        collapsedGroups.delete(item.key)
        setSelectedIndex(Math.max(-1, selectedIndex - 1))
      }
      render()
    }
    return
  }
  
  // Abort selected session (if busy)
  if (key.name === 'a') {
    if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
      const item = selectableItems[selectedIndex]
      if (item.type === 'instance' && item.instanceId) {
        const inst = instances.get(item.instanceId)
        if (inst && inst.serverUrl && inst.sessionID) {
          const status = getEffectiveStatus(inst)
          if (status === 'busy') {
            abortInstanceSession(inst)
          }
        }
      }
    }
    return
  }
  
  // Escape clears selection
  if (key.name === 'escape') {
    setSelectedIndex(-1)
    render()
    return
  }
  
  // Clear stale
  if (key.name === 'c') {
    for (const [id, inst] of instances) {
      if (getEffectiveStatus(inst) === 'stale') {
        instances.delete(id)
        busySince.delete(id)
        idleSince.delete(id)
      }
    }
    if (selectedIndex >= selectableItems.length) {
      setSelectedIndex(Math.max(-1, selectableItems.length - 1))
    }
    render()
  }
  
  // Refresh
  if (key.name === 'r') {
    render()
  }
}

// ---------------------------------------------------------------------------
// Session View Keyboard Handler
// ---------------------------------------------------------------------------

function handleSessionViewKeypress(str: string, key: KeyEvent): void {
  // Input mode: capture text
  if (sessionViewInputMode) {
    if (key.name === 'escape') {
      setSessionViewInputMode(false)
      setSessionViewInputBuffer('')
      render()
      return
    }
    
    if (key.name === 'return') {
      const text = sessionViewInputBuffer
      sendMessage(text)
      return
    }
    
    if (key.name === 'backspace') {
      setSessionViewInputBuffer(sessionViewInputBuffer.slice(0, -1))
      render()
      return
    }
    
    // Regular character input
    if (str && str.length === 1 && !key.ctrl && !key.meta) {
      setSessionViewInputBuffer(sessionViewInputBuffer + str)
      render()
      return
    }
    
    return
  }
  
  // Abort confirmation mode
  if (sessionViewConfirmAbort) {
    if (key.name === 'y') {
      abortSession()
      return
    }
    if (key.name === 'n' || key.name === 'escape') {
      setSessionViewConfirmAbort(false)
      render()
      return
    }
    return
  }
  
  // Permission handling
  if (sessionViewPendingPermissions.size > 0) {
    const [permId] = sessionViewPendingPermissions.keys()
    
    if (key.name === 'a' && !key.shift) {
      respondToPermission(permId, 'allow', false)
      return
    }
    if (key.name === 'a' && key.shift) {
      respondToPermission(permId, 'allow', true)
      return
    }
    if (key.name === 'd' && !key.shift) {
      respondToPermission(permId, 'deny', false)
      return
    }
    if (key.name === 'd' && key.shift) {
      respondToPermission(permId, 'deny', true)
      return
    }
    if (key.name === 'escape') {
      sessionViewPendingPermissions.delete(permId)
      render()
      return
    }
  }
  
  // Exit session view
  if (key.name === 'escape' || key.name === 'q') {
    exitSessionView()
    return
  }
  
  // Scrolling
  if (key.name === 'up' || key.name === 'k') {
    scrollSessionView('up')
    return
  }
  if (key.name === 'down' || key.name === 'j') {
    scrollSessionView('down')
    return
  }
  if (key.name === 'pageup') {
    scrollSessionView('pageup')
    return
  }
  if (key.name === 'pagedown') {
    scrollSessionView('pagedown')
    return
  }
  if (key.name === 'home' || (key.ctrl && key.name === 'home')) {
    scrollSessionView('home')
    return
  }
  if (key.name === 'end' || (key.ctrl && key.name === 'end')) {
    scrollSessionView('end')
    return
  }
  
  // Session switching (Ctrl+Left/Right)
  if (key.ctrl && key.name === 'left') {
    switchSession('prev')
    return
  }
  if (key.ctrl && key.name === 'right') {
    switchSession('next')
    return
  }
  
  // Abort session
  if (key.name === 'a' && (sessionViewStatus === 'busy' || sessionViewStatus === 'running' || sessionViewStatus === 'pending')) {
    setSessionViewConfirmAbort(true)
    render()
    return
  }
  
  // Send message
  if (key.name === 'm') {
    setSessionViewInputMode(true)
    setSessionViewInputBuffer('')
    render()
    return
  }
  
  // Show permissions (focus on them)
  if (key.name === 'p' && sessionViewPendingPermissions.size > 0) {
    render() // Just re-render, permissions will show
    return
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupKeyboardInput(): void {
  // Set up raw mode for keypress handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()
  
  // Enable keypress events
  readline.emitKeypressEvents(process.stdin)
  
  // Handle terminal resize
  process.stdout.on('resize', () => {
    setTermSize(process.stdout.columns || 80, process.stdout.rows || 24)
    render()
  })
  
  // Initialize terminal size
  setTermSize(process.stdout.columns || 80, process.stdout.rows || 24)
  
  // Hide cursor
  process.stdout.write(ANSI.hideCursor)
  
  // Handle keypress events
  process.stdin.on('keypress', (str: string | undefined, key: KeyEvent) => {
    if (!key) return
    
    if (sessionViewActive) {
      handleSessionViewKeypress(str || '', key)
    } else {
      handleMainKeypress(str || '', key)
    }
  })
  
  // Cleanup on exit
  process.on('exit', () => {
    process.stdout.write(ANSI.showCursor)
  })
  
  process.on('SIGINT', () => {
    process.stdout.write(ANSI.showCursor)
    process.stdout.write(ANSI.clearScreen + ANSI.cursorHome)
    process.exit(0)
  })
  
  process.on('SIGTERM', () => {
    process.stdout.write(ANSI.showCursor)
    process.exit(0)
  })
}
