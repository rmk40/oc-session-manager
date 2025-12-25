// Grouped view - instances organized by project:branch with parent-child hierarchy

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useAppState, useViewState, useSessionHelpers } from "./AppContext.js";
import { InstanceRow } from "./InstanceRow.js";
import { getGroupedViewItems } from "./view-utils.js";

export const GroupedView = React.memo((): React.ReactElement => {
  const { sessions, servers } = useAppState();
  const { selectedIndex, collapsedGroups } = useViewState();
  const { getSessionStatus, getServerStatus, getServerDisconnectedDuration } =
    useSessionHelpers();

  // Unified view items
  const items = useMemo(
    () => getGroupedViewItems(sessions, servers, collapsedGroups),
    [sessions, servers, collapsedGroups],
  );

  function getGroupStats(groupKey: string) {
    // Filter sessions belonging to this group
    const groupSessions = Array.from(sessions.values()).filter((s) => {
      const server = servers.get(s.serverUrl);
      if (!server) return false;
      const project = server.project || server.directory || "unknown";
      const branch = server.branch || "main";
      return `${project}:${branch}` === groupKey;
    });

    let idle = 0,
      busy = 0,
      stale = 0,
      cost = 0,
      tokens = 0;
    for (const session of groupSessions) {
      const status = getSessionStatus(session.id);
      if (status === "idle") idle++;
      else if (status === "busy" || status === "pending") busy++;
      else if (status === "disconnected") stale++;

      cost += session.cost || 0;
      tokens += session.tokens?.total || 0;
    }
    return { idle, busy, stale, cost, tokens };
  }

  function formatCost(cost: number): string {
    if (!cost || cost === 0) return "";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }

  function formatTokens(tokens: number): string {
    if (!tokens) return "";
    if (tokens < 1000) return String(tokens);
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${(tokens / 1000000).toFixed(2)}M`;
  }

  function formatDisconnectedDuration(ms: number): string {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m`;
  }

  // Get server status for a group
  function getGroupServerStatus(groupKey: string): {
    status: "connecting" | "connected" | "disconnected" | null;
    duration: number;
  } {
    // Find first server that matches the group key
    for (const server of servers.values()) {
      const project = server.project || server.directory || "unknown";
      const branch = server.branch || "main";
      if (`${project}:${branch}` === groupKey) {
        const status = getServerStatus(server.serverUrl);
        const duration = getServerDisconnectedDuration(server.serverUrl);
        return { status, duration };
      }
    }
    return { status: null, duration: 0 };
  }

  if (items.length === 0)
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No OpenCode instances detected</Text>
      </Box>
    );

  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((item, idx) => {
        const isSelected = selectedIndex === idx;

        if (item.type === "group" && item.groupKey) {
          const groupKey = item.groupKey;
          const isCollapsed = collapsedGroups.has(groupKey);
          const stats = getGroupStats(groupKey);
          const serverInfo = getGroupServerStatus(groupKey);
          const [dirName, branch] = groupKey.split(":");

          const statusParts: React.ReactNode[] = [];

          // Show connection status indicator
          if (serverInfo.status === "disconnected") {
            statusParts.push(
              <Text key="disconn" color="red">
                ⚡{formatDisconnectedDuration(serverInfo.duration)}
              </Text>,
            );
          } else if (serverInfo.status === "connecting") {
            statusParts.push(
              <Text key="conn" color="yellow">
                ◐
              </Text>,
            );
          }

          if (stats.idle > 0)
            statusParts.push(
              <Text key="idle" color="green">
                ●{stats.idle}
              </Text>,
            );
          if (stats.busy > 0)
            statusParts.push(
              <Text key="busy" color="yellow">
                ○{stats.busy}
              </Text>,
            );
          if (stats.stale > 0)
            statusParts.push(
              <Text key="stale" color="gray">
                ◌{stats.stale}
              </Text>,
            );

          const costStr = formatCost(stats.cost);
          const tokStr = formatTokens(stats.tokens);

          return (
            <Box key={groupKey} flexDirection="column">
              <Box>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {isSelected ? "➔ " : "  "}
                  {isCollapsed ? "▶ " : "▼ "}
                  <Text bold>{dirName}</Text>
                  <Text color="cyan">:{branch}</Text>
                </Text>
                <Text>{"  "}</Text>
                {statusParts.map((part, i) => (
                  <React.Fragment key={i}>
                    {part}
                    {i < statusParts.length - 1 ? <Text> </Text> : null}
                  </React.Fragment>
                ))}
                {costStr ? <Text dimColor> {costStr}</Text> : null}
                {tokStr ? <Text dimColor> {tokStr}</Text> : null}
              </Box>
            </Box>
          );
        } else if (item.type === "instance" && item.instance) {
          return (
            <InstanceRow
              key={item.instance.instanceId}
              instance={item.instance}
              isSelected={isSelected}
              indent={5 + (item.depth || 0) * 3}
              treePrefix={
                item.depth && item.depth > 0
                  ? item.isLast
                    ? "└─"
                    : "├─"
                  : undefined
              }
            />
          );
        }
        return null;
      })}
    </Box>
  );
});
