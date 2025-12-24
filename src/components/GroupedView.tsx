// Grouped view - instances organized by project:branch

import React, { useState, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useApp } from './AppContext.js'
import { InstanceRow } from './InstanceRow.js'
import type { Instance } from '../types.js'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function GroupedView(): React.ReactElement {
  const { state, actions } = useApp()
  const { stdout } = useStdout()
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  
  // Animate spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER.length)
    }, 100)
    return () => clearInterval(interval)
  }, [])
  
  // Group instances
  const groups = getGroupedInstances()
  
  // Track selectable index
  let currentIndex = 0
  
  function getGroupedInstances(): [string, Instance[]][] {
    const sorted = Array.from(state.instances.values())
      .sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
    
    const groups = new Map<string, Instance[]>()
    for (const inst of sorted) {
      const key = getGroupKey(inst)
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(inst)
    }
    
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }
  
  function getGroupKey(instance: Instance): string {
    const project = instance.project || instance.dirName || 'unknown'
    const branch = instance.branch || 'main'
    return `${project}:${branch}`
  }
  
  function getGroupStats(instances: Instance[]) {
    let idle = 0, busy = 0, stale = 0, cost = 0, tokens = 0
    for (const inst of instances) {
      const status = actions.getEffectiveStatus(inst)
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

  if (groups.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color="gray">No OpenCode instances detected</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {groups.map(([groupKey, groupInstances]) => {
        const isCollapsed = state.collapsedGroups.has(groupKey)
        const stats = getGroupStats(groupInstances)
        const [dirName, branch] = groupKey.split(':')
        const groupIndex = currentIndex
        currentIndex++
        
        const isGroupSelected = state.selectedIndex === groupIndex
        
        return (
          <Box key={groupKey} flexDirection="column">
            {/* Group header */}
            <Box>
              <Text inverse={isGroupSelected}>
                <Text>{isCollapsed ? '▶' : '▼'} </Text>
                <Text bold>{dirName}</Text>
                <Text color="cyan">:{branch}</Text>
                <Text>  </Text>
                {stats.idle > 0 && <Text color="green">●{stats.idle} </Text>}
                {stats.busy > 0 && <Text color="yellow">○{stats.busy} </Text>}
                {stats.stale > 0 && <Text color="gray">◌{stats.stale} </Text>}
                {stats.cost > 0 && <Text color="gray"> {formatCost(stats.cost)}</Text>}
                {stats.tokens > 0 && <Text color="gray"> {formatTokens(stats.tokens)}</Text>}
              </Text>
            </Box>
            
            {/* Instance rows */}
            {!isCollapsed && groupInstances.map((inst) => {
              const instIndex = currentIndex
              currentIndex++
              const isSelected = state.selectedIndex === instIndex
              
              return (
                <InstanceRow
                  key={inst.instanceId}
                  instance={inst}
                  isSelected={isSelected}
                  spinnerFrame={spinnerFrame}
                  indent={3}
                />
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}
