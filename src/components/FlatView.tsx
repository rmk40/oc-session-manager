// Flat view - all instances in a single list

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { useAppState, useViewState } from './AppContext.js'
import { InstanceRow } from './InstanceRow.js'

export const FlatView = React.memo((): React.ReactElement => {
  const { instances } = useAppState()
  const { selectedIndex } = useViewState()
  
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
      {sorted.map((inst, idx) => (
        <InstanceRow
          key={inst.instanceId}
          instance={inst}
          isSelected={selectedIndex === idx}
          showProject={true}
        />
      ))}
    </Box>
  )
})
