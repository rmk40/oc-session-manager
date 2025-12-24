// Detail view for a single instance - full screen

import React from 'react'
import { Box, Text, Spacer } from 'ink'
import { useAppState, useStatusHelpers } from './AppContext.js'
import type { Instance } from '../types.js'

interface DetailViewProps {
  instance: Instance
}

export const DetailView = React.memo(({ instance }: DetailViewProps): React.ReactElement => {
  const { currentTime } = useAppState()
  const { getEffectiveStatus, isLongRunning, getBusyDuration } = useStatusHelpers()
  
  const status = getEffectiveStatus(instance)
  const identifier = `${instance.dirName ?? '?'}:${instance.branch ?? '?'}:${instance.sessionID?.slice(-4) ?? '----'}`
  
  const statusColors: Record<string, 'green' | 'yellow' | 'gray'> = { 
    idle: 'green', 
    busy: 'yellow', 
    stale: 'gray' 
  }
  const statusIcons: Record<string, string> = { idle: '●', busy: '○', stale: '◌' }
  
  const tokIn = instance.tokens?.input ?? 0
  const tokOut = instance.tokens?.output ?? 0
  const tokTotal = instance.tokens?.total ?? 0

  return (
    <Box 
      flexDirection="column" 
      paddingX={1}
      flexGrow={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="cyan">{identifier}</Text>
      </Box>
      
      {/* Content area */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Status */}
        <Box marginTop={1}>
          <Text>Status: </Text>
          <Text color={statusColors[status]}>
            {statusIcons[status]} {status.toUpperCase()}
          </Text>
        </Box>
        
        {/* Session info */}
        <Box flexDirection="column" marginTop={1}>
          <Text>Session ID: {instance.sessionID ?? 'N/A'}</Text>
          {instance.parentID && <Text>Parent ID: {instance.parentID}</Text>}
          <Text>Title: {instance.title ?? 'N/A'}</Text>
          <Text>Directory: {instance.directory ?? 'N/A'}</Text>
          <Text>Host: {instance.host ?? 'N/A'}</Text>
        </Box>
        
        {/* Model & Cost */}
        <Box flexDirection="column" marginTop={1}>
          <Text>Model: {instance.model ?? 'N/A'}</Text>
          <Text>Cost: {formatCost(instance.cost) || '$0.00'}</Text>
          <Text>Tokens: {tokTotal.toLocaleString()} total ({tokIn.toLocaleString()} in / {tokOut.toLocaleString()} out)</Text>
        </Box>
        
        {/* Timing */}
        <Box flexDirection="column" marginTop={1}>
          <Text>Last Update: {formatRelativeTime(instance.ts, currentTime)}</Text>
          {instance.busyTime !== undefined && (
            <Text>Total Busy Time: {formatDuration(instance.busyTime)}</Text>
          )}
          {status === 'busy' && (
            <Text color={isLongRunning(instance) ? 'red' : undefined}>
              Busy For: {formatDuration(getBusyDuration(instance))}
              {isLongRunning(instance) && ' LONG RUNNING'}
            </Text>
          )}
        </Box>
        
        <Spacer />
      </Box>
      
      {/* Help bar at bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>Esc/Enter: back  d: remove</Text>
      </Box>
    </Box>
  )
})

function formatCost(cost: number | undefined): string {
  if (!cost || cost === 0) return ''
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatRelativeTime(ts: number, currentTime: number): string {
  const diff = currentTime - ts
  if (diff < 1000) return 'now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000); const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const hours = Math.floor(ms / 33600000); const mins = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${mins}m`
}
