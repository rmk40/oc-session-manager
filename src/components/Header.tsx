// Header component with status summary - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'

export function Header(): React.ReactElement {
  const { state, actions } = useApp()
  
  // Count instances by status
  let idle = 0, busy = 0, stale = 0
  for (const inst of state.instances.values()) {
    const status = actions.getEffectiveStatus(inst)
    if (status === 'idle') idle++
    else if (status === 'busy') busy++
    else stale++
  }
  
  const total = state.instances.size
  const isAnyBusy = busy > 0
  const title = state.viewMode === 'flat' ? 'oc-session-manager (flat)' : 'oc-session-manager'
  
  return (
    <Box 
      flexDirection="column" 
      borderStyle="round" 
      borderColor="cyan"
    >
      {/* Title row */}
      <Box paddingX={1}>
        <Text bold color={isAnyBusy ? 'yellow' : 'white'}>
          {title}
        </Text>
      </Box>
      
      {/* Status summary row */}
      <Box paddingX={1} gap={2}>
        <Text color="green">● IDLE ({idle})</Text>
        <Text color="yellow">○ BUSY ({busy})</Text>
        <Text color="gray">◌ STALE ({stale})</Text>
        <Text dimColor>Total: {total}</Text>
      </Box>
    </Box>
  )
}
