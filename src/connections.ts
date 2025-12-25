// Connection Manager - Manages SSE connections to OpenCode servers
//
// This module handles:
// - Tracking known OpenCode servers (from UDP announcements)
// - Maintaining SSE connections to each server
// - Auto-reconnection with exponential backoff
// - Session state from SDK queries
// - Desktop notifications for status changes

import { DEBUG_FLAGS, NOTIFY_ENABLED } from "./config.js";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { appendFileSync } from "node:fs";
import { getOpencodeClient, initSdk as initSdkFromSdk } from "./sdk.js";
import { escapeShell } from "./utils.js";

function trace(msg: string) {
  if (DEBUG_FLAGS.state) {
    try {
      appendFileSync(
        "/tmp/oc-session-manager-trace.log",
        `[${new Date().toISOString()}] ${msg}\n`,
      );
    } catch {}
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    if (host === "localhost") host = "127.0.0.1";
    const port = u.port ? `:${u.port}` : "";
    return `${u.protocol}//${host}${port}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnouncePacket {
  type: "oc.announce";
  serverUrl: string;
  project: string;
  directory: string;
  branch: string;
  instanceId: string;
  ts: number;
}

export interface ShutdownPacket {
  type: "oc.shutdown";
  instanceId: string;
  ts: number;
}

export interface Server {
  serverUrl: string;
  instanceId: string;
  project: string;
  directory: string;
  branch: string;

  // Connection state
  status: "connecting" | "connected" | "disconnected";
  disconnectedAt?: number;
  lastAnnounce: number;
  reconnectAttempts: number;

  // SDK connection
  client?: any; // OpencodeClient - dynamically loaded
  eventAbort?: AbortController;
}

export interface Session {
  id: string;
  serverUrl: string;
  parentID?: string;

  // From SDK/SSE
  title?: string;
  status: "idle" | "busy" | "running" | "pending";
  directory?: string;

  // Tracked locally
  busySince?: number;
  pendingPermission?: {
    id: string;
    tool: string;
    args?: Record<string, unknown>;
    message?: string;
  };

  // Stats
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  model?: string;
  statsUpdatedAt?: number;
  discoveredAt: number;
}

export interface SSEEvent {
  type: string;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds
const STALE_SERVER_TIMEOUT = 180000; // 3 minutes
const SESSION_REFRESH_INTERVAL = 30000; // 30 seconds

// ---------------------------------------------------------------------------
// Desktop Notifications
// ---------------------------------------------------------------------------

function showDesktopNotification(
  title: string,
  subtitle: string,
  message: string,
): void {
  if (!NOTIFY_ENABLED) return;

  const os = platform();

  if (os === "darwin") {
    const script = `display notification "${escapeShell(message)}" with title "${escapeShell(title)}" subtitle "${escapeShell(subtitle)}"`;
    exec(`osascript -e '${script}'`, () => {});
  } else if (os === "linux") {
    exec(
      `notify-send "${escapeShell(title)}" "${escapeShell(subtitle)}: ${escapeShell(message)}"`,
      () => {},
    );
  }
}

// ---------------------------------------------------------------------------
// SDK Loading (uses shared SDK from sdk.ts)
// ---------------------------------------------------------------------------

// Re-export initSdk for backward compatibility
export { initSdk as initSdk } from "./sdk.js";

// ---------------------------------------------------------------------------
// Connection Manager Class
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type SessionEventCallback = (serverUrl: string, event: SSEEvent) => void;
export type ConnectionChangeCallback = (
  serverUrl: string,
  status: ConnectionStatus,
) => void;
export type SessionsUpdateCallback = (
  serverUrl: string,
  sessions: Session[],
) => void;

export class ConnectionManager {
  private servers = new Map<string, Server>();
  private sessions = new Map<string, Session>();
  private fetchingSessions = new Set<string>();
  private sessionEventCallbacks: SessionEventCallback[] = [];
  private connectionChangeCallbacks: ConnectionChangeCallback[] = [];
  private sessionsUpdateCallbacks: SessionsUpdateCallback[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval to remove stale servers
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleServers();
    }, 30000);

    // Start refresh interval to periodically update sessions
    this.refreshInterval = setInterval(() => {
      this.refreshAllSessions();
    }, SESSION_REFRESH_INTERVAL);
  }

  // ---------------------------------------------------------------------------
  // Server Management
  // ---------------------------------------------------------------------------

  /**
   * Handle an announce packet from UDP
   */
  async handleAnnounce(packet: AnnouncePacket): Promise<void> {
    const { serverUrl, instanceId } = packet;

    if (!serverUrl) {
      this.debugLog(`Announce from ${instanceId} has no serverUrl, ignoring`);
      return;
    }

    const normUrl = normalizeUrl(serverUrl);
    const existing = this.servers.get(normUrl);

    if (existing) {
      // Detect restart: instanceId changed for the same URL
      if (
        existing.instanceId &&
        instanceId &&
        existing.instanceId !== instanceId
      ) {
        this.debugLog(
          `Server ${normUrl} restarted (ID ${existing.instanceId} -> ${instanceId})`,
        );
        this.removeServer(normUrl);
        // Fall through to create new server entry
      } else {
        // Update last announce time
        existing.lastAnnounce = packet.ts || Date.now();
        existing.project = packet.project;
        existing.branch = packet.branch;
        existing.directory = packet.directory;
        existing.instanceId = instanceId;
        return;
      }
    }

    // New server (or restart) - add and connect
    const server: Server = {
      serverUrl: normUrl,
      instanceId,
      project: packet.project,
      directory: packet.directory,
      branch: packet.branch,
      status: "connecting",
      lastAnnounce: packet.ts || Date.now(),
      reconnectAttempts: 0,
    };

    this.servers.set(normUrl, server);
    this.debugLog(`New server: ${normUrl} - connecting...`);

    // Connect asynchronously
    this.connectToServer(server);
  }

  /**
   * Handle a shutdown packet from UDP
   */
  handleShutdown(packet: ShutdownPacket): void {
    // Find server by instanceId or URL (though URL is primary key now)
    for (const [url, server] of this.servers) {
      if (server.instanceId === packet.instanceId) {
        this.removeServer(url);
        break;
      }
    }
  }

  /**
   * Remove a server and clean up
   */
  removeServer(serverUrl: string): void {
    const normUrl = normalizeUrl(serverUrl);
    const server = this.servers.get(normUrl);
    if (!server) return;

    this.debugLog(`Removing server: ${normUrl}`);

    // Abort SSE connection
    if (server.eventAbort) {
      server.eventAbort.abort();
    }

    // Remove sessions from this server
    for (const [id, session] of this.sessions) {
      if (normalizeUrl(session.serverUrl) === normUrl) {
        trace(`Deleting session ${id} because server ${normUrl} was removed`);
        this.sessions.delete(id);
      }
    }

    this.servers.delete(normUrl);
  }

  /**
   * Get all known servers
   */
  getServers(): Server[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get a server by URL
   */
  getServer(serverUrl: string): Server | undefined {
    return this.servers.get(normalizeUrl(serverUrl));
  }

  // ---------------------------------------------------------------------------
  // Connection Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Connect to an OpenCode server
   */
  private async connectToServer(server: Server): Promise<void> {
    // Ensure SDK is initialized
    const loaded = await initSdkFromSdk();
    if (!loaded) {
      this.debugLog(`SDK not available, cannot connect to ${server.serverUrl}`);
      server.status = "disconnected";
      server.disconnectedAt = Date.now();
      this.notifyConnectionChange(server.serverUrl, "disconnected");
      return;
    }

    try {
      this.debugLog(`Connecting to ${server.serverUrl}...`);
      server.status = "connecting";
      this.notifyConnectionChange(server.serverUrl, "connecting");

      // Create SDK client
      server.client = getOpencodeClient(server.serverUrl);
      if (!server.client) {
        throw new Error("Failed to create SDK client");
      }
      this.debugLog(`SDK client created for ${server.serverUrl}`);

      // Fetch initial sessions
      await this.fetchSessions(server);

      // Subscribe to SSE events
      this.debugLog(`Subscribing to SSE events for ${server.serverUrl}...`);
      await this.subscribeToEvents(server);

      server.status = "connected";
      server.reconnectAttempts = 0;
      this.notifyConnectionChange(server.serverUrl, "connected");
      this.debugLog(`Connected to ${server.serverUrl} - SSE subscribed`);
    } catch (err: any) {
      this.debugLog(`Connection failed to ${server.serverUrl}: ${err.message}`);
      if (err.stack) {
        this.debugLog(
          `Stack: ${err.stack.split("\n").slice(0, 3).join(" | ")}`,
        );
      }
      server.status = "disconnected";
      server.disconnectedAt = Date.now();
      this.notifyConnectionChange(server.serverUrl, "disconnected");
      this.scheduleReconnect(server);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(server: Server): void {
    server.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, server.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY,
    );

    this.debugLog(
      `Scheduling reconnect to ${server.serverUrl} in ${delay}ms (attempt ${server.reconnectAttempts})`,
    );

    setTimeout(() => {
      // Only reconnect if server still exists and is still disconnected
      const current = this.servers.get(normalizeUrl(server.serverUrl));
      if (current && current.status === "disconnected") {
        this.connectToServer(current);
      }
    }, delay);
  }

  /**
   * Subscribe to SSE events from server
   */
  private async subscribeToEvents(server: Server): Promise<void> {
    if (!server.client) return;

    server.eventAbort = new AbortController();

    try {
      const response = await server.client.event.subscribe({
        signal: server.eventAbort.signal,
      });

      // Process SSE stream
      this.processSSEStream(server, response);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        this.debugLog(
          `SSE subscribe failed for ${server.serverUrl}: ${err.message}`,
        );
        throw err;
      }
    }
  }

  /**
   * Process SSE event stream
   */
  private async processSSEStream(server: Server, response: any): Promise<void> {
    try {
      // The SDK returns { stream: AsyncIterable } for SSE
      const stream = response.stream;
      if (!stream) {
        this.debugLog(`SSE response has no stream for ${server.serverUrl}`);
        throw new Error("SSE response has no stream property");
      }

      for await (const event of stream) {
        if (DEBUG_FLAGS?.sse) {
          console.error(`[SSE] ${server.serverUrl}: ${event.type}`);
        }

        this.handleSSEEvent(server, event);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        this.debugLog(
          `SSE stream error for ${server.serverUrl}: ${err.message}`,
        );
        server.status = "disconnected";
        server.disconnectedAt = Date.now();
        this.notifyConnectionChange(server.serverUrl, "disconnected");
        this.scheduleReconnect(server);
      }
    }
  }

  /**
   * Handle an SSE event
   */
  private handleSSEEvent(server: Server, event: SSEEvent): void {
    const sessionId = event.properties?.sessionID as string | undefined;

    switch (event.type) {
      case "server.connected":
        this.debugLog(`Server connected: ${server.serverUrl}`);
        break;

      case "session.status":
        if (sessionId) {
          const statusObj = event.properties?.status as any;
          const statusType = (
            typeof statusObj === "string"
              ? statusObj
              : statusObj?.type || "idle"
          ) as "idle" | "running" | "pending";

          const session = this.sessions.get(sessionId);
          if (session) {
            const wasActive =
              session.status === "running" ||
              session.status === "pending" ||
              session.status === "busy";

            // Create new object to ensure identity change for React
            const updatedSession: Session = {
              ...session,
              status: statusType,
            };

            // Notify on active -> idle transition
            if (wasActive && statusType === "idle") {
              showDesktopNotification(
                "OpenCode",
                `${server.project}:${server.branch}`,
                updatedSession.title || "Session is idle",
              );
            }

            if (statusType !== "idle" && !updatedSession.busySince) {
              updatedSession.busySince = Date.now();
            } else if (statusType === "idle") {
              updatedSession.busySince = undefined;
            }

            trace(`Updating session ${sessionId} status to ${statusType}`);
            this.sessions.set(sessionId, updatedSession);
            this.notifySessionsUpdate(server);
          } else if (statusType !== "idle") {
            // New active session - fetch details
            trace(
              `Discovered new active session ${sessionId} via status event`,
            );
            this.fetchSessionDetails(server, sessionId, statusType);
          }
        }
        break;

      case "session.idle":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const wasActive =
              session.status === "running" ||
              session.status === "pending" ||
              session.status === "busy";

            const updatedSession: Session = {
              ...session,
              status: "idle",
              busySince: undefined,
            };

            if (wasActive) {
              showDesktopNotification(
                "OpenCode",
                `${server.project}:${server.branch}`,
                updatedSession.title || "Session is idle",
              );
            }
            trace(
              `Updating session ${sessionId} to idle via session.idle event`,
            );
            this.sessions.set(sessionId, updatedSession);
            this.notifySessionsUpdate(server);
          }
        }
        break;

      case "session.updated":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const info = event.properties?.info as
              | { title?: string; parentID?: string; directory?: string }
              | undefined;
            if (info) {
              const updatedSession: Session = {
                ...session,
                title: info.title ?? session.title,
                parentID: info.parentID ?? session.parentID,
                directory: info.directory ?? session.directory,
              };
              trace(`Updating session ${sessionId} info`);
              this.sessions.set(sessionId, updatedSession);
              this.notifySessionsUpdate(server);
            }
          } else {
            // Discovered new session via update
            trace(
              `Discovered new session ${sessionId} via session.updated event`,
            );
            this.fetchSessionDetails(server, sessionId, "idle");
          }
        }
        break;

      case "session.deleted":
        if (sessionId) {
          trace(`Deleting session ${sessionId} due to session.deleted event`);
          this.sessions.delete(sessionId);
          this.notifySessionsUpdate(server);
        }
        break;

      case "permission.updated":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const tool = event.properties?.tool as string;
            const updatedSession: Session = {
              ...session,
              pendingPermission: {
                id: event.properties?.permissionID as string,
                tool,
                args: event.properties?.args as Record<string, unknown>,
                message: event.properties?.message as string,
              },
            };

            showDesktopNotification(
              "OpenCode - Permission Required",
              `${server.project}:${server.branch}`,
              `Tool: ${tool}`,
            );

            this.sessions.set(sessionId, updatedSession);
            this.notifySessionsUpdate(server);
          }
        }
        break;

      case "permission.replied":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const updatedSession: Session = {
              ...session,
              pendingPermission: undefined,
            };
            this.sessions.set(sessionId, updatedSession);
            this.notifySessionsUpdate(server);
          }
        }
        break;
    }

    // Notify all event listeners
    for (const callback of this.sessionEventCallbacks) {
      callback(server.serverUrl, event);
    }
  }

  /**
   * Fetch session details and stats
   */
  private async fetchSessionDetails(
    server: Server,
    sessionId: string,
    status: string,
  ): Promise<void> {
    if (!server.client) return;
    if (this.fetchingSessions.has(sessionId)) return;

    this.fetchingSessions.add(sessionId);

    try {
      const response = await server.client.session.get({
        path: { id: sessionId },
      });
      const data = response.data;
      if (!data) return;

      // Fetch stats if available
      let cost = 0;
      let tokens = { input: 0, output: 0, total: 0 };
      let model = "";

      try {
        const statsResp = await server.client.session.stats({
          path: { id: sessionId },
        });
        if (statsResp.data) {
          cost = statsResp.data.cost || 0;
          tokens = statsResp.data.tokens || tokens;
          model = statsResp.data.model || "";
        }
      } catch {
        // Stats might not be available yet
      }

      const session: Session = {
        id: data.id,
        serverUrl: server.serverUrl,
        parentID: data.parentID,
        title: data.title,
        status: status as any,
        directory: data.directory,
        busySince: status !== "idle" ? Date.now() : undefined,
        cost,
        tokens,
        model,
        statsUpdatedAt: Date.now(),
        discoveredAt: Date.now(),
      };

      trace(`Adding/updating session ${session.id} (${session.status})`);
      this.sessions.set(session.id, session);
      this.notifySessionsUpdate(server);
    } catch (err: any) {
      this.debugLog(
        `Failed to fetch session details ${sessionId}: ${err.message}`,
      );
    } finally {
      this.fetchingSessions.delete(sessionId);
    }
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const server = this.servers.get(normalizeUrl(session.serverUrl));
    if (!server || !server.client) return false;

    try {
      await server.client.session.abort({
        path: { id: sessionId },
      });
      return true;
    } catch (err: any) {
      this.debugLog(`Failed to abort session ${sessionId}: ${err.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Fetch initial active sessions from a server
   */
  private async fetchSessions(server: Server): Promise<void> {
    if (!server.client) return;

    try {
      this.debugLog(`Fetching initial sessions from ${server.serverUrl}...`);

      // 1. Get active sessions from status endpoint to know which are busy
      const statusResponse = await server.client.session
        .status()
        .catch(() => ({ data: {} }));
      const statusMap = statusResponse.data || {};

      // 2. Get all sessions from list endpoint
      const listResponse = await server.client.session
        .list()
        .catch(() => ({ data: [] }));
      const allSessions = (listResponse.data || []) as any[];
      const sessionMap = new Map<string, any>(
        allSessions.map((s) => [s.id, s]),
      );

      const activeSessionIds = new Set(Object.keys(statusMap));
      const relevantSessionIds = new Set<string>();

      // Heuristic: identify the "current" sessions attached to the TUI.
      // We want to show the active tree(s) and prune old idle branches.
      const RECENT_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
      const now = Date.now();

      // 1. First, include all active sessions and their ancestors
      for (const activeId of activeSessionIds) {
        relevantSessionIds.add(activeId);
        let curr = sessionMap.get(activeId);
        while (curr?.parentID) {
          relevantSessionIds.add(curr.parentID);
          curr = sessionMap.get(curr.parentID);
        }
      }

      // 2. Identify the latest root session for this directory
      const normDir = server.directory?.replace(/\/+$/, "");
      const matchingRoots = allSessions
        .filter(
          (s) => !s.parentID && s.directory?.replace(/\/+$/, "") === normDir,
        )
        .sort((a, b) => {
          const ta = a.time?.updated || a.time?.created || 0;
          const tb = b.time?.updated || b.time?.created || 0;
          return tb - ta;
        });

      if (matchingRoots.length > 0) {
        relevantSessionIds.add(matchingRoots[0].id);
      }

      // 3. For all sessions we've decided to keep so far, also include their
      // children if they are active OR were recently updated.
      // We do this iteratively to catch the whole active/recent tree.
      let added;
      do {
        added = false;
        for (const s of allSessions) {
          if (
            s.parentID &&
            relevantSessionIds.has(s.parentID) &&
            !relevantSessionIds.has(s.id)
          ) {
            const isActive = activeSessionIds.has(s.id);
            const isRecent =
              (s.time?.updated || s.time?.created || 0) >
              now - RECENT_IDLE_THRESHOLD_MS;

            if (isActive || isRecent) {
              relevantSessionIds.add(s.id);
              added = true;
            }
          }
        }
      } while (added);

      this.debugLog(
        `Server has ${allSessions.length} total sessions, keeping ${relevantSessionIds.size} relevant to current TUI context`,
      );

      // 4. Fetch details for all relevant sessions
      for (const sessionId of relevantSessionIds) {
        const statusObj = statusMap[sessionId];
        const status =
          typeof statusObj === "string" ? statusObj : statusObj?.type || "idle";

        await this.fetchSessionDetails(server, sessionId, status);
      }
    } catch (err: any) {
      this.debugLog(
        `Failed to fetch sessions from ${server.serverUrl}: ${err.message}`,
      );
    }
  }

  /**
   * Refresh sessions from all servers (periodic sync)
   */
  private async refreshAllSessions(): Promise<void> {
    for (const server of this.servers.values()) {
      if (server.status === "connected") {
        await this.fetchSessions(server);
      }
    }
  }

  /**
   * Get all sessions
   */
  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a server
   */
  getServerSessions(serverUrl: string): Session[] {
    const normUrl = normalizeUrl(serverUrl);
    return Array.from(this.sessions.values()).filter(
      (s) => normalizeUrl(s.serverUrl) === normUrl,
    );
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove servers that haven't announced recently
   */
  private cleanupStaleServers(): void {
    const now = Date.now();
    for (const [url, server] of this.servers) {
      if (now - server.lastAnnounce > STALE_SERVER_TIMEOUT) {
        this.debugLog(`Removing stale server: ${url}`);
        this.removeServer(url);
      }
    }
  }

  /**
   * Dispose of the connection manager
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    for (const server of this.servers.values()) {
      if (server.eventAbort) {
        server.eventAbort.abort();
      }
    }

    this.servers.clear();
    this.sessions.clear();
    this.fetchingSessions.clear();
  }

  // ---------------------------------------------------------------------------
  // Event Callbacks
  // ---------------------------------------------------------------------------

  onSessionEvent(callback: SessionEventCallback): void {
    this.sessionEventCallbacks.push(callback);
  }

  onConnectionChange(callback: ConnectionChangeCallback): void {
    this.connectionChangeCallbacks.push(callback);
  }

  onSessionsUpdate(callback: SessionsUpdateCallback): void {
    this.sessionsUpdateCallbacks.push(callback);
  }

  private notifyConnectionChange(
    serverUrl: string,
    status: ConnectionStatus,
  ): void {
    for (const callback of this.connectionChangeCallbacks) {
      callback(serverUrl, status);
    }
  }

  private notifySessionsUpdate(server: Server): void {
    const sessions = this.getServerSessions(server.serverUrl);
    for (const callback of this.sessionsUpdateCallbacks) {
      callback(server.serverUrl, sessions);
    }
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private debugLog(message: string): void {
    trace(`[debugLog] ${message}`);
    if (DEBUG_FLAGS?.sse || DEBUG_FLAGS?.state) {
      console.error(`[connections] ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

let connectionManager: ConnectionManager | null = null;

export function getConnectionManager(): ConnectionManager {
  if (!connectionManager) {
    connectionManager = new ConnectionManager();
  }
  return connectionManager;
}

export function disposeConnectionManager(): void {
  if (connectionManager) {
    connectionManager.dispose();
    connectionManager = null;
  }
}

// ---------------------------------------------------------------------------
// React Hook
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from "react";

export interface ConnectionState {
  servers: Server[];
  sessions: Session[];
}

/**
 * React hook for using the ConnectionManager
 */
export function useConnectionManager(): {
  state: ConnectionState;
  manager: ConnectionManager;
  handleAnnounce: (packet: AnnouncePacket) => void;
  handleShutdown: (packet: ShutdownPacket) => void;
} {
  const managerRef = useRef<ConnectionManager | null>(null);
  const [state, setState] = useState<ConnectionState>({
    servers: [],
    sessions: [],
  });

  // Initialize manager on mount
  useEffect(() => {
    const manager = getConnectionManager();
    managerRef.current = manager;

    // Update state when sessions change
    const updateState = () => {
      setState({
        servers: manager.getServers(),
        sessions: manager.getSessions(),
      });
    };

    // Subscribe to updates
    manager.onSessionsUpdate(() => {
      updateState();
    });

    manager.onConnectionChange(() => {
      updateState();
    });

    // Initial state
    updateState();

    // Cleanup on unmount
    return () => {
      disposeConnectionManager();
      managerRef.current = null;
    };
  }, []);

  const handleAnnounce = useCallback((packet: AnnouncePacket) => {
    managerRef.current?.handleAnnounce(packet);
  }, []);

  const handleShutdown = useCallback((packet: ShutdownPacket) => {
    managerRef.current?.handleShutdown(packet);
  }, []);

  return {
    state,
    manager: managerRef.current || getConnectionManager(),
    handleAnnounce,
    handleShutdown,
  };
}
