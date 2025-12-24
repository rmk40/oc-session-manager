// Flat view - all instances in a single list

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { useAppState } from './AppContext.js'
import { InstanceRow } from './InstanceRow.js'

export const FlatView = React.memo((): React.ReactElement => {
  const { instances, selectedIndex, currentTime } = useAppState()
  const { getEffectiveStatus, isLongRunning, getBusyDuration } = useStatusHelpers()
  
  const sorted = useMemo(() => {
    return Array.from(instances.values()).sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
  }, [instances])

  if (sorted.length === 0) return (
    <Box paddingX={1} paddingY={1}>
      <Text dimColor>No OpenCode instances detected</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {sorted.map((inst, idx) => {
        const status = getEffectiveStatus(inst)
        const longRunning = isLongRunning(inst)
        const busyDuration = getBusyDuration(inst)

        return (
          <InstanceRow
            key={inst.instanceId}
            instance={inst}
            isSelected={selectedIndex === idx}
            status={status}
            longRunning={longRunning}
            busyDuration={busyDuration}
            currentTime={currentTime}
            showProject={true}
          />
        )
      })}
    </Box>
  )
})
