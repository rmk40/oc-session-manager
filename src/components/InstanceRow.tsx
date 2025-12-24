// Single instance row component

import React from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'
import type { Instance } from '../types.js'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface InstanceRowProps {
  instance: Instance
  isSelected: boolean
  spinnerFrame: number
  indent?: number
  showProject?: boolean
}

export function InstanceRow({ 
  instance, 
  isSelected, 
  spinnerFrame, 
  indent = 0,
  showProject = false 
}: InstanceRowProps): React.ReactElement {
  const { actions } = useApp()
  
  const status = actions.getEffectiveStatus(instance)
  const longRunning = actions.isLongRunning(instance)
  const busyDuration = actions.getBusyDuration(instance)
  
  // Status indicator
  let statusIcon: string
  let statusColor: 'green' | 'yellow' | 'red' | 'gray'
  
  switch (status) {
    case 'idle':
      statusIcon = '●'
      statusColor = 'green'
      break
    case 'busy':
      statusIcon = longRunning ? '!' : SPINNER[spinnerFrame]
      statusColor = longRunning ? 'red' : 'yellow'
      break
    default:
      statusIcon = '◌'
      statusColor = 'gray'
  }
  
  // Short session ID
  const shortSession = instance.sessionID?.slice(-4) ?? '----'
  
  // Title
  const title = instance.title ?? (status === 'idle' ? 'Ready for input' : 'Working...')
  const truncatedTitle = title.length > 40 ? title.slice(0, 37) + '...' : title
  
  // Cost and tokens
  const costStr = formatCost(instance.cost)
  const tokStr = formatTokens(instance.tokens?.total)
  
  // Time
  let timeStr: string
  if (status === 'busy') {
    timeStr = formatDuration(busyDuration)
  } else {
    timeStr = formatRelativeTime(instance.ts)
  }
  
  // Project:branch for flat view
  const projectBranch = showProject 
    ? `${instance.dirName || '?'}:${instance.branch || '?'}:` 
    : ''

  return (
    <Box>
      <Text inverse={isSelected}>
        <Text>{' '.repeat(indent)}</Text>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text> {projectBranch}{shortSession}  </Text>
        <Text color="gray">"{truncatedTitle}"</Text>
        {costStr && <Text color="magenta">  {costStr}</Text>}
        {tokStr && <Text color="magenta"> {tokStr}</Text>}
        <Text color="gray">  {timeStr.padStart(8)}</Text>
      </Text>
    </Box>
  )
}

function formatCost(cost: number | undefined): string {
  if (!cost || cost === 0) return ''
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number | undefined): string {
  if (!tokens) return ''
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

function formatRelativeTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  
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
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const hours = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${mins}m`
}
