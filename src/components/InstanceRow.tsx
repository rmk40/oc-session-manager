// Single instance row component

import React, { useContext } from 'react'
import { Text, Box } from 'ink'
import { useTime, useStatusHelpers, useViewState } from './AppContext.js'
import { SpinnerContext } from './App.js'
import type { Instance } from '../types.js'

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface InstanceRowProps {
  instance: Instance
  isSelected: boolean
  indent?: number
  showProject?: boolean
}

const StatusIndicator = React.memo(({ instance }: { instance: Instance }) => {
  const { getEffectiveStatus, isLongRunning } = useStatusHelpers()
  const spinnerFrame = useContext(SpinnerContext)
  const status = getEffectiveStatus(instance)
  const longRunning = isLongRunning(instance)
  if (status === 'idle') return <Text color="green">●</Text>
  if (status === 'busy') {
    if (longRunning) return <Text color="red">!</Text>
    return <Text color="yellow">{SPINNER_CHARS[spinnerFrame % SPINNER_CHARS.length]}</Text>
  }
  return <Text color="gray">◌</Text>
})

const RelativeTime = React.memo(({ instance }: { instance: Instance }) => {
  const currentTime = useTime()
  const { getEffectiveStatus, getBusyDuration } = useStatusHelpers()
  const status = getEffectiveStatus(instance)
  const busyDuration = getBusyDuration(instance)
  const timeStr = status === 'busy' ? formatDuration(busyDuration) : formatRelativeTime(instance.ts, currentTime)
  return <Text dimColor>{timeStr.padStart(8)}</Text>
})

export const InstanceRow = React.memo(({ 
  instance, 
  isSelected, 
  indent = 0,
  showProject = false 
}: InstanceRowProps): React.ReactElement => {
  const { terminalSize } = useViewState()
  const width = terminalSize.columns
  
  const shortSession = instance.sessionID?.slice(-4) ?? '----'
  const costStr = formatCost(instance.cost)
  const tokStr = formatTokens(instance.tokens?.total)
  
  // Adaptive title length based on terminal width
  let maxTitleWidth = 40
  if (width > 120) maxTitleWidth = width - 80
  else if (width > 100) maxTitleWidth = width - 60
  
  const title = instance.title ?? 'Ready'
  const truncatedTitle = title.length > maxTitleWidth ? title.slice(0, maxTitleWidth - 3) + '...' : title
  
  const prefix = showProject ? `${instance.dirName || '?'}:${instance.branch || '?'}:` : ''

  return (
    <Box>
      <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
        {' '.repeat(Math.max(0, indent - 2))}
        {isSelected ? "➔ " : "  "}
        <StatusIndicator instance={instance} />
        {' '}{prefix}{shortSession}{'  '}
        <Text dimColor={!isSelected}>"{truncatedTitle}"</Text>
      </Text>
      
      {width > 110 && instance.model && (
        <Text dimColor>  [{instance.model}]</Text>
      )}
      
      <Box flexGrow={1} />
      
      <Box>
        {costStr && <Text color="magenta">  {costStr}</Text>}
        {tokStr && <Text color="magenta"> {tokStr}</Text>}
        {width > 130 && instance.tokens && (
          <Text dimColor> ({instance.tokens.input}i/{instance.tokens.output}o)</Text>
        )}
        {'  '}
        <RelativeTime instance={instance} />
      </Box>
    </Box>
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
