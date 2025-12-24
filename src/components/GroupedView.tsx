// Grouped view - instances organized by project:branch

import React, { useContext, useMemo } from 'react'
import { Box, Text } from 'ink'
import { useAppState, useStatusHelpers } from './AppContext.js'
import { SpinnerContext } from './App.js'
import { InstanceRow } from './InstanceRow.js'
import type { Instance } from '../types.js'

export const GroupedView = React.memo((): React.ReactElement => {
  const { instances, selectedIndex, collapsedGroups, currentTime } = useAppState()
  const { getEffectiveStatus, isLongRunning, getBusyDuration } = useStatusHelpers()
  
  const groups = useMemo(() => {
    const sorted = Array.from(instances.values()).sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
    const groupMap = new Map<string, Instance[]>()
    for (const inst of sorted) {
      const project = inst.project || inst.dirName || 'unknown'
      const branch = inst.branch || 'main'
      const key = `${project}:${branch}`
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(inst)
    }
    return Array.from(groupMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [instances])
  
  function getGroupStats(groupInstances: Instance[]) {
    let idle = 0, busy = 0, stale = 0, cost = 0, tokens = 0
    for (const inst of groupInstances) {
      const status = getEffectiveStatus(inst)
      if (status === 'idle') idle++
      else if (status === 'busy') busy++
      else stale++
      cost += inst.cost || 0
      tokens += inst.tokens?.total || 0
    }
    return { idle, busy, stale, cost, tokens }
  }
  
  function formatCost(cost: number): string {
    if (!cost || cost === 0) return ''
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
  }
  
  function formatTokens(tokens: number): string {
    if (!tokens) return ''
    if (tokens < 1000) return String(tokens)
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
    return `${(tokens / 1000000).toFixed(2)}M`
  }

  if (groups.length === 0) return (
    <Box paddingX={1} paddingY={1}>
      <Text dimColor>No OpenCode instances detected</Text>
    </Box>
  )

  let currentIndex = 0

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {groups.map(([groupKey, groupInstances]) => {
        const isCollapsed = collapsedGroups.has(groupKey)
        const stats = getGroupStats(groupInstances)
        const [dirName, branch] = groupKey.split(':')
        const groupIndex = currentIndex; currentIndex++
        const isGroupSelected = selectedIndex === groupIndex
        
        const statusParts: React.ReactNode[] = []
        if (stats.idle > 0) statusParts.push(<Text key="idle" color="green">●{stats.idle}</Text>)
        if (stats.busy > 0) statusParts.push(<Text key="busy" color="yellow">○{stats.busy}</Text>)
        if (stats.stale > 0) statusParts.push(<Text key="stale" color="gray">◌{stats.stale}</Text>)
        
        const costStr = formatCost(stats.cost); const tokStr = formatTokens(stats.tokens)
        
        return (
          <Box key={groupKey} flexDirection="column">
            <Text inverse={isGroupSelected}>
              {isCollapsed ? '▶ ' : '▼ '}
              <Text bold>{dirName}</Text>
              <Text color="cyan">:{branch}</Text>
              {'  '}
              {statusParts.map((part, i) => (
                <React.Fragment key={i}>{part}{i < statusParts.length - 1 ? ' ' : ''}</React.Fragment>
              ))}
              {costStr && <Text dimColor> {costStr}</Text>}
              {tokStr && <Text dimColor> {tokStr}</Text>}
            </Text>
            
            {!isCollapsed && groupInstances.map((inst) => {
              const instIndex = currentIndex; currentIndex++
              const isSelected = selectedIndex === instIndex
              
              // Pass pre-computed values to InstanceRow to minimize its re-renders
              const status = getEffectiveStatus(inst)
              const longRunning = isLongRunning(inst)
              const busyDuration = getBusyDuration(inst)

              return (
                <InstanceRow
                  key={inst.instanceId}
                  instance={inst}
                  isSelected={isSelected}
                  status={status}
                  longRunning={longRunning}
                  busyDuration={busyDuration}
                  currentTime={currentTime}
                  indent={3}
                />
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
})
