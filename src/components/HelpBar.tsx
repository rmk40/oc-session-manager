// Help bar at the bottom - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useViewState } from './AppContext.js'

export const HelpBar = React.memo((): React.ReactElement => {
  const { viewMode, terminalSize } = useViewState()
  
  const width = terminalSize.columns
  const viewToggle = viewMode === 'grouped' ? 'flat' : 'grouped'
  
  return (
    <Box 
      flexDirection="row"
      paddingX={1} 
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      marginTop={1}
      justifyContent="space-between"
    >
      <Box>
        <Text dimColor>
          q: quit  ↑↓/jk: nav  Enter: watch  i: info  d: remove  c: clear stale  Tab: {viewToggle}
        </Text>
      </Box>
      
      {width > 150 && (
          <Box>
              <Text dimColor>Wide Terminal: Split-View Details Enabled</Text>
          </Box>
      )}
    </Box>
  )
})
