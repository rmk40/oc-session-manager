// Header component with status summary - fixed height

import React from "react";
import { Box, Text } from "ink";
import { useAppState, useViewState, useSessionHelpers } from "./AppContext.js";

export const Header = React.memo((): React.ReactElement => {
  const { sessions } = useAppState();
  const { viewMode, terminalSize } = useViewState();
  const { getSessionStatus } = useSessionHelpers();

  const width = terminalSize.columns;

  // Count instances by status
  let idle = 0,
    busy = 0,
    stale = 0;
  for (const session of sessions.values()) {
    const status = getSessionStatus(session.id);
    if (status === "idle") idle++;
    else if (status === "busy" || status === "pending") busy++;
    else if (status === "disconnected") stale++;
  }

  const total = sessions.size;
  const isAnyBusy = busy > 0;
  const title =
    viewMode === "flat" ? "oc-session-manager (flat)" : "oc-session-manager";

  return (
    <Box
      flexDirection={width > 100 ? "row" : "column"}
      paddingX={1}
      borderStyle="single"
      borderBottom
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      marginBottom={1}
      justifyContent="space-between"
      alignItems={width > 100 ? "center" : "flex-start"}
    >
      <Box>
        <Text bold color={isAnyBusy ? "yellow" : "cyan"}>
          {title.toUpperCase()}
        </Text>
      </Box>

      <Box gap={2} marginBottom={width > 100 ? 0 : 1}>
        <Text color="green">● IDLE: {idle}</Text>
        <Text color="yellow">○ BUSY: {busy}</Text>
        <Text color="gray">◌ STALE: {stale}</Text>
        <Text dimColor>TOTAL: {total}</Text>
      </Box>

      {width > 120 && (
        <Box>
          <Text dimColor>
            Terminal: {width}x{terminalSize.rows}
          </Text>
        </Box>
      )}
    </Box>
  );
});
