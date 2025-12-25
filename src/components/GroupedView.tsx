// Grouped view - instances organized by project:branch with parent-child hierarchy

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useAppState, useViewState, useSessionHelpers } from "./AppContext.js";
import { InstanceRow } from "./InstanceRow.js";
import type { Instance } from "../types.js";

interface TreeNode {
  instance: Instance;
  children: TreeNode[];
  depth: number;
}

export const GroupedView = React.memo((): React.ReactElement => {
  const { sessions, servers } = useAppState();
  const { selectedIndex, collapsedGroups } = useViewState();
  const { getSessionStatus, getServerStatus, getServerDisconnectedDuration } =
    useSessionHelpers();

  // Convert Sessions to legacy-compatible Instances for the view
  const instances = useMemo(() => {
    const instMap = new Map<string, Instance>();
    for (const session of sessions.values()) {
      const server = Array.from(servers.values()).find(
        (s) => s.serverUrl === session.serverUrl,
      );
      if (!server) continue;

      instMap.set(session.id, {
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
    return instMap;
  }, [sessions, servers]);

  // Build hierarchical groups: project:branch -> tree of instances
  const groups = useMemo(() => {
    const allInstances = Array.from(instances.values());

    // Group by project:branch
    const groupMap = new Map<string, Instance[]>();
    for (const inst of allInstances) {
      const project = inst.project || inst.dirName || "unknown";
      const branch = inst.branch || "main";
      const key = `${project}:${branch}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(inst);
    }

    // For each group, build parent-child tree
    const result: [string, TreeNode[]][] = [];

    for (const [groupKey, groupInstances] of groupMap) {
      // Find root instances (no parentID or parentID not in this group)
      const sessionIdSet = new Set(
        groupInstances.map((i) => i.sessionID).filter(Boolean),
      );
      const roots = groupInstances.filter(
        (i) => !i.parentID || !sessionIdSet.has(i.parentID),
      );
      const children = groupInstances.filter(
        (i) => i.parentID && sessionIdSet.has(i.parentID),
      );

      // Build tree recursively
      function buildTree(parent: Instance, depth: number): TreeNode {
        const node: TreeNode = { instance: parent, children: [], depth };
        const directChildren = children.filter(
          (c) => c.parentID === parent.sessionID,
        );
        // Sort children by ID for stability
        directChildren.sort((a, b) =>
          (a.instanceId || "").localeCompare(b.instanceId || ""),
        );
        for (const child of directChildren) {
          node.children.push(buildTree(child, depth + 1));
        }
        return node;
      }

      // Sort roots by ID
      roots.sort((a, b) =>
        (a.instanceId || "").localeCompare(b.instanceId || ""),
      );
      const trees = roots.map((r) => buildTree(r, 0));
      result.push([groupKey, trees]);
    }

    return result.sort(([a], [b]) => a.localeCompare(b));
  }, [instances]);

  // Flatten tree nodes to get all instances for stats
  function flattenTree(nodes: TreeNode[]): Instance[] {
    const result: Instance[] = [];
    for (const node of nodes) {
      result.push(node.instance);
      result.push(...flattenTree(node.children));
    }
    return result;
  }

  function getGroupStats(trees: TreeNode[]) {
    const allInstances = flattenTree(trees);
    let idle = 0,
      busy = 0,
      stale = 0,
      cost = 0,
      tokens = 0;
    for (const inst of allInstances) {
      const status = getSessionStatus(inst.instanceId);
      if (status === "idle") idle++;
      else if (status === "busy" || status === "pending") busy++;
      else if (status === "disconnected") stale++;

      cost += inst.cost || 0;
      tokens += inst.tokens?.total || 0;
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

  // Get server status for a group (based on first instance with serverUrl)
  function getGroupServerStatus(trees: TreeNode[]): {
    status: "connecting" | "connected" | "disconnected" | null;
    duration: number;
  } {
    const allInstances = flattenTree(trees);
    for (const inst of allInstances) {
      if (inst.serverUrl) {
        const status = getServerStatus(inst.serverUrl);
        const duration = getServerDisconnectedDuration(inst.serverUrl);
        return { status, duration };
      }
    }
    return { status: null, duration: 0 };
  }

  if (groups.length === 0)
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No OpenCode instances detected</Text>
      </Box>
    );

  let currentIndex = 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      {groups.map(([groupKey, groupTrees]) => {
        const isCollapsed = collapsedGroups.has(groupKey);
        const stats = getGroupStats(groupTrees);
        const serverInfo = getGroupServerStatus(groupTrees);
        const [dirName, branch] = groupKey.split(":");
        const groupIndex = currentIndex;
        currentIndex++;
        const isGroupSelected = selectedIndex === groupIndex;

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
              <Text
                color={isGroupSelected ? "cyan" : undefined}
                bold={isGroupSelected}
              >
                {isGroupSelected ? "➔ " : "  "}
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

            {!isCollapsed && renderTrees(groupTrees)}
          </Box>
        );
      })}
    </Box>
  );

  // Render tree nodes with proper indentation and tree lines
  function renderTrees(trees: TreeNode[]): React.ReactNode[] {
    const elements: React.ReactNode[] = [];

    function renderNode(
      node: TreeNode,
      isLast: boolean,
      parentPrefix: string,
    ): void {
      const instIndex = currentIndex;
      currentIndex++;
      const isSelected = selectedIndex === instIndex;

      // Calculate indent: base indent (5) + tree depth
      const indent = 5 + node.depth * 3;

      elements.push(
        <InstanceRow
          key={node.instance.instanceId}
          instance={node.instance}
          isSelected={isSelected}
          indent={indent}
          treePrefix={node.depth > 0 ? (isLast ? "└─" : "├─") : undefined}
        />,
      );

      // Render children
      const childPrefix =
        node.depth === 0 ? "" : parentPrefix + (isLast ? "   " : "│  ");

      node.children.forEach((child, i) => {
        renderNode(child, i === node.children.length - 1, childPrefix);
      });
    }

    trees.forEach((tree, i) => {
      renderNode(tree, i === trees.length - 1, "");
    });

    return elements;
  }
});
