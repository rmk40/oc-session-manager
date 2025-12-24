// Session viewer component - shows messages from a session (full screen)

import React from 'react'
import { Box, Text, Spacer } from 'ink'
import { useAppState } from './AppContext.js'

export const SessionView = React.memo((): React.ReactElement => {
  const state = useAppState()
  
  const inst = state.sessionViewInstance
  const identifier = inst 
    ? `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${state.sessionViewSessionID?.slice(-4) ?? '----'}`
    : 'Unknown'
  
  const status = state.sessionViewStatus || 'idle'
  const statusColors: Record<string, 'green' | 'yellow' | 'gray'> = { 
    idle: 'green', busy: 'yellow', running: 'yellow', pending: 'yellow' 
  }
  const statusIcons: Record<string, string> = { 
    idle: '●', busy: '○', running: '○', pending: '○' 
  }
  
  const statusColor = statusColors[status] || 'gray'
  const statusIcon = statusIcons[status] || '◌'
  const hasMultipleSessions = state.sessionViewSessions.length > 1
  const navIndicator = hasMultipleSessions ? ` [${state.sessionViewSessionIndex + 1}/${state.sessionViewSessions.length}]` : ''

  return (
    <Box 
      flexDirection="column" 
      paddingX={1}
      flexGrow={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold>{identifier}</Text>
          {state.sessionViewSessionTitle && (
            <Text dimColor> "{truncate(state.sessionViewSessionTitle, 30)}"</Text>
          )}
          <Text>{navIndicator}</Text>
        </Box>
        <Text color={statusColor}>{statusIcon} {status.toUpperCase()}</Text>
      </Box>
      
      {/* Content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
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
          <MessageContent />
        )}
      </Box>
      
      {/* Session navigation bar */}
      {hasMultipleSessions && (
        <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          {state.sessionViewSessions.map((sess: any, idx: number) => {
            const isCurrent = idx === state.sessionViewSessionIndex
            const sessStatus = String(sess.status || 'idle')
            const sessColor = statusColors[sessStatus] || 'gray'
            const sessIcon = statusIcons[sessStatus] || '◌'
            const label = truncate(sess.title || sess.id?.slice(-4) || '?', 15)
            
            return (
              <Box key={sess.id || `session-${idx}`} marginRight={1}>
                <Text inverse={isCurrent} color={sessColor}>{sessIcon}</Text>
                <Text inverse={isCurrent}> {label}</Text>
              </Box>
            )
          })}
        </Box>
      )}
      
      {/* Help bar at bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>
          [Esc] back  [↑↓] scroll
          {hasMultipleSessions && '  [Ctrl+←/→] switch session'}
          {(status === 'busy' || status === 'running' || status === 'pending') && '  [a]bort'}
          {state.sessionViewPendingPermissions.size > 0 && '  [p]ermissions'}
          {'  [m]essage'}
        </Text>
      </Box>
    </Box>
  )
})

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
      <Text dimColor>[y]es  [n]o</Text>
    </Box>
  )
}

function InputMode(): React.ReactElement {
  const state = useAppState()
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} overflow="hidden"><MessageContent /></Box>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color="green">&gt; </Text>
        <Text>{state.sessionViewInputBuffer}</Text>
        <Text>▌</Text>
      </Box>
      <Box><Text dimColor>[Enter] send  [Esc] cancel</Text></Box>
    </Box>
  )
}

function PermissionPrompt(): React.ReactElement {
  const state = useAppState()
  const entries = Array.from(state.sessionViewPendingPermissions.entries())
  const [permId, perm] = entries[0] || []
  if (!perm) return <MessageContent />
  
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} overflow="hidden"><MessageContent /></Box>
      <Box flexDirection="column" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color="yellow">Permission Request</Text>
        <Text>Tool: {perm.tool || 'unknown'}</Text>
        {perm.args && <Text dimColor>{truncate(formatArgs(perm.args), 60)}</Text>}
        <Text dimColor>[a]llow  [A]llow always  [d]eny  [D]eny always  [Esc] dismiss</Text>
      </Box>
    </Box>
  )
}

function MessageContent(): React.ReactElement {
  const state = useAppState()
  if (state.sessionViewRenderedLines.length === 0) return <CenteredMessage message="No messages yet" />
  return (
    <Box flexDirection="column" overflow="hidden">
      {state.sessionViewRenderedLines.map((line, idx) => (
        <Text key={`line-${idx}`}>{line.text || line.plain}</Text>
      ))}
    </Box>
  )
}

function truncate(str: string, maxLen: number): string {
  if (!str) return ''; if (str.length <= maxLen) return str; return str.slice(0, maxLen - 3) + '...'
}

function formatArgs(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    let valueStr: string
    if (typeof value === 'string') valueStr = truncate(value, 50)
    else if (typeof value === 'object') valueStr = '[object]'
    else valueStr = String(value)
    parts.push(`${key}: ${valueStr}`)
  }
  return parts.join(', ')
}
