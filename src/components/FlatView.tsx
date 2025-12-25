// Flat view - all instances in a single list

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useAppState, useViewState } from "./AppContext.js";
import { InstanceRow } from "./InstanceRow.js";
import type { Instance } from "../types.js";

export const FlatView = React.memo((): React.ReactElement => {
  const { sessions, servers } = useAppState();
  const { selectedIndex } = useViewState();

  // Convert Sessions to legacy-compatible Instances for the view
  const instances = useMemo(() => {
    const list: Instance[] = [];
    for (const session of sessions.values()) {
      const server = Array.from(servers.values()).find(
        (s) => s.serverUrl === session.serverUrl,
      );
      if (!server) continue;

      list.push({
        instanceId: session.id,
        sessionID: session.id,
        parentID: session.parentID,
        status: session.status === "running" ? "busy" : session.status,
        project: server.project,
        directory: session.directory || server.directory,
        dirName: server.project,
        branch: server.branch,
        serverUrl: server.serverUrl,
        title: session.title,
        ts: session.discoveredAt || Date.now(),
        cost: session.cost,

        tokens: session.tokens,
        model: session.model,
        _isChildSession: !!session.parentID,
        _fromServer: true,
      } as Instance);
    }
    return list.sort((a, b) =>
      (a.instanceId || "").localeCompare(b.instanceId || ""),
    );
  }, [sessions, servers]);

  if (instances.length === 0)
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No OpenCode instances detected</Text>
      </Box>
    );

  return (
    <Box flexDirection="column" paddingX={1}>
      {instances.map((inst, idx) => (
        <InstanceRow
          key={inst.instanceId}
          instance={inst}
          isSelected={selectedIndex === idx}
          indent={2}
          showProject={true}
        />
      ))}
    </Box>
  );
});
