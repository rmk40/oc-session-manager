// Main App component - Full-screen TUI using Ink best practices

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, useApp as useInkApp, useInput } from "ink";
import {
  useAppState,
  useAppActions,
  useViewState,
  useSessionHelpers,
} from "./AppContext.js";
import { Header } from "./Header.js";
import { GroupedView } from "./GroupedView.js";
import { FlatView } from "./FlatView.js";
import { DetailView } from "./DetailView.js";
import { SessionView } from "./SessionView.js";
import { HelpBar } from "./HelpBar.js";
import { SessionWatcher } from "./SessionWatcher.js";
import type { Instance } from "../types.js";

// Spinner context to share frame across components
export const SpinnerContext = React.createContext(0);

export function App(): React.ReactElement {
  const { exit } = useInkApp();
  const { sessions, servers } = useAppState();
  const {
    viewMode,
    selectedIndex,
    collapsedGroups,
    detailView,
    sessionViewActive,
    sessionViewScrollOffset,
    terminalSize,
  } = useViewState();
  const actions = useAppActions();
  const { getSessionStatus } = useSessionHelpers();

  const [spinnerFrame, setSpinnerFrame] = useState(0);

  const hasBusyInstances = useMemo(() => {
    for (const session of sessions.values()) {
      const status = getSessionStatus(session.id);
      if (["busy", "running", "pending"].includes(status)) return true;
    }
    return false;
  }, [sessions, getSessionStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      actions.tick();
    }, 1000);
    return () => clearInterval(interval);
  }, [actions.tick]);

  useEffect(() => {
    if (!hasBusyInstances) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % 10);
    }, 150);
    return () => clearInterval(interval);
  }, [hasBusyInstances]);

  // Map sessions to instances for navigation and selection
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
        ts: session.statsUpdatedAt || Date.now(),
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

  const getGroupedInstances = useCallback((): [string, Instance[]][] => {
    const groups = new Map<string, Instance[]>();
    for (const inst of instances) {
      const project = inst.project || inst.dirName || "unknown";
      const branch = inst.branch || "main";
      const key = `${project}:${branch}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inst);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [instances]);

  const getSelectableItemCount = useCallback((): number => {
    if (viewMode === "flat") return instances.length;
    const groups = getGroupedInstances();
    let count = 0;
    for (const [groupKey, groupInstances] of groups) {
      count++;
      if (!collapsedGroups.has(groupKey)) count += groupInstances.length;
    }
    return count;
  }, [viewMode, instances.length, getGroupedInstances, collapsedGroups]);

  const getSelectedItem = useCallback((): {
    type: "group" | "instance";
    key?: string;
    instanceId?: string;
  } | null => {
    if (selectedIndex < 0) return null;
    if (viewMode === "flat") {
      return selectedIndex < instances.length
        ? { type: "instance", instanceId: instances[selectedIndex].instanceId }
        : null;
    }
    const groups = getGroupedInstances();
    let idx = 0;
    for (const [groupKey, groupInstances] of groups) {
      if (idx === selectedIndex) return { type: "group", key: groupKey };
      idx++;
      if (!collapsedGroups.has(groupKey)) {
        for (const inst of groupInstances) {
          if (idx === selectedIndex)
            return { type: "instance", instanceId: inst.instanceId };
          idx++;
        }
      }
    }
    return null;
  }, [
    selectedIndex,
    viewMode,
    instances,
    getGroupedInstances,
    collapsedGroups,
  ]);

  useInput((input, key) => {
    // Global shortcuts
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    // Session view shortcuts
    if (sessionViewActive) {
      if (key.escape) {
        actions.exitSessionView();
        actions.setSelectedIndex(-1);
        return;
      }

      // Scrolling in session view
      if (key.upArrow) {
        actions.setSessionViewScrollOffset(sessionViewScrollOffset + 1);
        return;
      }
      if (key.downArrow) {
        actions.setSessionViewScrollOffset(
          Math.max(0, sessionViewScrollOffset - 1),
        );
        return;
      }
      if (key.pageUp) {
        actions.setSessionViewScrollOffset(sessionViewScrollOffset + 15);
        return;
      }
      if (key.pageDown) {
        actions.setSessionViewScrollOffset(
          Math.max(0, sessionViewScrollOffset - 15),
        );
        return;
      }
      return;
    }

    // Detail view shortcuts
    if (detailView) {
      if (key.escape || key.return) actions.setDetailView(null);
      return;
    }

    const itemCount = getSelectableItemCount();

    if (key.upArrow || input === "k") {
      if (selectedIndex > 0) actions.setSelectedIndex(selectedIndex - 1);
      else if (selectedIndex === -1 && itemCount > 0)
        actions.setSelectedIndex(itemCount - 1);
      return;
    }

    if (key.downArrow || input === "j") {
      if (selectedIndex < itemCount - 1)
        actions.setSelectedIndex(selectedIndex + 1);
      return;
    }

    if (key.pageUp) {
      actions.setSelectedIndex(Math.max(0, selectedIndex - 10));
      return;
    }

    if (key.pageDown) {
      actions.setSelectedIndex(Math.min(itemCount - 1, selectedIndex + 10));
      return;
    }

    if (key.tab) {
      actions.setViewMode(viewMode === "grouped" ? "flat" : "grouped");
      actions.setSelectedIndex(-1);
      return;
    }

    if (key.return) {
      handleEnterKey();
      return;
    }

    if (input === "i") {
      const item = getSelectedItem();
      if (item?.type === "instance" && item.instanceId)
        actions.setDetailView(item.instanceId);
      return;
    }

    if (key.escape) {
      actions.setSelectedIndex(-1);
      return;
    }
  });

  function handleEnterKey(): void {
    const item = getSelectedItem();
    if (!item) return;
    if (item.type === "group" && item.key)
      actions.toggleCollapsedGroup(item.key);
    else if (item.type === "instance" && item.instanceId) {
      const inst = instances.find((i) => i.instanceId === item.instanceId);
      if (inst) actions.enterSessionView(inst);
    }
  }

  // Calculate if we should show split view
  const isSplitView = terminalSize.columns > 140;
  const selectedItem = getSelectedItem();
  const selectedInstance =
    selectedItem?.type === "instance" && selectedItem.instanceId
      ? instances.find((i) => i.instanceId === selectedItem.instanceId)
      : null;

  // Views
  if (sessionViewActive) {
    return (
      <SpinnerContext.Provider value={spinnerFrame}>
        <SessionWatcher />
        <Box
          width={terminalSize.columns}
          height={terminalSize.rows}
          borderStyle="round"
          borderColor="cyan"
        >
          <SessionView />
        </Box>
      </SpinnerContext.Provider>
    );
  }

  if (detailView) {
    const inst = instances.find((i) => i.instanceId === detailView);
    if (inst)
      return (
        <SpinnerContext.Provider value={spinnerFrame}>
          <Box
            width={terminalSize.columns}
            height={terminalSize.rows}
            borderStyle="round"
            borderColor="cyan"
          >
            <DetailView instance={inst} />
          </Box>
        </SpinnerContext.Provider>
      );
  }

  return (
    <SpinnerContext.Provider value={spinnerFrame}>
      <SessionWatcher />
      <Box
        flexDirection="column"
        width={terminalSize.columns}
        height={terminalSize.rows}
        borderStyle="round"
        borderColor="cyan"
      >
        <Header />

        <Box flexDirection="row" flexGrow={1} overflow="hidden">
          {/* Main List */}
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {viewMode === "grouped" ? <GroupedView /> : <FlatView />}
          </Box>

          {/* Detail Sidebar (if wide enough and instance selected) */}
          {isSplitView && selectedInstance && (
            <Box
              width={60}
              borderStyle="single"
              borderLeft
              borderTop={false}
              borderBottom={false}
              borderRight={false}
              paddingLeft={1}
            >
              <DetailView instance={selectedInstance} isSidebar={true} />
            </Box>
          )}
        </Box>

        <HelpBar />
      </Box>
    </SpinnerContext.Provider>
  );
}
