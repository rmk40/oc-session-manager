// Help bar at the bottom - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useViewState } from './AppContext.js'

export const HelpBar = React.memo((): React.ReactElement => {
  const { viewMode } = useViewState()
  
  const viewToggle = viewMode === 'grouped' ? 'flat' : 'grouped'
  
  return (
    <Box 
      flexDirection="column"
      paddingX={1} 
      marginTop={1}
    >
      <Text dimColor>{"─".repeat(40)}</Text>
      <Text dimColor>
        q: quit  ↑↓/jk: nav  Enter: watch  i: info  d: remove  c: clear stale  Tab: {viewToggle}
      </Text>
    </Box>
  )
})
