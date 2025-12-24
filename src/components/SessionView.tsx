// Session viewer component - shows messages from a session (full screen)

import React from 'react'
import { Box, Text, Spacer } from 'ink'
import { useAppState, useViewState } from './AppContext.js'

export const SessionView = React.memo((): React.ReactElement => {
  const { sessionViewInstance, sessionViewSessionID, sessionViewStatus, sessionViewSessions, sessionViewSessionIndex, sessionViewSessionTitle, sessionViewConnecting, sessionViewError, sessionViewConfirmAbort, sessionViewInputMode, sessionViewPendingPermissions, sessionViewRenderedLines, terminalSize } = useViewState()
  
  const width = terminalSize.columns
  const inst = sessionViewInstance
  const identifier = inst 
    ? `${inst.dirName ?? '?'}:${inst.branch ?? '?'}:${sessionViewSessionID?.slice(-4) ?? '----'}`
    : 'Unknown'
  
  const status = sessionViewStatus || 'idle'
  const statusColors: Record<string, 'green' | 'yellow' | 'gray'> = { 
    idle: 'green', busy: 'yellow', running: 'yellow', pending: 'yellow' 
  }
  const statusIcons: Record<string, string> = { 
    idle: '●', busy: '○', running: '○', pending: '○' 
  }
  
  const statusColor = statusColors[status] || 'gray'
  const statusIcon = statusIcons[status] || '◌'
  const hasMultipleSessions = sessionViewSessions.length > 1
  const navIndicator = hasMultipleSessions ? ` [${sessionViewSessionIndex + 1}/${sessionViewSessions.length}]` : ''

  return (
    <Box 
      flexDirection="column" 
      paddingX={1}
      flexGrow={1}
    >
      {/* Header */}
      <Box justifyContent="space-between" borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} marginBottom={1}>
        <Box>
          <Text bold color="cyan">{identifier}</Text>
          {sessionViewSessionTitle ? (
            <Text dimColor> "{truncate(sessionViewSessionTitle, width > 100 ? 60 : 30)}"</Text>
          ) : null}
          <Text color="yellow">{navIndicator}</Text>
        </Box>
        <Text color={statusColor}>{statusIcon} {status.toUpperCase()}</Text>
      </Box>
      
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
          {/* Main Area */}
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {sessionViewConnecting ? (
              <CenteredMessage message="Connecting..." />
            ) : sessionViewError ? (
              <CenteredMessage message={`Error: ${sessionViewError}`} color="red" />
            ) : sessionViewConfirmAbort ? (
              <ConfirmAbort />
            ) : sessionViewInputMode ? (
              <InputMode />
            ) : sessionViewPendingPermissions.size > 0 ? (
              <PermissionPrompt />
            ) : (
              <MessageContent />
            )}
          </Box>

          {/* Right Sidebar (only if wide) - shows session list or instance details */}
          {width > 150 && inst ? (
              <Box width={40} borderStyle="single" borderLeft borderTop={false} borderBottom={false} borderRight={false} paddingLeft={1} flexDirection="column">
                  <Text bold dimColor underline>SESSION INFO</Text>
                  <Text>Model: {inst.model || '?'}</Text>
                  <Text>Cost: ${inst.cost?.toFixed(4) || '0'}</Text>
                  <Text>Tokens: {inst.tokens?.total || 0}</Text>
                  <Spacer />
                  {hasMultipleSessions ? (
                      <Box flexDirection="column">
                          <Text bold dimColor underline>OTHER SESSIONS</Text>
                          {sessionViewSessions.slice(0, 10).map((sess, idx) => (
                              <Box key={sess.id}>
                                  <Text color={idx === sessionViewSessionIndex ? "cyan" : undefined}>
                                    {idx === sessionViewSessionIndex ? "➔ " : "  "}{truncate(sess.title || sess.id?.slice(0, 8), 30)}
                                  </Text>
                              </Box>
                          ))}
                      </Box>
                  ) : null}
              </Box>
          ) : null}
      </Box>
      
      {/* Session navigation bar (Horizontal if wide, original if not) */}
      {hasMultipleSessions && width <= 150 ? (
        <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          {sessionViewSessions.map((sess: any, idx: number) => {
            const isCurrent = idx === sessionViewSessionIndex
            const sessStatus = String(sess.status || 'idle')
            const sessColor = statusColors[sessStatus] || 'gray'
            const sessIcon = statusIcons[sessStatus] || '◌'
            const label = truncate(sess.title || sess.id?.slice(-4) || '?', 15)
            
            return (
              <Box key={sess.id || `session-${idx}`} marginRight={1}>
                <Text inverse={isCurrent} color={sessColor}>{sessIcon} {label}</Text>
              </Box>
            )
          })}
        </Box>
      ) : null}
      
      {/* Help bar at bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} marginTop={1}>
        <Text dimColor>
          <Text>[Esc] back  [↑↓] scroll</Text>
          {hasMultipleSessions ? <Text>  [Ctrl+←/→] switch session</Text> : null}
          {(status === 'busy' || status === 'running' || status === 'pending') ? <Text>  [a]bort</Text> : null}
          {sessionViewPendingPermissions.size > 0 ? <Text>  [p]ermissions</Text> : null}
          <Text>  [m]essage</Text>
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
      <Text color="yellow" bold>ABORT THIS SESSION?</Text>
      <Text dimColor>[y]es  [n]o</Text>
    </Box>
  )
}

function InputMode(): React.ReactElement {
  const { sessionViewInputBuffer } = useViewState()
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} overflow="hidden"><MessageContent /></Box>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingY={1}>
        <Text color="green" bold>&gt; </Text>
        <Text>{sessionViewInputBuffer}</Text>
        <Text backgroundColor="white" color="black"> </Text>
      </Box>
      <Box><Text dimColor>[Enter] send  [Esc] cancel</Text></Box>
    </Box>
  )
}

function PermissionPrompt(): React.ReactElement {
  const { sessionViewPendingPermissions } = useViewState()
  const entries = Array.from(sessionViewPendingPermissions.entries())
  const [permId, perm] = entries[0] || []
  if (!perm) return <MessageContent />
  
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} overflow="hidden"><MessageContent /></Box>
      <Box flexDirection="column" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingY={1}>
        <Text color="yellow" bold>PERMISSION REQUEST</Text>
        <Text>Tool: <Text color="cyan">{perm.tool || 'unknown'}</Text></Text>
        {perm.args ? <Text dimColor>{truncate(formatArgs(perm.args), 80)}</Text> : null}
        <Box marginTop={1}>
            <Text dimColor>[a]llow  [A]llow always  [d]eny  [D]eny always  [Esc] dismiss</Text>
        </Box>
      </Box>
    </Box>
  )
}

function MessageContent(): React.ReactElement {
  const { sessionViewRenderedLines } = useViewState()
  if (sessionViewRenderedLines.length === 0) return <CenteredMessage message="No messages yet" />
  return (
    <Box flexDirection="column" overflow="hidden">
      {sessionViewRenderedLines.map((line, idx) => (
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
