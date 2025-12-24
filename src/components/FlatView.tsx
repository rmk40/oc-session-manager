// Flat view - all instances in a single list

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'
import { InstanceRow } from './InstanceRow.js'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function FlatView(): React.ReactElement {
  const { state } = useApp()
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  
  // Animate spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER.length)
    }, 100)
    return () => clearInterval(interval)
  }, [])
  
  // Sort instances by instanceId for stable ordering
  const sorted = Array.from(state.instances.values())
    .sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))

  if (sorted.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color="gray">No OpenCode instances detected</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
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
