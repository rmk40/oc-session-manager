// TUI rendering functions

import type { Instance, SelectableItem } from './types.js'
import { ANSI, SPINNER } from './config.js'
import {
  instances,
  viewMode,
  selectedIndex,
  selectableItems,
  collapsedGroups,
  detailView,
  spinnerFrame,
  termWidth,
  termHeight,
  sessionViewActive,
  sessionViewInstance,
  sessionViewSessionID,
  sessionViewRenderedLines,
  sessionViewPendingPermissions,
  sessionViewInputMode,
  sessionViewInputBuffer,
  sessionViewConfirmAbort,
  sessionViewError,
  sessionViewConnecting,
  sessionViewStatus,
  sessionViewSessions,
  sessionViewSessionIndex,
  sessionViewSessionTitle,
  sessionViewScrollOffset,
  setSelectableItems,
  setSpinnerFrame,
  setDetailView,
} from './state.js'
import {
  formatRelativeTime,
  formatDuration,
  formatCost,
  formatTokens,
  truncate,
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

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function renderRow(content: string, visibleLen: number, isSelected = false, borderColor = ANSI.cyan): string {
  const pad = Math.max(0, termWidth - visibleLen - 2)
  const selStart = isSelected ? ANSI.inverse : ''
  const selEnd = isSelected ? ANSI.reset : ''
  return `${borderColor}│${ANSI.reset}${selStart}${content}${' '.repeat(pad)}${selEnd}${borderColor}│${ANSI.reset}\n`
}

function buildInstanceTree(insts: Instance[]): Instance[] {
  const bySessionId = new Map<string, Instance>()
  const roots: Instance[] = []
  
  // First pass: map all instances by sessionID
  for (const inst of insts) {
    if (inst.sessionID) {
      bySessionId.set(inst.sessionID, { ...inst, children: [] })
    } else {
      // No session ID, treat as root
      roots.push({ ...inst, children: [] })
    }
  }
  
  // Second pass: link children to parents
  for (const inst of insts) {
    if (!inst.sessionID) continue // Already handled
    
    const node = bySessionId.get(inst.sessionID)!
    
    if (inst.parentID && bySessionId.has(inst.parentID)) {
      const parent = bySessionId.get(inst.parentID)!
      parent.children = parent.children || []
      parent.children.push(node)
    } else {
      // No parent or parent not found in this group -> root
      roots.push(node)
    }
  }
  
  // Sort purely by instanceId for stable ordering
  const sortFn = (a: Instance, b: Instance) => (a.instanceId || '').localeCompare(b.instanceId || '')
  
  roots.sort(sortFn)
  
  const sortChildren = (node: Instance) => {
    if (node.children && node.children.length > 0) {
      node.children.sort(sortFn)
      node.children.forEach(sortChildren)
    }
  }
  
  roots.forEach(sortChildren)
  
  return roots
}

// ---------------------------------------------------------------------------
// Detail View
// ---------------------------------------------------------------------------

function renderDetailView(inst: Instance): string {
  let output = ''
  
  const status = getEffectiveStatus(inst)
  const identifier = `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${inst.sessionID?.slice(-4) ?? '----'}`
  
  // Header
  const title = ` ${identifier} `
  const headerPad = Math.max(0, termWidth - title.length - 2)
  output += `${ANSI.bold}${ANSI.cyan}┌${title}${'─'.repeat(headerPad)}┐${ANSI.reset}\n`
  
  // Status row
  const statusColors: Record<string, string> = { idle: ANSI.green, busy: ANSI.yellow, stale: ANSI.gray }
  const statusIcons: Record<string, string> = { idle: '●', busy: '○', stale: '◌' }
  const statusLine = `  Status: ${statusColors[status]}${statusIcons[status]} ${status.toUpperCase()}${ANSI.reset}`
  output += renderRow(statusLine, `  Status: ${statusIcons[status]} ${status.toUpperCase()}`.length)
  
  // Session info
  output += renderRow(`  Session ID: ${inst.sessionID ?? 'N/A'}`, `  Session ID: ${inst.sessionID ?? 'N/A'}`.length)
  if (inst.parentID) {
    output += renderRow(`  Parent ID: ${inst.parentID}`, `  Parent ID: ${inst.parentID}`.length)
  }
  output += renderRow(`  Title: ${inst.title ?? 'N/A'}`, `  Title: ${inst.title ?? 'N/A'}`.length)
  output += renderRow(`  Directory: ${inst.directory ?? 'N/A'}`, `  Directory: ${inst.directory ?? 'N/A'}`.length)
  output += renderRow(`  Host: ${inst.host ?? 'N/A'}`, `  Host: ${inst.host ?? 'N/A'}`.length)
  
  // Separator
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`
  
  // Model & Cost
  output += renderRow(`  Model: ${inst.model ?? 'N/A'}`, `  Model: ${inst.model ?? 'N/A'}`.length)
  output += renderRow(`  Cost: ${formatCost(inst.cost) || '$0.00'}`, `  Cost: ${formatCost(inst.cost) || '$0.00'}`.length)
  
  // Tokens
  const tokIn = inst.tokens?.input ?? 0
  const tokOut = inst.tokens?.output ?? 0
  const tokTotal = inst.tokens?.total ?? 0
  output += renderRow(`  Tokens: ${tokTotal.toLocaleString()} total (${tokIn.toLocaleString()} in / ${tokOut.toLocaleString()} out)`, 
    `  Tokens: ${tokTotal.toLocaleString()} total (${tokIn.toLocaleString()} in / ${tokOut.toLocaleString()} out)`.length)
  
  // Timing
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`
  output += renderRow(`  Last Update: ${formatRelativeTime(inst.ts)}`, `  Last Update: ${formatRelativeTime(inst.ts)}`.length)
  
  if (inst.busyTime) {
    output += renderRow(`  Total Busy Time: ${formatDuration(inst.busyTime)}`, `  Total Busy Time: ${formatDuration(inst.busyTime)}`.length)
  }
  
  if (status === 'busy') {
    const duration = getBusyDuration(inst)
    const longRunning = isLongRunning(inst)
    const durationStr = `  Busy For: ${formatDuration(duration)}${longRunning ? ' ⚠️  LONG RUNNING' : ''}`
    const durationColor = longRunning ? ANSI.red : ''
    output += renderRow(`${durationColor}${durationStr}${ANSI.reset}`, durationStr.length)
  }
  
  // Footer
  output += `${ANSI.cyan}└${'─'.repeat(termWidth - 2)}┘${ANSI.reset}\n`
  output += `${ANSI.dim}  Esc/Enter: back  d: remove${ANSI.reset}`
  
  return output
}

// ---------------------------------------------------------------------------
// Session View Components
// ---------------------------------------------------------------------------

function renderSessionViewMessage(message: string, height: number, color = ANSI.dim): string {
  let output = ''
  const midPoint = Math.floor(height / 2)
  
  for (let i = 0; i < height; i++) {
    if (i === midPoint) {
      const pad = Math.max(0, Math.floor((termWidth - message.length - 4) / 2))
      const content = `${' '.repeat(pad)}${color}${message}${ANSI.reset}`
      const totalPad = Math.max(0, termWidth - message.length - pad - 2)
      output += `${ANSI.cyan}│${ANSI.reset}${content}${' '.repeat(totalPad)}${ANSI.cyan}│${ANSI.reset}\n`
    } else {
      output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
    }
  }
  
  return output
}

function renderSessionViewConfirmAbort(height: number): string {
  let output = ''
  const midPoint = Math.floor(height / 2)
  
  const line1 = 'Abort this session?'
  const line2 = '[y]es  [n]o'
  
  for (let i = 0; i < height; i++) {
    if (i === midPoint - 1) {
      const pad = Math.max(0, Math.floor((termWidth - line1.length - 4) / 2))
      const content = `${' '.repeat(pad)}${ANSI.yellow}${line1}${ANSI.reset}`
      const totalPad = Math.max(0, termWidth - line1.length - pad - 2)
      output += `${ANSI.cyan}│${ANSI.reset}${content}${' '.repeat(totalPad)}${ANSI.cyan}│${ANSI.reset}\n`
    } else if (i === midPoint + 1) {
      const pad = Math.max(0, Math.floor((termWidth - line2.length - 4) / 2))
      const content = `${' '.repeat(pad)}${ANSI.dim}${line2}${ANSI.reset}`
      const totalPad = Math.max(0, termWidth - line2.length - pad - 2)
      output += `${ANSI.cyan}│${ANSI.reset}${content}${' '.repeat(totalPad)}${ANSI.cyan}│${ANSI.reset}\n`
    } else {
      output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
    }
  }
  
  return output
}

function renderSessionViewInput(height: number): string {
  let output = ''
  
  // Show messages in upper portion
  const inputBoxHeight = 5
  const messagesHeight = height - inputBoxHeight
  output += renderSessionViewContent(messagesHeight)
  
  // Input box separator
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`
  
  // Input box
  const prompt = '> '
  const inputWidth = termWidth - 4 - prompt.length
  const displayBuffer = sessionViewInputBuffer.length > inputWidth 
    ? sessionViewInputBuffer.slice(-inputWidth) 
    : sessionViewInputBuffer
  const cursor = '▌'
  
  output += `${ANSI.cyan}│${ANSI.reset} ${ANSI.green}${prompt}${ANSI.reset}${displayBuffer}${cursor}${' '.repeat(Math.max(0, inputWidth - displayBuffer.length - 1))}${ANSI.cyan}│${ANSI.reset}\n`
  output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
  output += `${ANSI.cyan}│${ANSI.reset} ${ANSI.dim}[Enter] send  [Esc] cancel${ANSI.reset}${' '.repeat(Math.max(0, termWidth - 30))}${ANSI.cyan}│${ANSI.reset}\n`
  
  return output
}

function renderSessionViewWithPermissions(height: number): string {
  // Get first pending permission
  const entry = sessionViewPendingPermissions.entries().next().value
  if (!entry) return renderSessionViewContent(height)
  const [permId, perm] = entry
  
  let output = ''
  const boxHeight = 8
  const contentHeight = height - boxHeight
  
  // Show messages above
  output += renderSessionViewContent(contentHeight)
  
  // Permission box
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`
  
  const toolLine = `Tool: ${perm.tool || 'unknown'}`
  const argsStr = perm.args ? formatToolArgs(perm.args) : ''
  const argsLine = argsStr ? truncate(argsStr, termWidth - 6) : ''
  
  output += `${ANSI.cyan}│${ANSI.reset} ${ANSI.yellow}Permission Request${ANSI.reset}${' '.repeat(Math.max(0, termWidth - 21))}${ANSI.cyan}│${ANSI.reset}\n`
  output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
  output += `${ANSI.cyan}│${ANSI.reset}   ${toolLine}${' '.repeat(Math.max(0, termWidth - toolLine.length - 5))}${ANSI.cyan}│${ANSI.reset}\n`
  if (argsLine) {
    output += `${ANSI.cyan}│${ANSI.reset}   ${ANSI.dim}${argsLine}${ANSI.reset}${' '.repeat(Math.max(0, termWidth - argsLine.length - 5))}${ANSI.cyan}│${ANSI.reset}\n`
  } else /* v8 ignore next */ {
    output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
  }
  output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
  
  const helpLine = '[a]llow  [A]llow always  [d]eny  [D]eny always  [Esc] dismiss'
  const helpPad = Math.max(0, Math.floor((termWidth - helpLine.length - 2) / 2))
  output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(helpPad)}${ANSI.dim}${helpLine}${ANSI.reset}${' '.repeat(Math.max(0, termWidth - helpLine.length - helpPad - 2))}${ANSI.cyan}│${ANSI.reset}\n`
  
  return output
}

function renderSessionViewContent(height: number): string {
  let output = ''
  
  if (sessionViewRenderedLines.length === 0) {
    return renderSessionViewMessage('No messages yet', height)
  }
  
  // Calculate which lines to show based on scroll offset
  const totalLines = sessionViewRenderedLines.length
  const startLine = Math.max(0, totalLines - height - sessionViewScrollOffset)
  const endLine = Math.min(totalLines, startLine + height)
  
  // Render visible lines
  let linesRendered = 0
  for (let i = startLine; i < endLine; i++) {
    const line = sessionViewRenderedLines[i]
    const content = line.text || ''
    const plainLen = (line.plain || content).length
    const pad = Math.max(0, termWidth - plainLen - 2)
    output += `${ANSI.cyan}│${ANSI.reset}${content}${' '.repeat(pad)}${ANSI.cyan}│${ANSI.reset}\n`
    linesRendered++
  }
  
  // Fill remaining space
  while (linesRendered < height) {
    output += `${ANSI.cyan}│${ANSI.reset}${' '.repeat(termWidth - 2)}${ANSI.cyan}│${ANSI.reset}\n`
    linesRendered++
  }
  
  return output
}

// ---------------------------------------------------------------------------
// Session View
// ---------------------------------------------------------------------------

function renderSessionView(): string {
  let output = ''
  
  const inst = sessionViewInstance
  const identifier = inst 
    ? `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${sessionViewSessionID?.slice(-4) ?? '----'}`
    : 'Unknown'
  
  // Status indicator
  const status = String(sessionViewStatus || 'idle')
  const statusColors: Record<string, string> = { idle: ANSI.green, busy: ANSI.yellow, running: ANSI.yellow, pending: ANSI.yellow }
  const statusIcons: Record<string, string> = { idle: '●', busy: '○', running: '○', pending: '○' }
  const statusColor = statusColors[status] || ANSI.gray
  const statusIcon = statusIcons[status] || '◌'
  const statusText = `${statusColor}${statusIcon} ${status.toUpperCase()}${ANSI.reset}`
  
  // Session navigation indicator
  let navIndicator = ''
  if (sessionViewSessions.length > 1) {
    navIndicator = ` [${sessionViewSessionIndex + 1}/${sessionViewSessions.length}]`
  }
  
  // Header with title
  const sessionTitle = sessionViewSessionTitle ? ` "${truncate(sessionViewSessionTitle, 30)}"` : ''
  const title = ` ${identifier}${sessionTitle}${navIndicator} `
  const statusPad = ` ${statusIcon} ${status.toUpperCase()} `
  const headerPad = Math.max(0, termWidth - title.length - statusPad.length - 2)
  output += `${ANSI.bold}${ANSI.cyan}┌${ANSI.reset}${ANSI.bold}${title}${ANSI.reset}${ANSI.cyan}${'─'.repeat(headerPad)}${ANSI.reset}${statusText}${ANSI.cyan}─┐${ANSI.reset}\n`
  
  // Content area height
  const hasNavBar = sessionViewSessions.length > 1
  const contentHeight = termHeight - (hasNavBar ? 5 : 4)
  
  // Handle special states
  if (sessionViewConnecting) {
    output += renderSessionViewMessage('Connecting...', contentHeight)
  } else if (sessionViewError) {
    output += renderSessionViewMessage(`Error: ${sessionViewError}`, contentHeight, ANSI.red)
  } else if (sessionViewConfirmAbort) {
    output += renderSessionViewConfirmAbort(contentHeight)
  } else if (sessionViewInputMode) {
    output += renderSessionViewInput(contentHeight)
  } else if (sessionViewPendingPermissions.size > 0) {
    output += renderSessionViewWithPermissions(contentHeight)
  } else {
    output += renderSessionViewContent(contentHeight)
  }
  
  // Session navigation bar (if multiple sessions)
  if (hasNavBar) {
    output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`
    let navContent = '  '
    for (let i = 0; i < sessionViewSessions.length; i++) {
      const sess = sessionViewSessions[i]
      const isCurrent = i === sessionViewSessionIndex
      const sessStatus = String(sess.status || 'idle')
      const sessStatusColor = statusColors[sessStatus] || ANSI.gray
      const sessIcon = statusIcons[sessStatus] || '◌'
      const depth = sess.depth || 0
      const indent = depth > 0 ? '└' : ''
      const label = truncate(sess.title || sess.id?.slice(-4) || '?', 15)
      
      if (isCurrent) {
        navContent += `${ANSI.inverse}${indent}${sessStatusColor}${sessIcon}${ANSI.reset}${ANSI.inverse} ${label}${ANSI.reset} `
      } else {
        navContent += `${indent}${sessStatusColor}${sessIcon}${ANSI.reset} ${ANSI.dim}${label}${ANSI.reset} `
      }
    }
    const navPad = Math.max(0, termWidth - navContent.replace(/\x1b\[[0-9;]*m/g, '').length - 2)
    output += `${ANSI.cyan}│${ANSI.reset}${navContent}${' '.repeat(navPad)}${ANSI.cyan}│${ANSI.reset}\n`
  }
  
  // Footer
  output += `${ANSI.cyan}└${'─'.repeat(termWidth - 2)}┘${ANSI.reset}\n`
  
  // Help line
  let helpText = `${ANSI.dim}  [Esc] back  [↑↓] scroll`
  if (hasNavBar) {
    helpText += `  [Ctrl+←/→] switch session`
  }
  if (sessionViewStatus === 'busy' || sessionViewStatus === 'running' || sessionViewStatus === 'pending') {
    helpText += `  [a]bort`
  }
  if (sessionViewPendingPermissions.size > 0) {
    helpText += `  [p]ermissions`
  }
  helpText += `  [m]essage${ANSI.reset}`
  output += helpText
  
  return output
}

// ---------------------------------------------------------------------------
// Grouped View
// ---------------------------------------------------------------------------

function renderGrouped(): string {
  const counts = countByStatus()
  const groups = getGroupedInstances()
  const total = instances.size
  
  // Reset selectable items
  const newSelectableItems: SelectableItem[] = []
  
  // Build output
  let output = ''
  
  // Increment spinner
  setSpinnerFrame((spinnerFrame + 1) % SPINNER.length)

  // Title color changes when any session is busy
  const isAnyBusy = counts.busy > 0
  const titleColor = isAnyBusy ? ANSI.yellow : ANSI.white
  
  // Header
  const title = ' oc-session-manager '
  const headerPad = Math.max(0, termWidth - title.length - 2)
  output += `${ANSI.cyan}┌${ANSI.bold}${titleColor}${title}${ANSI.reset}${ANSI.cyan}${'─'.repeat(headerPad)}┐${ANSI.reset}\n`

  // Summary line
  const idleStr = `${ANSI.green}● IDLE (${counts.idle})${ANSI.reset}`
  const busyStr = `${ANSI.yellow}○ BUSY (${counts.busy})${ANSI.reset}`
  const staleStr = `${ANSI.gray}◌ STALE (${counts.stale})${ANSI.reset}`
  const totalStr = `Total: ${total}`
  
  const summaryContent = `  ${idleStr}    ${busyStr}    ${staleStr}     ${totalStr}  `
  const visibleSummary = `  ● IDLE (${counts.idle})    ○ BUSY (${counts.busy})    ◌ STALE (${counts.stale})     Total: ${total}  `
  const summaryPad = Math.max(0, termWidth - visibleSummary.length - 2)
  output += `${ANSI.cyan}│${ANSI.reset}${summaryContent}${' '.repeat(summaryPad)}${ANSI.cyan}│${ANSI.reset}\n`

  // Separator
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`

  // Calculate available rows
  const maxRows = termHeight - 7
  let rowCount = 0

  if (groups.length === 0) {
    const emptyMsg = '  No OpenCode instances detected'
    output += renderRow(`${ANSI.dim}${emptyMsg}${ANSI.reset}`, emptyMsg.length)
    rowCount++
  }

  for (const [groupKey, groupInstances] of groups) {
    if (rowCount >= maxRows) break
    
    const isCollapsed = collapsedGroups.has(groupKey)
    const stats = getGroupStats(groupInstances)
    const isGroupSelected = selectedIndex === newSelectableItems.length
    
    // Group header row
    const expandIcon = isCollapsed ? '▶' : '▼'
    const [dirName, branch] = groupKey.split(':')
    
    // Build status summary for group
    let statusSummary = ''
    if (stats.idle > 0) statusSummary += `${ANSI.green}●${stats.idle}${ANSI.reset} `
    if (stats.busy > 0) statusSummary += `${ANSI.yellow}○${stats.busy}${ANSI.reset} `
    if (stats.stale > 0) statusSummary += `${ANSI.gray}◌${stats.stale}${ANSI.reset} `
    
    const costStr = stats.cost > 0 ? `${ANSI.dim}${formatCost(stats.cost)}${ANSI.reset}` : ''
    const tokStr = stats.tokens > 0 ? `${ANSI.dim}${formatTokens(stats.tokens)}${ANSI.reset}` : ''
    
    const groupHeader = ` ${expandIcon} ${ANSI.bold}${dirName}${ANSI.reset}${ANSI.cyan}:${branch}${ANSI.reset}  ${statusSummary} ${costStr} ${tokStr}`
    const visibleHeader = ` ${expandIcon} ${dirName}:${branch}  ${stats.idle > 0 ? `●${stats.idle} ` : ''}${stats.busy > 0 ? `○${stats.busy} ` : ''}${stats.stale > 0 ? `◌${stats.stale} ` : ''} ${formatCost(stats.cost)} ${formatTokens(stats.tokens)}`
    
    newSelectableItems.push({ type: 'group', key: groupKey, index: newSelectableItems.length })
    output += renderRow(groupHeader, visibleHeader.length, isGroupSelected)
    rowCount++
    
    // Instance rows (if not collapsed)
    if (!isCollapsed) {
      const tree = buildInstanceTree(groupInstances)
      
      const renderNode = (node: Instance, depth = 0, isLast = true, prefix = '') => {
        if (rowCount >= maxRows) return
        
        const status = getEffectiveStatus(node)
        const isSelected = selectedIndex === newSelectableItems.length
        const longRunning = isLongRunning(node)
        
        // Status indicator (animated spinner for busy)
        let statusIcon: string, statusColor: string
        switch (status) {
          case 'idle':
            statusIcon = '●'
            statusColor = ANSI.green
            break
          case 'busy':
            statusIcon = longRunning ? '!' : SPINNER[spinnerFrame]
            statusColor = longRunning ? ANSI.red : ANSI.yellow
            break
          /* v8 ignore start - fallback case */
          default:
            statusIcon = '◌'
            statusColor = ANSI.gray
          /* v8 ignore stop */
        }

        // Short session ID
        const shortSession = node.sessionID?.slice(-4) ?? '----'
        
        // Title
        const nodeTitle = node.title ?? (status === 'idle' ? 'Ready for input' : 'Working...')
        
        // Cost and tokens
        const nodeCostStr = formatCost(node.cost)
        const nodeTokStr = formatTokens(node.tokens?.total)
        const statsStr = [nodeCostStr, nodeTokStr].filter(Boolean).join(' ')
        
        // Time or busy duration
        let timeStr: string
        if (status === 'busy') {
          const duration = getBusyDuration(node)
          timeStr = formatDuration(duration)
        } else {
          timeStr = formatRelativeTime(node.ts)
        }

        // Tree structure prefix
        let treePrefix = ''
        if (depth > 0) {
          treePrefix = prefix + (isLast ? '└─ ' : '├─ ')
        }
        
        // Visual indentation for tree
        const indent = '   ' + treePrefix

        // Calculate available space
        const fixedWidth = indent.length + 2 + 4 + 2 + statsStr.length + 2 + timeStr.length + 2
        const availableForTitle = Math.max(10, termWidth - fixedWidth - 4)
        const truncatedTitle = truncate(nodeTitle, availableForTitle)

        // Build row
        const selStart = isSelected ? ANSI.inverse : ''
        const selEnd = isSelected ? ANSI.reset : ''
        
        const rowContent = `${selStart}${indent}${statusColor}${statusIcon}${ANSI.reset}${selStart} ${shortSession}  ${ANSI.dim}"${truncatedTitle}"${ANSI.reset}${selStart}`
        const statsContent = statsStr ? `${ANSI.magenta}${statsStr}${ANSI.reset}${selStart}  ` : ''
        const timeContent = `${ANSI.dim}${timeStr.padStart(8)}${ANSI.reset}${selStart} ${selEnd}`
        
        const visibleRow = `${indent}${statusIcon} ${shortSession}  "${truncatedTitle}"`
        const visibleStats = statsStr ? `${statsStr}  ` : ''
        const visibleTime = `${timeStr.padStart(8)} `
        const rowPad = Math.max(0, termWidth - visibleRow.length - visibleStats.length - visibleTime.length - 2)

        newSelectableItems.push({ type: 'instance', instanceId: node.instanceId, index: newSelectableItems.length })
        output += `${ANSI.cyan}│${ANSI.reset}${rowContent}${' '.repeat(rowPad)}${statsContent}${timeContent}${ANSI.cyan}│${ANSI.reset}\n`
        rowCount++
        
        // Render children
        if (node.children && node.children.length > 0) {
          const childPrefix = prefix + (isLast ? '   ' : '│  ')
          node.children.forEach((child, idx) => {
            renderNode(child, depth + 1, idx === node.children!.length - 1, childPrefix)
          })
        }
      }
      
      tree.forEach((root, idx) => {
        renderNode(root, 0, idx === tree.length - 1, '')
      })
    }
  }

  // Footer
  output += `${ANSI.cyan}└${'─'.repeat(termWidth - 2)}┘${ANSI.reset}\n`

  // Help line
  output += `${ANSI.dim}  q: quit  ↑↓/jk: nav  Enter: watch  i: info  a: abort  d: remove  c: clear stale  Tab: flat${ANSI.reset}`

  setSelectableItems(newSelectableItems)
  return output
}

// ---------------------------------------------------------------------------
// Flat View
// ---------------------------------------------------------------------------

function renderFlat(): string {
  const counts = countByStatus()
  const sorted = getSortedInstances()
  const total = sorted.length
  
  // Reset selectable items
  const newSelectableItems: SelectableItem[] = []
  
  // Build output
  let output = ''
  
  // Increment spinner
  setSpinnerFrame((spinnerFrame + 1) % SPINNER.length)

  // Title color changes when any session is busy
  const isAnyBusy = counts.busy > 0
  const titleColor = isAnyBusy ? ANSI.yellow : ANSI.white
  
  // Header
  const title = ' oc-session-manager (flat) '
  const headerPad = Math.max(0, termWidth - title.length - 2)
  output += `${ANSI.cyan}┌${ANSI.bold}${titleColor}${title}${ANSI.reset}${ANSI.cyan}${'─'.repeat(headerPad)}┐${ANSI.reset}\n`

  // Summary line
  const idleStr = `${ANSI.green}● IDLE (${counts.idle})${ANSI.reset}`
  const busyStr = `${ANSI.yellow}○ BUSY (${counts.busy})${ANSI.reset}`
  const staleStr = `${ANSI.gray}◌ STALE (${counts.stale})${ANSI.reset}`
  const totalStr = `Total: ${total}`
  
  const summaryContent = `  ${idleStr}    ${busyStr}    ${staleStr}     ${totalStr}  `
  const visibleSummary = `  ● IDLE (${counts.idle})    ○ BUSY (${counts.busy})    ◌ STALE (${counts.stale})     Total: ${total}  `
  const summaryPad = Math.max(0, termWidth - visibleSummary.length - 2)
  output += `${ANSI.cyan}│${ANSI.reset}${summaryContent}${' '.repeat(summaryPad)}${ANSI.cyan}│${ANSI.reset}\n`

  // Separator
  output += `${ANSI.cyan}├${'─'.repeat(termWidth - 2)}┤${ANSI.reset}\n`

  // Instance rows
  const maxRows = termHeight - 7
  const displayInstances = sorted.slice(0, maxRows)

  if (displayInstances.length === 0) {
    const emptyMsg = '  No OpenCode instances detected'
    output += renderRow(`${ANSI.dim}${emptyMsg}${ANSI.reset}`, emptyMsg.length)
  }

  for (let i = 0; i < displayInstances.length; i++) {
    const inst = displayInstances[i]
    const status = getEffectiveStatus(inst)
    const isSelected = selectedIndex === newSelectableItems.length
    const longRunning = isLongRunning(inst)
    
    // Status indicator
    let statusIcon: string, statusColor: string
    switch (status) {
      case 'idle':
        statusIcon = '●'
        statusColor = ANSI.green
        break
      case 'busy':
        statusIcon = longRunning ? '!' : SPINNER[spinnerFrame]
        statusColor = longRunning ? ANSI.red : ANSI.yellow
        break
      default:
        statusIcon = '◌'
        statusColor = ANSI.gray
    }

    // Build instance identifier
    const shortSession = inst.sessionID?.slice(-4) ?? '----'
    const identifier = `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${shortSession}`
    
    // Title
    const instTitle = inst.title ?? (status === 'idle' ? 'Ready for input' : 'Working...')
    
    // Cost and tokens
    const costStr = formatCost(inst.cost)
    const tokStr = formatTokens(inst.tokens?.total)
    const statsStr = [costStr, tokStr].filter(Boolean).join(' ')
    
    // Time
    let timeStr: string
    if (status === 'busy') {
      timeStr = formatDuration(getBusyDuration(inst))
    } else {
      timeStr = formatRelativeTime(inst.ts)
    }

    // Calculate available space
    const fixedWidth = 3 + 24 + 2 + statsStr.length + 2 + timeStr.length + 2
    const availableForTitle = Math.max(10, termWidth - fixedWidth - 4)
    const truncatedIdent = truncate(identifier, 24)
    const truncatedTitle = truncate(instTitle, availableForTitle)

    // Build row
    const selStart = isSelected ? ANSI.inverse : ''
    const selEnd = isSelected ? ANSI.reset : ''
    
    const rowContent = `${selStart} ${statusColor}${statusIcon}${ANSI.reset}${selStart}  ${truncatedIdent.padEnd(24)}  ${ANSI.dim}"${truncatedTitle}"${ANSI.reset}${selStart}`
    const statsContent = statsStr ? `${ANSI.magenta}${statsStr}${ANSI.reset}${selStart}  ` : ''
    const timeContent = `${ANSI.dim}${timeStr.padStart(8)}${ANSI.reset}${selStart} ${selEnd}`
    
    const visibleRow = ` ${statusIcon}  ${truncatedIdent.padEnd(24)}  "${truncatedTitle}"`
    const visibleStats = statsStr ? `${statsStr}  ` : ''
    const visibleTime = `${timeStr.padStart(8)} `
    const rowPad = Math.max(0, termWidth - visibleRow.length - visibleStats.length - visibleTime.length - 2)

    newSelectableItems.push({ type: 'instance', instanceId: inst.instanceId, index: newSelectableItems.length })
    output += `${ANSI.cyan}│${ANSI.reset}${rowContent}${' '.repeat(rowPad)}${statsContent}${timeContent}${ANSI.cyan}│${ANSI.reset}\n`
  }

  // Truncation notice
  if (sorted.length > maxRows) {
    const moreMsg = `  ... and ${sorted.length - maxRows} more instances`
    output += renderRow(`${ANSI.dim}${moreMsg}${ANSI.reset}`, moreMsg.length)
  }

  // Footer
  output += `${ANSI.cyan}└${'─'.repeat(termWidth - 2)}┘${ANSI.reset}\n`

  // Help line
  output += `${ANSI.dim}  q: quit  ↑↓/jk: nav  Enter: watch  i: info  a: abort  d: remove  c: clear stale  Tab: grouped${ANSI.reset}`

  setSelectableItems(newSelectableItems)
  return output
}

// ---------------------------------------------------------------------------
// Main Render Function
// ---------------------------------------------------------------------------

export function render(): void {
  let output = ANSI.clearScreen + ANSI.cursorHome
  
  if (sessionViewActive) {
    output += renderSessionView()
  } else if (detailView) {
    const inst = instances.get(detailView)
    if (inst) {
      output += renderDetailView(inst)
    } else {
      setDetailView(null)
      output += viewMode === 'grouped' ? renderGrouped() : renderFlat()
    }
  } else {
    output += viewMode === 'grouped' ? renderGrouped() : renderFlat()
  }
  
  process.stdout.write(output)
}
