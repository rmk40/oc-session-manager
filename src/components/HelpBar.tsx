// Help bar at the bottom - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useAppState } from './AppContext.js'

export const HelpBar = React.memo((): React.ReactElement => {
  const { viewMode } = useAppState()
  
  const viewToggle = viewMode === 'grouped' ? 'flat' : 'grouped'
  
  return (
    <Box 
      paddingX={1} 
      borderStyle="round" 
      borderColor="cyan"
      marginTop={1}
    >
      <Text dimColor>
        q: quit  ↑↓/jk: nav  Enter: watch  i: info  d: remove  c: clear stale  Tab: {viewToggle}
      </Text>
    </Box>
  )
})
