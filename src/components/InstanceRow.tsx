// Single instance row component

import React, { useContext } from 'react'
import { Text } from 'ink'
import { useTime, useStatusHelpers } from './AppContext.js'
import { SpinnerContext } from './App.js'
import type { Instance } from '../types.js'

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface InstanceRowProps {
  instance: Instance
  isSelected: boolean
  indent?: number
  showProject?: boolean
}

export const InstanceRow = React.memo(({ 
  instance, 
  isSelected, 
  indent = 0,
  showProject = false 
}: InstanceRowProps): React.ReactElement => {
  const currentTime = useTime()
  const { getEffectiveStatus, isLongRunning, getBusyDuration } = useStatusHelpers()
  const spinnerFrame = useContext(SpinnerContext)
  
  const status = getEffectiveStatus(instance)
  const longRunning = isLongRunning(instance)
  const busyDuration = getBusyDuration(instance)
  
  // Status indicator
  let statusIcon: string
  let statusColor: 'green' | 'yellow' | 'red' | 'gray'
  
  switch (status) {
    case 'idle':
      statusIcon = '●'
      statusColor = 'green'
      break
    case 'busy':
      statusIcon = longRunning ? '!' : SPINNER_CHARS[spinnerFrame % SPINNER_CHARS.length]
      statusColor = longRunning ? 'red' : 'yellow'
      break
    default:
      statusIcon = '◌'
      statusColor = 'gray'
  }
  
  const shortSession = instance.sessionID?.slice(-4) ?? '----'
  const title = instance.title ?? (status === 'idle' ? 'Ready for input' : 'Working...')
  const truncatedTitle = title.length > 40 ? title.slice(0, 37) + '...' : title
  const costStr = formatCost(instance.cost)
  const tokStr = formatTokens(instance.tokens?.total)
  
  const timeStr = status === 'busy' 
    ? formatDuration(busyDuration)
    : formatRelativeTime(instance.ts, currentTime)
  
  const prefix = showProject 
    ? `${instance.dirName || '?'}:${instance.branch || '?'}:` 
    : ''

  return (
    <Text inverse={isSelected}>
      {' '.repeat(indent)}
      <Text color={statusColor}>{statusIcon}</Text>
      {' '}{prefix}{shortSession}{'  '}
      <Text dimColor>"{truncatedTitle}"</Text>
      {costStr && <Text color="magenta">  {costStr}</Text>}
      {tokStr && <Text color="magenta"> {tokStr}</Text>}
      <Text dimColor>  {timeStr.padStart(8)}</Text>
    </Text>
  )
})

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
  const hours = Math.floor(ms / 3600000); const mins = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${mins}m`
}
