// Help bar at the bottom - fixed height

import React from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'

export function HelpBar(): React.ReactElement {
  const { state } = useApp()
  
  const viewToggle = state.viewMode === 'grouped' ? 'flat' : 'grouped'
  
  return (
    <Box paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text dimColor>
        q: quit  ↑↓/jk: nav  Enter: watch  i: info  d: remove  c: clear stale  Tab: {viewToggle}
      </Text>
    </Box>
  )
}
