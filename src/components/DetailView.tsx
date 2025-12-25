// Detail view for a single instance - full screen or sidebar

import React from "react";
import { Box, Text, Spacer } from "ink";
import { useSessionHelpers } from "./AppContext.js";
import type { Instance } from "../types.js";
import { formatCost, formatDuration, formatRelativeTime } from "../utils.js";

interface DetailViewProps {
  instance: Instance;
  isSidebar?: boolean;
}

export const DetailView = React.memo(
  ({ instance, isSidebar = false }: DetailViewProps): React.ReactElement => {
    const { getSessionStatus, isSessionLongRunning, getSessionBusyDuration } =
      useSessionHelpers();

    const status = getSessionStatus(instance.instanceId);
    const identifier = `${instance.dirName ?? "?"}:${instance.branch ?? "?"}:${instance.sessionID?.slice(-4) ?? "----"}`;

    const statusColors: Record<string, "green" | "yellow" | "gray" | "red"> = {
      idle: "green",
      busy: "yellow",
      pending: "yellow",
      disconnected: "red",
    };
    const statusIcons: Record<string, string> = {
      idle: "●",
      busy: "○",
      pending: "◆",
      disconnected: "⚡",
    };

    const tokIn = instance.tokens?.input ?? 0;
    const tokOut = instance.tokens?.output ?? 0;
    const tokTotal = instance.tokens?.total ?? 0;

    const content = (
      <Box flexDirection="column" flexGrow={1}>
        {/* Header */}
        <Box>
          <Text bold color="cyan">
            {isSidebar ? "DETAILS" : identifier}
          </Text>
        </Box>

        {/* Content area */}
        <Box flexDirection="column" flexGrow={1}>
          {/* Status */}
          <Box marginTop={isSidebar ? 0 : 1}>
            <Text>Status: </Text>
            <Text color={statusColors[status] || "gray"}>
              {statusIcons[status] || "◌"} {status.toUpperCase()}
            </Text>
          </Box>

          {/* Session info */}
          <Box flexDirection="column" marginTop={1}>
            {isSidebar && (
              <Text color="yellow">
                ID: {instance.sessionID?.slice(0, 8)}...
              </Text>
            )}
            {!isSidebar && (
              <Text>Session ID: {instance.sessionID ?? "N/A"}</Text>
            )}
            {instance.parentID && (
              <Text>Parent ID: {instance.parentID.slice(0, 8)}...</Text>
            )}
            <Text>Title: {instance.title ?? "N/A"}</Text>
            <Text>Dir: {instance.dirName ?? "N/A"}</Text>
            <Text>Host: {instance.host ?? "N/A"}</Text>
          </Box>

          {/* Model & Cost */}
          <Box flexDirection="column" marginTop={1}>
            <Text>Model: {instance.model ?? "N/A"}</Text>
            <Text>Cost: {formatCost(instance.cost) || "$0.00"}</Text>
            <Text>
              Tokens: {tokTotal.toLocaleString()} ({tokIn.toLocaleString()}i /{" "}
              {tokOut.toLocaleString()}o)
            </Text>
          </Box>

          {/* Timing */}
          <Box flexDirection="column" marginTop={1}>
            <Text>Updated: {formatRelativeTime(instance.ts)}</Text>
            {(status === "busy" || status === "pending") && (
              <Text
                color={
                  isSessionLongRunning(instance.instanceId) ? "red" : undefined
                }
              >
                Busy:{" "}
                {formatDuration(getSessionBusyDuration(instance.instanceId))}
                {isSessionLongRunning(instance.instanceId) && " !"}
              </Text>
            )}
          </Box>

          <Spacer />
        </Box>

        {/* Help bar at bottom */}
        {!isSidebar && (
          <Box
            borderStyle="single"
            borderTop
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
          >
            <Text dimColor>Esc/Enter: back</Text>
          </Box>
        )}
      </Box>
    );

    if (isSidebar) {
      return content;
    }

    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {content}
      </Box>
    );
  },
);
