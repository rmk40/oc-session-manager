// Keyboard and mouse input handling

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
  sessionViewRenderedLines,
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
// Terminal Cleanup (defined early for use in handlers)
// ---------------------------------------------------------------------------

function cleanupTerminal(): void {
  process.stdout.write(ANSI.disableMouse)
  process.stdout.write(ANSI.showCursor)
  process.stdout.write(ANSI.exitAltScreen)
}

// ---------------------------------------------------------------------------
// Main List Keyboard Handler
// ---------------------------------------------------------------------------

function handleMainKeypress(str: string, key: KeyEvent): void {
  // Quit
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    cleanupTerminal()
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
// Mouse Event Parsing (SGR extended mode)
// ---------------------------------------------------------------------------

interface MouseEvent {
  type: 'click' | 'release' | 'drag' | 'scroll-up' | 'scroll-down'
  button: number  // 0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down
  x: number       // 1-based column
  y: number       // 1-based row
  shift: boolean
  ctrl: boolean
  meta: boolean
}

function parseMouseEvent(sequence: string): MouseEvent | null {
  // SGR extended mouse format: \x1b[<button;x;yM or \x1b[<button;x;ym
  // M = press, m = release
  const match = sequence.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
  if (!match) return null
  
  const buttonCode = parseInt(match[1], 10)
  const x = parseInt(match[2], 10)
  const y = parseInt(match[3], 10)
  const isPress = match[4] === 'M'
  
  // Decode button and modifiers
  const button = buttonCode & 3  // bits 0-1 = button
  const shift = (buttonCode & 4) !== 0
  const meta = (buttonCode & 8) !== 0
  const ctrl = (buttonCode & 16) !== 0
  const motion = (buttonCode & 32) !== 0
  const scrollUp = (buttonCode & 64) !== 0
  const scrollDown = (buttonCode & 65) === 65
  
  let type: MouseEvent['type']
  if (scrollUp && !scrollDown) {
    type = 'scroll-up'
  } else if (scrollDown) {
    type = 'scroll-down'
  } else if (motion) {
    type = 'drag'
  } else if (isPress) {
    type = 'click'
  } else {
    type = 'release'
  }
  
  return { type, button, x, y, shift, ctrl, meta }
}

// ---------------------------------------------------------------------------
// Mouse Event Handlers
// ---------------------------------------------------------------------------

function handleMainMouseEvent(event: MouseEvent): void {
  // Scroll wheel
  if (event.type === 'scroll-up') {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1)
    } else if (selectedIndex === -1 && selectableItems.length > 0) {
      setSelectedIndex(selectableItems.length - 1)
    }
    render()
    return
  }
  
  if (event.type === 'scroll-down') {
    if (selectedIndex < selectableItems.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    }
    render()
    return
  }
  
  // Left click
  if (event.type === 'click' && event.button === 0) {
    // Header takes 3 lines, so content starts at row 4
    const contentRow = event.y - 3
    
    if (contentRow >= 1 && contentRow <= selectableItems.length) {
      const clickedIndex = contentRow - 1
      
      if (clickedIndex === selectedIndex) {
        // Double-click effect: if same item, trigger action
        const item = selectableItems[clickedIndex]
        if (item.type === 'group' && item.key) {
          if (collapsedGroups.has(item.key)) {
            collapsedGroups.delete(item.key)
          } else {
            collapsedGroups.add(item.key)
          }
        } else if (item.type === 'instance' && item.instanceId) {
          const inst = instances.get(item.instanceId)
          if (inst) {
            enterSessionView(inst)
            return
          }
        }
      } else {
        // First click: select
        setSelectedIndex(clickedIndex)
      }
      render()
    }
  }
}

function handleSessionViewMouseEvent(event: MouseEvent): void {
  // Scroll wheel for message scrolling
  if (event.type === 'scroll-up') {
    scrollSessionView('up')
    return
  }
  
  if (event.type === 'scroll-down') {
    scrollSessionView('down')
    return
  }
}

// ---------------------------------------------------------------------------
// Raw Data Handler (for mouse events)
// ---------------------------------------------------------------------------

function handleRawData(data: Buffer): void {
  const str = data.toString()
  
  // Check for mouse event sequences
  if (str.includes('\x1b[<')) {
    const mouseEvent = parseMouseEvent(str)
    if (mouseEvent) {
      if (sessionViewActive) {
        handleSessionViewMouseEvent(mouseEvent)
      } else if (!detailView) {
        handleMainMouseEvent(mouseEvent)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupKeyboardInput(): void {
  // Enter alternate screen buffer (prevents scroll interference)
  process.stdout.write(ANSI.enterAltScreen)
  
  // Enable mouse tracking
  process.stdout.write(ANSI.enableMouse)
  
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
  
  // Handle raw data for mouse events (before keypress parsing)
  process.stdin.on('data', handleRawData)
  
  // Handle keypress events (keyboard)
  process.stdin.on('keypress', (str: string | undefined, key: KeyEvent) => {
    if (!key) return
    
    if (sessionViewActive) {
      handleSessionViewKeypress(str || '', key)
    } else {
      handleMainKeypress(str || '', key)
    }
  })
  
  /* v8 ignore start - process signal handlers */
  process.on('exit', () => {
    cleanupTerminal()
  })
  
  process.on('SIGINT', () => {
    cleanupTerminal()
    process.exit(0)
  })
  
  process.on('SIGTERM', () => {
    cleanupTerminal()
    process.exit(0)
  })
  /* v8 ignore stop */
}
