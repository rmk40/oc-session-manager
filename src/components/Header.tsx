// Header component with status summary - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useAppState, useStatusHelpers } from './AppContext.js'

export const Header = React.memo((): React.ReactElement => {
  const { instances, viewMode } = useAppState()
  const { getEffectiveStatus } = useStatusHelpers()
  
  // Count instances by status
  let idle = 0, busy = 0, stale = 0
  for (const inst of instances.values()) {
    const status = getEffectiveStatus(inst)
    if (status === 'idle') idle++
    else if (status === 'busy') busy++
    else stale++
  }
  
  const total = instances.size
  const isAnyBusy = busy > 0
  const title = viewMode === 'flat' ? 'oc-session-manager (flat)' : 'oc-session-manager'
  
  return (
    <Box 
      flexDirection="column" 
      paddingX={1}
      borderStyle="round"
      borderColor="cyan"
      marginBottom={1}
    >
      <Box>
        <Text bold color={isAnyBusy ? 'yellow' : 'cyan'}>
          {title}
        </Text>
      </Box>
      
      <Box gap={2}>
        <Text color="green">● IDLE ({idle})</Text>
        <Text color="yellow">○ BUSY ({busy})</Text>
        <Text color="gray">◌ STALE ({stale})</Text>
        <Text dimColor>Total: {total}</Text>
      </Box>
    </Box>
  )
})
