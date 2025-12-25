// React Context for shared application state

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useStdout } from "ink";
import type {
  Instance,
  ViewMode,
  Permission,
  Message,
  RenderedLine,
} from "../types.js";
import { LONG_RUNNING_MS } from "../config.js";
import type { Server, Session } from "../connections.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppState {
  servers: Map<string, Server>;
  sessions: Map<string, Session>;
}

export interface ViewState {
  viewMode: ViewMode;
  selectedIndex: number;
  collapsedGroups: Set<string>;
  detailView: string | null;
  sessionViewActive: boolean;
  sessionViewInstance: Instance | null;
  sessionViewSessionID: string | null;
  sessionViewMessages: Message[];
  sessionViewScrollOffset: number;
  sessionViewRenderedLines: RenderedLine[];
  sessionViewPendingPermissions: Map<string, Permission>;
  sessionViewInputMode: boolean;
  sessionViewInputBuffer: string;
  sessionViewConfirmAbort: boolean;
  sessionViewError: string | null;
  sessionViewConnecting: boolean;
  sessionViewStatus: string;
  sessionViewSessions: any[];
  sessionViewSessionIndex: number;
  sessionViewSessionTitle: string;
  terminalSize: { columns: number; rows: number };
}

export interface AppActions {
  setViewMode: (mode: ViewMode) => void;
  setSelectedIndex: (idx: number) => void;
  toggleCollapsedGroup: (key: string) => void;
  setDetailView: (id: string | null) => void;
  enterSessionView: (instance: Instance) => void;
  exitSessionView: () => void;
  setSessionViewScrollOffset: (offset: number) => void;
  setSessionViewInputMode: (mode: boolean) => void;
  setSessionViewInputBuffer: (buffer: string) => void;
  setSessionViewConfirmAbort: (confirm: boolean) => void;
  setSessionViewError: (error: string | null) => void;
  setSessionViewConnecting: (connecting: boolean) => void;
  setSessionViewStatus: (status: string) => void;
  setSessionViewMessages: (messages: Message[]) => void;
  setSessionViewRenderedLines: (lines: RenderedLine[]) => void;
  setSessionViewSessions: (sessions: any[]) => void;
  setSessionViewSessionIndex: (idx: number) => void;
  setSessionViewSessionTitle: (title: string) => void;
  addPermission: (permission: Permission) => void;
  removePermission: (id: string) => void;
  tick: (now?: number) => void;

  updateServers: (servers: Server[]) => void;
  updateSessions: (sessions: Session[]) => void;
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const AppStateContext = createContext<AppState | null>(null);
const ViewStateContext = createContext<ViewState | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);
const TimeContext = createContext<number>(Date.now());

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used within AppProvider");
  return context;
}

export function useViewState(): ViewState {
  const context = useContext(ViewStateContext);
  if (!context) throw new Error("useViewState must be used within AppProvider");
  return context;
}

export function useAppActions(): AppActions {
  const context = useContext(AppActionsContext);
  if (!context)
    throw new Error("useAppActions must be used within AppProvider");
  return context;
}

export function useTime(): number {
  return useContext(TimeContext);
}

/**
 * Hook for SDK-driven session status helpers
 */
export function useSessionHelpers() {
  const { sessions, servers } = useAppState();
  const currentTime = useTime();

  const getSessionStatus = useCallback(
    (sessionId: string): "idle" | "busy" | "pending" | "disconnected" => {
      const session = sessions.get(sessionId);
      if (!session) return "idle";

      const server = Array.from(servers.values()).find(
        (s) => s.serverUrl === session.serverUrl,
      );
      if (server && server.status === "disconnected") return "disconnected";

      if (session.pendingPermission) return "pending";

      const status = String(session.status).toLowerCase();
      if (status === "running" || status === "busy") return "busy";
      if (status === "pending" || status === "retry") return "pending";
      return "idle";
    },
    [sessions, servers],
  );

  const isSessionLongRunning = useCallback(
    (sessionId: string): boolean => {
      const session = sessions.get(sessionId);
      if (!session || !session.busySince) return false;
      return currentTime - session.busySince > LONG_RUNNING_MS;
    },
    [sessions, currentTime],
  );

  const getSessionBusyDuration = useCallback(
    (sessionId: string): number => {
      const session = sessions.get(sessionId);
      if (!session || !session.busySince) return 0;
      return currentTime - session.busySince;
    },
    [sessions, currentTime],
  );

  const getServerStatus = useCallback(
    (serverUrl: string): "connecting" | "connected" | "disconnected" => {
      const server = servers.get(serverUrl);
      return server?.status || "disconnected";
    },
    [servers],
  );

  const getServerDisconnectedDuration = useCallback(
    (serverUrl: string): number => {
      const server = servers.get(serverUrl);
      if (!server || server.status !== "disconnected" || !server.disconnectedAt)
        return 0;
      return currentTime - server.disconnectedAt;
    },
    [servers, currentTime],
  );

  return {
    getSessionStatus,
    isSessionLongRunning,
    getSessionBusyDuration,
    getServerStatus,
    getServerDisconnectedDuration,
  };
}

// Legacy hook for compatibility
export function useApp(): {
  state: AppState & ViewState & { currentTime: number };
  actions: AppActions;
} {
  const appState = useAppState();
  const viewState = useViewState();
  const actions = useAppActions();
  const currentTime = useTime();
  return { state: { ...appState, ...viewState, currentTime }, actions };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const { stdout } = useStdout();
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  const [servers, setServers] = useState<Map<string, Server>>(new Map());
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());

  const [viewMode, setViewModeInternal] = useState<ViewMode>("grouped");
  const [selectedIndex, setSelectedIndexInternal] = useState(-1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [detailView, setDetailViewInternal] = useState<string | null>(null);

  const [sessionViewActive, setSessionViewActive] = useState(false);
  const [sessionViewInstance, setSessionViewInstance] =
    useState<Instance | null>(null);
  const [sessionViewSessionID, setSessionViewSessionID] = useState<
    string | null
  >(null);
  const [sessionViewMessages, setSessionViewMessagesInternal] = useState<
    Message[]
  >([]);
  const [sessionViewScrollOffset, setSessionViewScrollOffsetInternal] =
    useState(0);
  const [sessionViewRenderedLines, setSessionViewRenderedLinesInternal] =
    useState<RenderedLine[]>([]);
  const [sessionViewPendingPermissions, setSessionViewPendingPermissions] =
    useState<Map<string, Permission>>(new Map());
  const [sessionViewInputMode, setSessionViewInputModeInternal] =
    useState(false);
  const [sessionViewInputBuffer, setSessionViewInputBufferInternal] =
    useState("");
  const [sessionViewConfirmAbort, setSessionViewConfirmAbortInternal] =
    useState(false);
  const [sessionViewError, setSessionViewErrorInternal] = useState<
    string | null
  >(null);
  const [sessionViewConnecting, setSessionViewConnectingInternal] =
    useState(false);
  const [sessionViewStatus, setSessionViewStatusInternal] = useState("idle");
  const [sessionViewSessions, setSessionViewSessionsInternal] = useState<any[]>(
    [],
  );
  const [sessionViewSessionIndex, setSessionViewSessionIndexInternal] =
    useState(0);
  const [sessionViewSessionTitle, setSessionViewSessionTitleInternal] =
    useState("");
  const [terminalSize, setTerminalSize] = useState({
    columns: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setTerminalSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  const tick = useCallback(
    (now?: number) => setCurrentTime(now || Date.now()),
    [],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => setViewModeInternal(mode),
    [],
  );
  const setSelectedIndex = useCallback(
    (idx: number) => setSelectedIndexInternal(idx),
    [],
  );
  const toggleCollapsedGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const setDetailView = useCallback(
    (id: string | null) => setDetailViewInternal(id),
    [],
  );

  const enterSessionView = useCallback((instance: Instance) => {
    setSessionViewActive(true);
    setSessionViewInstance(instance);
    setSessionViewSessionID(instance.sessionID || null);
    setSessionViewConnectingInternal(true);
    setSessionViewMessagesInternal([]);
    setSessionViewScrollOffsetInternal(0);
    setSessionViewRenderedLinesInternal([]);
    setSessionViewPendingPermissions(new Map());
    setSessionViewInputModeInternal(false);
    setSessionViewInputBufferInternal("");
    setSessionViewConfirmAbortInternal(false);
    setSessionViewErrorInternal(null);
    setSessionViewStatusInternal(String(instance.status || "idle"));
    setSessionViewSessionsInternal([]);
    setSessionViewSessionIndexInternal(0);
    setSessionViewSessionTitleInternal("");
  }, []);

  const exitSessionView = useCallback(() => {
    setSessionViewActive(false);
    setSessionViewInstance(null);
    setSessionViewSessionID(null);
    setSessionViewConnectingInternal(false);
    setSessionViewMessagesInternal([]);
    setSessionViewScrollOffsetInternal(0);
    setSessionViewRenderedLinesInternal([]);
    setSessionViewPendingPermissions(new Map());
    setSessionViewInputModeInternal(false);
    setSessionViewInputBufferInternal("");
    setSessionViewConfirmAbortInternal(false);
    setSessionViewErrorInternal(null);
    setSessionViewStatusInternal("idle");
    setSessionViewSessionsInternal([]);
    setSessionViewSessionIndexInternal(0);
    setSessionViewSessionTitleInternal("");
  }, []);

  const setSessionViewScrollOffset = useCallback(
    (offset: number) => setSessionViewScrollOffsetInternal(offset),
    [],
  );
  const setSessionViewInputMode = useCallback(
    (mode: boolean) => setSessionViewInputModeInternal(mode),
    [],
  );
  const setSessionViewInputBuffer = useCallback(
    (buffer: string) => setSessionViewInputBufferInternal(buffer),
    [],
  );
  const setSessionViewConfirmAbort = useCallback(
    (confirm: boolean) => setSessionViewConfirmAbortInternal(confirm),
    [],
  );
  const setSessionViewError = useCallback(
    (error: string | null) => setSessionViewErrorInternal(error),
    [],
  );
  const setSessionViewConnecting = useCallback(
    (connecting: boolean) => setSessionViewConnectingInternal(connecting),
    [],
  );
  const setSessionViewStatus = useCallback(
    (status: string) => setSessionViewStatusInternal(status),
    [],
  );
  const setSessionViewMessages = useCallback((messages: Message[]) => {
    setSessionViewMessagesInternal(messages);
  }, []);
  const setSessionViewRenderedLines = useCallback(
    (lines: RenderedLine[]) => setSessionViewRenderedLinesInternal(lines),
    [],
  );
  const setSessionViewSessions = useCallback(
    (sessions: any[]) => setSessionViewSessionsInternal(sessions),
    [],
  );
  const setSessionViewSessionIndex = useCallback(
    (idx: number) => setSessionViewSessionIndexInternal(idx),
    [],
  );
  const setSessionViewSessionTitle = useCallback(
    (title: string) => setSessionViewSessionTitleInternal(title),
    [],
  );

  const addPermission = useCallback((permission: Permission) => {
    setSessionViewPendingPermissions((prev) =>
      new Map(prev).set(permission.id, permission),
    );
  }, []);

  const removePermission = useCallback((id: string) => {
    setSessionViewPendingPermissions((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateServers = useCallback((serverList: Server[]) => {
    setServers(new Map(serverList.map((s) => [s.serverUrl, s])));
  }, []);

  const updateSessions = useCallback((sessionList: Session[]) => {
    setSessions(new Map(sessionList.map((s) => [s.id, s])));
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      setViewMode,
      setSelectedIndex,
      toggleCollapsedGroup,
      setDetailView,
      enterSessionView,
      exitSessionView,
      setSessionViewScrollOffset,
      setSessionViewInputMode,
      setSessionViewInputBuffer,
      setSessionViewConfirmAbort,
      setSessionViewError,
      setSessionViewConnecting,
      setSessionViewStatus,
      setSessionViewMessages,
      setSessionViewRenderedLines,
      setSessionViewSessions,
      setSessionViewSessionIndex,
      setSessionViewSessionTitle,
      addPermission,
      removePermission,
      tick,
      updateServers,
      updateSessions,
    }),
    [
      setViewMode,
      setSelectedIndex,
      toggleCollapsedGroup,
      setDetailView,
      enterSessionView,
      exitSessionView,
      setSessionViewScrollOffset,
      setSessionViewInputMode,
      setSessionViewInputBuffer,
      setSessionViewConfirmAbort,
      setSessionViewError,
      setSessionViewConnecting,
      setSessionViewStatus,
      setSessionViewMessages,
      setSessionViewRenderedLines,
      setSessionViewSessions,
      setSessionViewSessionIndex,
      setSessionViewSessionTitle,
      addPermission,
      removePermission,
      tick,
      updateServers,
      updateSessions,
    ],
  );

  const appState = useMemo<AppState>(
    () => ({ servers, sessions }),
    [servers, sessions],
  );

  const viewState = useMemo<ViewState>(
    () => ({
      viewMode,
      selectedIndex,
      collapsedGroups,
      detailView,
      sessionViewActive,
      sessionViewInstance,
      sessionViewSessionID,
      sessionViewMessages,
      sessionViewScrollOffset,
      sessionViewRenderedLines,
      sessionViewPendingPermissions,
      sessionViewInputMode,
      sessionViewInputBuffer,
      sessionViewConfirmAbort,
      sessionViewError,
      sessionViewConnecting,
      sessionViewStatus,
      sessionViewSessions,
      sessionViewSessionIndex,
      sessionViewSessionTitle,
      terminalSize,
    }),
    [
      viewMode,
      selectedIndex,
      collapsedGroups,
      detailView,
      sessionViewActive,
      sessionViewInstance,
      sessionViewSessionID,
      sessionViewMessages,
      sessionViewScrollOffset,
      sessionViewRenderedLines,
      sessionViewPendingPermissions,
      sessionViewInputMode,
      sessionViewInputBuffer,
      sessionViewConfirmAbort,
      sessionViewError,
      sessionViewConnecting,
      sessionViewStatus,
      sessionViewSessions,
      sessionViewSessionIndex,
      sessionViewSessionTitle,
      terminalSize,
    ],
  );

  return (
    <AppActionsContext.Provider value={actions}>
      <AppStateContext.Provider value={appState}>
        <ViewStateContext.Provider value={viewState}>
          <TimeContext.Provider value={currentTime}>
            {children}
          </TimeContext.Provider>
        </ViewStateContext.Provider>
      </AppStateContext.Provider>
    </AppActionsContext.Provider>
  );
}
