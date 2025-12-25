import type { Instance } from "../types.js";
import type { Session, Server } from "../connections.js";

export interface GroupedViewItem {
  type: "group" | "instance";
  groupKey?: string;
  instance?: Instance;
  depth?: number;
  isLast?: boolean;
  parentPrefix?: string;
}

interface TreeNode {
  instance: Instance;
  children: TreeNode[];
  depth: number;
}

export function getGroupedViewItems(
  sessions: Map<string, Session>,
  servers: Map<string, Server>,
  collapsedGroups: Set<string>,
): GroupedViewItem[] {
  // 1. Convert Sessions to legacy-compatible Instances
  const instMap = new Map<string, Instance>();
  for (const session of sessions.values()) {
    const server = servers.get(session.serverUrl);
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

  const allInstances = Array.from(instMap.values());

  // 2. Group by project:branch
  const groupMap = new Map<string, Instance[]>();
  for (const inst of allInstances) {
    const project = inst.project || inst.dirName || "unknown";
    const branch = inst.branch || "main";
    const key = `${project}:${branch}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(inst);
  }

  const sortedGroupKeys = Array.from(groupMap.keys()).sort();
  const items: GroupedViewItem[] = [];

  for (const groupKey of sortedGroupKeys) {
    const groupInstances = groupMap.get(groupKey)!;

    // Add group item
    items.push({ type: "group", groupKey });

    if (collapsedGroups.has(groupKey)) continue;

    // 3. Build hierarchical tree for this group
    const sessionIdSet = new Set(
      groupInstances.map((i) => i.sessionID).filter(Boolean),
    );
    const roots = groupInstances.filter(
      (i) => !i.parentID || !sessionIdSet.has(i.parentID),
    );
    const children = groupInstances.filter(
      (i) => i.parentID && sessionIdSet.has(i.parentID),
    );

    roots.sort((a, b) =>
      (a.instanceId || "").localeCompare(b.instanceId || ""),
    );

    function buildTree(parent: Instance, depth: number): TreeNode {
      const node: TreeNode = { instance: parent, children: [], depth };
      const directChildren = children.filter(
        (c) => c.parentID === parent.sessionID,
      );
      directChildren.sort((a, b) =>
        (a.instanceId || "").localeCompare(b.instanceId || ""),
      );
      for (const child of directChildren) {
        node.children.push(buildTree(child, depth + 1));
      }
      return node;
    }

    const trees = roots.map((r) => buildTree(r, 0));

    // 4. Flatten tree into items with correct traversal order
    function flattenNode(
      node: TreeNode,
      isLast: boolean,
      parentPrefix: string,
    ): void {
      items.push({
        type: "instance",
        instance: node.instance,
        depth: node.depth,
        isLast,
        parentPrefix,
      });

      const childPrefix =
        node.depth === 0 ? "" : parentPrefix + (isLast ? "   " : "│  ");

      node.children.forEach((child, i) => {
        flattenNode(child, i === node.children.length - 1, childPrefix);
      });
    }

    trees.forEach((tree, i) => {
      flattenNode(tree, i === trees.length - 1, "");
    });
  }

  return items;
}
