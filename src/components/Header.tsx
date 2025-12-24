// Header component with status summary

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
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color={isAnyBusy ? 'yellow' : 'white'}>
          oc-session-manager
        </Text>
        {state.viewMode === 'flat' && <Text color="gray"> (flat)</Text>}
      </Box>
      <Box gap={2}>
        <Text color="green">● IDLE ({idle})</Text>
        <Text color="yellow">○ BUSY ({busy})</Text>
        <Text color="gray">◌ STALE ({stale})</Text>
        <Text>Total: {total}</Text>
      </Box>
    </Box>
  )
}
