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
import { PORT } from "./config.js";
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

const isDebug = args.includes("--debug");
const isDebugSse = args.includes("--debug-sse");
const isDebugState = args.includes("--debug-state");
const isDaemon = args.includes("--daemon");
const isStatus = args.includes("--status");
const isStop = args.includes("--stop");
const isDaemonChildProcess = isDaemonChild();

// Export debug flags for use by other modules
export const DEBUG_FLAGS = {
  sse: isDebugSse,
  state: isDebugState,
  udp: isDebug,
};

// ---------------------------------------------------------------------------
// UDP Server with Ink Integration
// ---------------------------------------------------------------------------

function startUdpServer(
  setInstance: (id: string, instance: Instance) => void,
  removeInstance: (id: string) => void,
  options: { debug?: boolean } = {},
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
        // For now, create a placeholder instance from announce
        // This will be replaced by proper SDK-based state in Phase 3
        const instanceKey = data.instanceId;

        if (DEBUG_FLAGS.udp) {
          console.error(
            `[UDP] Announce from ${instanceKey}: ${data.serverUrl}`,
          );
        }

        setInstance(instanceKey, {
          instanceId: instanceKey,
          status: "idle", // Will be fetched from SDK
          project: data.project,
          directory: data.directory,
          dirName: data.project,
          branch: data.branch,
          serverUrl: data.serverUrl,
          ts: data.ts || Date.now(),
        } as Instance);
        return;
      }

      // Handle oc.shutdown
      if (data.type === "oc.shutdown" && data.instanceId) {
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

function AppWithUdp(): React.ReactElement {
  const { setInstance, removeInstance } = useAppActions();

  // Start UDP server on mount
  // setInstance and removeInstance are stable (from useAppActions)
  React.useEffect(() => {
    const socket = startUdpServer(setInstance, removeInstance);

    return () => {
      socket.close();
    };
  }, [setInstance, removeInstance]);

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
  if (isDebug) {
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
