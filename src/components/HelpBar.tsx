// Help bar at the bottom

import React from 'react'
import { Box, Text } from 'ink'
import { useApp } from './AppContext.js'

export function HelpBar(): React.ReactElement {
  const { state } = useApp()
  
  const viewToggle = state.viewMode === 'grouped' ? 'flat' : 'grouped'
  
  return (
    <Box paddingX={1}>
      <Text color="gray">
        q: quit  ↑↓/jk: nav  Enter: watch  i: info  d: remove  c: clear stale  Tab: {viewToggle}
      </Text>
    </Box>
  )
}
