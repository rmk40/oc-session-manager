// Session viewer component - shows messages from a session

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useApp } from './AppContext.js'

export function SessionView(): React.ReactElement {
  const { state, actions } = useApp()
  const { stdout } = useStdout()
  
  const inst = state.sessionViewInstance
  const identifier = inst 
    ? `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${state.sessionViewSessionID?.slice(-4) ?? '----'}`
    : 'Unknown'
  
  // Status indicator
  const status = state.sessionViewStatus || 'idle'
  const statusColors: Record<string, 'green' | 'yellow' | 'gray'> = { 
    idle: 'green', 
    busy: 'yellow', 
    running: 'yellow', 
    pending: 'yellow' 
  }
  const statusIcons: Record<string, string> = { 
    idle: '●', 
    busy: '○', 
    running: '○', 
    pending: '○' 
  }
  
  const statusColor = statusColors[status] || 'gray'
  const statusIcon = statusIcons[status] || '◌'
  
  // Session navigation
  const hasMultipleSessions = state.sessionViewSessions.length > 1
  const navIndicator = hasMultipleSessions 
    ? ` [${state.sessionViewSessionIndex + 1}/${state.sessionViewSessions.length}]`
    : ''
  
  // Calculate content height
  const termHeight = stdout?.rows || 24
  const contentHeight = termHeight - 6

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold>{identifier}</Text>
          {state.sessionViewSessionTitle && (
            <Text color="gray"> "{truncate(state.sessionViewSessionTitle, 30)}"</Text>
          )}
          <Text>{navIndicator}</Text>
        </Box>
        <Text color={statusColor}>{statusIcon} {status.toUpperCase()}</Text>
      </Box>
      
      {/* Content */}
      <Box flexDirection="column" paddingX={1} height={contentHeight}>
        {state.sessionViewConnecting ? (
          <CenteredMessage message="Connecting..." />
        ) : state.sessionViewError ? (
          <CenteredMessage message={`Error: ${state.sessionViewError}`} color="red" />
        ) : state.sessionViewConfirmAbort ? (
          <ConfirmAbort />
        ) : state.sessionViewInputMode ? (
          <InputMode />
        ) : state.sessionViewPendingPermissions.size > 0 ? (
          <PermissionPrompt />
        ) : (
          <MessageContent height={contentHeight} />
        )}
      </Box>
      
      {/* Session navigation bar */}
      {hasMultipleSessions && (
        <Box paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          {state.sessionViewSessions.map((sess: any, idx: number) => {
            const isCurrent = idx === state.sessionViewSessionIndex
            const sessStatus = String(sess.status || 'idle')
            const sessColor = statusColors[sessStatus] || 'gray'
            const sessIcon = statusIcons[sessStatus] || '◌'
            const label = truncate(sess.title || sess.id?.slice(-4) || '?', 15)
            
            return (
              <Box key={sess.id} marginRight={1}>
                <Text inverse={isCurrent} color={sessColor}>{sessIcon}</Text>
                <Text inverse={isCurrent}> {label}</Text>
              </Box>
            )
          })}
        </Box>
      )}
      
      {/* Help bar */}
      <Box paddingX={1}>
        <Text color="gray">
          [Esc] back  [↑↓] scroll
          {hasMultipleSessions && '  [Ctrl+←/→] switch session'}
          {(status === 'busy' || status === 'running' || status === 'pending') && '  [a]bort'}
          {state.sessionViewPendingPermissions.size > 0 && '  [p]ermissions'}
          {'  [m]essage'}
        </Text>
      </Box>
    </Box>
  )
}

function CenteredMessage({ message, color }: { message: string; color?: string }): React.ReactElement {
  return (
    <Box justifyContent="center" alignItems="center" flexGrow={1}>
      <Text color={color as any}>{message}</Text>
    </Box>
  )
}

function ConfirmAbort(): React.ReactElement {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
      <Text color="yellow">Abort this session?</Text>
      <Text color="gray">[y]es  [n]o</Text>
    </Box>
  )
}

function InputMode(): React.ReactElement {
  const { state } = useApp()
  
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>
        <MessageContent height={-1} />
      </Box>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text color="green">&gt; </Text>
        <Text>{state.sessionViewInputBuffer}</Text>
        <Text>▌</Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray">[Enter] send  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}

function PermissionPrompt(): React.ReactElement {
  const { state } = useApp()
  
  // Get first pending permission
  const [permId, perm] = state.sessionViewPendingPermissions.entries().next().value || []
  
  if (!perm) {
    return <MessageContent height={-1} />
  }
  
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>
        <MessageContent height={-1} />
      </Box>
      <Box flexDirection="column" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text color="yellow">Permission Request</Text>
        <Text>Tool: {perm.tool || 'unknown'}</Text>
        {perm.args && (
          <Text color="gray">{truncate(formatArgs(perm.args), 60)}</Text>
        )}
        <Text color="gray">[a]llow  [A]llow always  [d]eny  [D]eny always  [Esc] dismiss</Text>
      </Box>
    </Box>
  )
}

function MessageContent({ height }: { height: number }): React.ReactElement {
  const { state } = useApp()
  
  if (state.sessionViewRenderedLines.length === 0) {
    return <CenteredMessage message="No messages yet" />
  }
  
  // Simple display of rendered lines with scrolling
  const lines = state.sessionViewRenderedLines
  const visibleHeight = height > 0 ? height : lines.length
  
  const totalLines = lines.length
  const startLine = Math.max(0, totalLines - visibleHeight - state.sessionViewScrollOffset)
  const endLine = Math.min(totalLines, startLine + visibleHeight)
  
  const visibleLines = lines.slice(startLine, endLine)
  
  return (
    <Box flexDirection="column">
      {visibleLines.map((line, idx) => (
        <Text key={startLine + idx}>{line.text || line.plain}</Text>
      ))}
    </Box>
  )
}

function truncate(str: string, maxLen: number): string {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

function formatArgs(args: Record<string, unknown>): string {
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
