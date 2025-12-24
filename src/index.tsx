#!/usr/bin/env node

// oc-session-manager - TUI dashboard for monitoring OpenCode sessions
//
// Usage:
//   oc-session-manager              Run TUI display
//   oc-session-manager --daemon     Run as background daemon (notifications only)
//   oc-session-manager --status     Check if daemon is running
//   oc-session-manager --stop       Stop the daemon
//   oc-session-manager --debug      Show raw UDP packets
//   oc-session-manager --debug-sse  Log SSE events to stderr
//   oc-session-manager --debug-state Periodic state dump to stderr
//
// Environment variables:
//   OC_SESSION_PORT         - UDP port to listen on (default: 19876)
//   OC_SESSION_TIMEOUT      - Seconds before instance considered stale (default: 120)
//   OC_SESSION_LONG_RUNNING - Minutes before busy instance flagged as long-running (default: 10)

import React from "react";
import { render } from "ink";
import { App, AppProvider } from "./components/index.js";
import { PORT, DEBUG_FLAGS } from "./config.js";
import {
  checkDaemon,
  handleDaemon,
  handleStatus,
  handleStop,
  isDaemonChild,
  initDaemonChild,
  logDaemon,
} from "./daemon.js";
import { createSocket, type Socket } from "node:dgram";
import type { Instance } from "./types.js";

import { initSdk } from "./sdk.js";

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const isDaemon = args.includes("--daemon");
const isStatus = args.includes("--status");
const isStop = args.includes("--stop");
const isDaemonChildProcess = isDaemonChild();

// DEBUG_FLAGS imported from config.ts (parsed from CLI args)

// ---------------------------------------------------------------------------
// UDP Server with Ink Integration
// ---------------------------------------------------------------------------

function startUdpServer(
  setInstance: (id: string, instance: Instance) => void,
  removeInstance: (id: string) => void,
  options: { debug?: boolean } = {},
  onAnnounce?: (packet: AnnouncePacket) => void,
  onShutdown?: (packet: ShutdownPacket) => void,
): Socket {
  const isDebugMode = options.debug || false;
  const daemon = isDaemonChildProcess;

  const socket = createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString()) as Instance & { type: string };

      if (isDebugMode) {
        console.log(`[DEBUG] Received from ${rinfo.address}:${rinfo.port}:`);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Handle new oc.announce format (server discovery only)
      if (data.type === "oc.announce" && data.serverUrl) {
        if (DEBUG_FLAGS.udp) {
          console.error(
            `[UDP] Announce from ${data.instanceId}: ${data.serverUrl}`,
          );
        }

        // Route to ConnectionManager if available
        if (onAnnounce) {
          onAnnounce(data as unknown as AnnouncePacket);
        } else {
          // Fallback: create placeholder instance (legacy behavior)
          setInstance(data.instanceId, {
            instanceId: data.instanceId,
            status: "idle",
            project: data.project,
            directory: data.directory,
            dirName: data.project,
            branch: data.branch,
            serverUrl: data.serverUrl,
            ts: data.ts || Date.now(),
          } as Instance);
        }
        return;
      }

      // Handle oc.shutdown
      if (data.type === "oc.shutdown" && data.instanceId) {
        if (onShutdown) {
          onShutdown(data as unknown as ShutdownPacket);
        }
        removeInstance(data.instanceId);
        return;
      }

      // Handle legacy oc.status format
      if (data.type === "oc.status" && data.instanceId) {
        // Use composite key: instanceId + sessionID to differentiate parent from child sessions
        // Child sessions (sub-agents) share the same process but have different sessionIDs
        const instanceKey = data.sessionID
          ? `${data.instanceId}:${data.sessionID}`
          : data.instanceId;

        if (data.status === "shutdown") {
          removeInstance(instanceKey);
          return;
        }

        // Update instance with composite key
        setInstance(instanceKey, {
          ...data,
          instanceId: instanceKey, // Use composite key for consistency
          ts: data.ts || Date.now(),
          _isChildSession: !!data.parentID,
        });
      }
    } catch (err: any) {
      if (daemon) {
        logDaemon(`Parse error: ${err.message}`);
      }
    }
  });

  socket.on("listening", () => {
    const addr = socket.address();
    if (daemon) {
      logDaemon(`Listening on UDP ${addr.address}:${addr.port}`);
    }
    // Note: Don't console.log in TUI mode - it causes full re-renders and flickering
  });

  socket.on("error", (err) => {
    if (daemon) {
      logDaemon(`Socket error: ${err.message}`);
    } else {
      console.error("Socket error:", err.message);
    }
    socket.close();
    process.exit(1);
  });

  socket.bind(PORT);

  return socket;
}

// ---------------------------------------------------------------------------
// Wrapper Component for UDP Integration
// ---------------------------------------------------------------------------

import { useAppActions } from "./components/index.js";
import {
  useConnectionManager,
  type AnnouncePacket,
  type ShutdownPacket,
} from "./connections.js";

function AppWithUdp(): React.ReactElement {
  const { setInstance, removeInstance, updateServers, updateSessions } =
    useAppActions();
  const { handleAnnounce, handleShutdown, state } = useConnectionManager();

  // Sync ConnectionManager state to AppContext
  React.useEffect(() => {
    updateServers(state.servers);
    updateSessions(state.sessions);
  }, [state.servers, state.sessions, updateServers, updateSessions]);

  // Bridge ConnectionManager sessions to legacy instance state
  // This allows existing UI components to work during the transition
  React.useEffect(() => {
    for (const session of state.sessions) {
      // Find the server for this session
      const server = state.servers.find(
        (s) => s.serverUrl === session.serverUrl,
      );
      if (!server) continue;

      // Create a legacy-compatible instance
      setInstance(session.id, {
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
        ts: Date.now(),
        cost: session.cost,
        tokens: session.tokens,
        model: session.model,
        _isChildSession: !!session.parentID,
      } as Instance);
    }
  }, [state.sessions, state.servers, setInstance]);

  // Start UDP server on mount
  // setInstance and removeInstance are stable (from useAppActions)
  React.useEffect(() => {
    const socket = startUdpServer(
      setInstance,
      removeInstance,
      {},
      handleAnnounce,
      handleShutdown,
    );

    return () => {
      socket.close();
    };
  }, [setInstance, removeInstance, handleAnnounce, handleShutdown]);

  return <App />;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Handle CLI commands
  if (isStatus) {
    handleStatus();
    return;
  }

  if (isStop) {
    handleStop();
    return;
  }

  if (isDaemon) {
    handleDaemon();
    return;
  }

  // Initialize SDK
  await initSdk();

  // Debug mode - just show raw packets
  if (DEBUG_FLAGS.udp) {
    console.log("Debug mode: showing raw UDP packets");
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log(`[DEBUG] Received from ${rinfo.address}:${rinfo.port}:`);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error("Parse error:", err.message);
      }
    });
    socket.on("listening", () => {
      const addr = socket.address();
      console.log(`Listening on UDP ${addr.address}:${addr.port}`);
    });
    socket.bind(PORT);
    return;
  }

  // Daemon child process
  if (isDaemonChildProcess) {
    initDaemonChild();
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "oc.status") {
          // Just log for daemon mode
          logDaemon(`Status: ${data.instanceId} -> ${data.status}`);
        }
      } catch (err: any) {
        logDaemon(`Parse error: ${err.message}`);
      }
    });
    socket.bind(PORT);
    return;
  }

  // Normal TUI mode
  checkDaemon();

  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    console.error("Error: stdin is not a TTY. Run in an interactive terminal.");
    process.exit(1);
  }

  // Render the Ink app
  const { waitUntilExit } = render(
    <AppProvider>
      <AppWithUdp />
    </AppProvider>,
    {
      incrementalRendering: true,
      patchConsole: true,
    },
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
