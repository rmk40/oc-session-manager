// Flat view - all instances in a single list

import React, { useContext } from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'
import { SpinnerContext } from './App.js'
import { InstanceRow } from './InstanceRow.js'

export function FlatView(): React.ReactElement {
  const { state } = useApp()
  const spinnerFrame = useContext(SpinnerContext)
  
  // Sort instances by instanceId for stable ordering
  const sorted = Array.from(state.instances.values())
    .sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))

  // Empty state
  if (sorted.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No OpenCode instances detected</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {sorted.map((inst, idx) => (
        <InstanceRow
          key={inst.instanceId}
          instance={inst}
          isSelected={state.selectedIndex === idx}
          spinnerFrame={spinnerFrame}
          showProject={true}
        />
      ))}
    </Box>
  )
}
