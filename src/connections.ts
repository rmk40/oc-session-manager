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

  // From SDK
  title?: string;
  status: "idle" | "running" | "pending";
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

function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''");
}

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
// SDK Loading
// ---------------------------------------------------------------------------

let createOpencodeClient: any = null;

export async function initSdk(): Promise<boolean> {
  if (createOpencodeClient) return true;

  try {
    const sdk = await import("@opencode-ai/sdk");
    createOpencodeClient = sdk.createOpencodeClient;
    return true;
  } catch {
    console.error("[connections] Failed to load @opencode-ai/sdk");
    return false;
  }
}

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

    const existing = this.servers.get(serverUrl);
    if (existing) {
      // Update last announce time
      existing.lastAnnounce = packet.ts || Date.now();
      existing.project = packet.project;
      existing.branch = packet.branch;
      existing.directory = packet.directory;
      return;
    }

    // New server - add and connect
    const server: Server = {
      serverUrl,
      instanceId,
      project: packet.project,
      directory: packet.directory,
      branch: packet.branch,
      status: "connecting",
      lastAnnounce: packet.ts || Date.now(),
      reconnectAttempts: 0,
    };

    this.servers.set(serverUrl, server);
    this.debugLog(`New server: ${serverUrl}`);

    // Connect asynchronously
    this.connectToServer(server);
  }

  /**
   * Handle a shutdown packet from UDP
   */
  handleShutdown(packet: ShutdownPacket): void {
    // Find server by instanceId
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
    const server = this.servers.get(serverUrl);
    if (!server) return;

    this.debugLog(`Removing server: ${serverUrl}`);

    // Abort SSE connection
    if (server.eventAbort) {
      server.eventAbort.abort();
    }

    // Remove sessions from this server
    for (const [id, session] of this.sessions) {
      if (session.serverUrl === serverUrl) {
        this.sessions.delete(id);
      }
    }

    this.servers.delete(serverUrl);
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
    return this.servers.get(serverUrl);
  }

  // ---------------------------------------------------------------------------
  // Connection Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Connect to an OpenCode server
   */
  private async connectToServer(server: Server): Promise<void> {
    if (!createOpencodeClient) {
      const loaded = await initSdk();
      if (!loaded) {
        server.status = "disconnected";
        server.disconnectedAt = Date.now();
        this.notifyConnectionChange(server.serverUrl, "disconnected");
        return;
      }
    }

    try {
      server.status = "connecting";
      this.notifyConnectionChange(server.serverUrl, "connecting");

      // Create SDK client
      server.client = createOpencodeClient({ baseUrl: server.serverUrl });

      // Fetch initial sessions
      await this.fetchSessions(server);

      // Subscribe to SSE events
      await this.subscribeToEvents(server);

      server.status = "connected";
      server.reconnectAttempts = 0;
      this.notifyConnectionChange(server.serverUrl, "connected");
      this.debugLog(`Connected to ${server.serverUrl}`);
    } catch (err: any) {
      this.debugLog(`Connection failed to ${server.serverUrl}: ${err.message}`);
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
      const current = this.servers.get(server.serverUrl);
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
      // The SDK returns an async iterator for SSE
      for await (const event of response) {
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
      case "session.created":
        if (sessionId) {
          this.fetchSession(server, sessionId);
        }
        break;

      case "session.deleted":
        if (sessionId) {
          this.sessions.delete(sessionId);
          this.notifySessionsUpdate(server);
        }
        break;

      case "session.status":
      case "session.idle":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const oldStatus = session.status;
            const newStatus = (event.properties?.status as string) || "idle";
            session.status = newStatus as "idle" | "running" | "pending";

            // Track busy start time
            if (
              (newStatus === "running" || newStatus === "pending") &&
              !session.busySince
            ) {
              session.busySince = Date.now();
            } else if (newStatus === "idle") {
              // Notify on busy -> idle transition
              if (oldStatus === "running" || oldStatus === "pending") {
                showDesktopNotification(
                  "OpenCode",
                  `${server.project}:${server.branch}`,
                  session.title || "Session is idle",
                );
              }
              session.busySince = undefined;
            }

            this.notifySessionsUpdate(server);
          }
        }
        break;

      case "session.updated":
        if (sessionId) {
          this.fetchSession(server, sessionId);
        }
        break;

      case "permission.updated":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            const tool = event.properties?.tool as string;
            session.pendingPermission = {
              id: event.properties?.permissionID as string,
              tool,
              args: event.properties?.args as Record<string, unknown>,
              message: event.properties?.message as string,
            };

            // Notify about permission request
            showDesktopNotification(
              "OpenCode - Permission Required",
              `${server.project}:${server.branch}`,
              `Tool: ${tool}`,
            );

            this.notifySessionsUpdate(server);
          }
        }
        break;

      case "permission.replied":
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.pendingPermission = undefined;
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

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Fetch all sessions from a server
   */
  private async fetchSessions(server: Server): Promise<void> {
    if (!server.client) return;

    try {
      const response = await server.client.session.list();
      const sessions = response.data || [];

      for (const sessionData of sessions) {
        const session: Session = {
          id: sessionData.id,
          serverUrl: server.serverUrl,
          parentID: sessionData.parentID,
          title: sessionData.title,
          status: sessionData.status || "idle",
          directory: sessionData.directory,
        };

        // Track busy start time
        if (session.status === "running" || session.status === "pending") {
          session.busySince = Date.now();
        }

        this.sessions.set(session.id, session);

        // Fetch children recursively
        await this.fetchChildren(server, session.id);
      }

      this.notifySessionsUpdate(server);
    } catch (err: any) {
      this.debugLog(
        `Failed to fetch sessions from ${server.serverUrl}: ${err.message}`,
      );
    }
  }

  /**
   * Fetch a single session
   */
  private async fetchSession(server: Server, sessionId: string): Promise<void> {
    if (!server.client) return;

    try {
      const response = await server.client.session.get({
        path: { id: sessionId },
      });
      const sessionData = response.data;
      if (!sessionData) return;

      const existing = this.sessions.get(sessionId);
      const session: Session = {
        id: sessionData.id,
        serverUrl: server.serverUrl,
        parentID: sessionData.parentID,
        title: sessionData.title,
        status: sessionData.status || "idle",
        directory: sessionData.directory,
        // Preserve local state
        busySince: existing?.busySince,
        pendingPermission: existing?.pendingPermission,
        cost: existing?.cost,
        tokens: existing?.tokens,
        model: existing?.model,
        statsUpdatedAt: existing?.statsUpdatedAt,
      };

      // Track busy start time
      if (
        (session.status === "running" || session.status === "pending") &&
        !session.busySince
      ) {
        session.busySince = Date.now();
      } else if (session.status === "idle") {
        session.busySince = undefined;
      }

      this.sessions.set(session.id, session);
      this.notifySessionsUpdate(server);

      // Fetch children
      await this.fetchChildren(server, sessionId);
    } catch (err: any) {
      this.debugLog(`Failed to fetch session ${sessionId}: ${err.message}`);
    }
  }

  /**
   * Fetch child sessions recursively
   */
  private async fetchChildren(server: Server, parentId: string): Promise<void> {
    if (!server.client) return;

    try {
      const response = await server.client.session.children({
        path: { id: parentId },
      });
      const children = response.data || [];

      for (const childData of children) {
        const existing = this.sessions.get(childData.id);
        const session: Session = {
          id: childData.id,
          serverUrl: server.serverUrl,
          parentID: childData.parentID || parentId,
          title: childData.title,
          status: childData.status || "idle",
          directory: childData.directory,
          busySince: existing?.busySince,
          pendingPermission: existing?.pendingPermission,
        };

        if (
          (session.status === "running" || session.status === "pending") &&
          !session.busySince
        ) {
          session.busySince = Date.now();
        }

        this.sessions.set(session.id, session);

        // Recursively fetch grandchildren
        await this.fetchChildren(server, childData.id);
      }
    } catch (err: any) {
      this.debugLog(`Failed to fetch children of ${parentId}: ${err.message}`);
    }
  }

  /**
   * Refresh sessions from all servers
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
    return Array.from(this.sessions.values()).filter(
      (s) => s.serverUrl === serverUrl,
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
 *
 * Provides reactive state that updates when servers/sessions change.
 * Manages lifecycle (cleanup on unmount).
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
