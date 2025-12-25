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

import { initSdk } from "./sdk.js";

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const isDaemon = args.includes("--daemon");
const isStatus = args.includes("--status");
const isStop = args.includes("--stop");
const isHeadless = args.includes("--headless");
const isDaemonChildProcess = isDaemonChild();

// DEBUG_FLAGS imported from config.ts (parsed from CLI args)

// ---------------------------------------------------------------------------
// UDP Server with Ink Integration
// ---------------------------------------------------------------------------

function startUdpServer(
  onAnnounce?: (packet: AnnouncePacket) => void,
  onShutdown?: (packet: ShutdownPacket) => void,
): Socket {
  const daemon = isDaemonChildProcess;

  const socket = createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // Handle new oc.announce format (server discovery only)
      if (data.type === "oc.announce") {
        if (DEBUG_FLAGS.udp) {
          console.error(
            `[UDP] Announce from ${data.instanceId}: ${data.serverUrl || "(no serverUrl)"}`,
          );
        }

        // Route to ConnectionManager if serverUrl is available
        if (data.serverUrl && onAnnounce) {
          onAnnounce(data as unknown as AnnouncePacket);
        }
        return;
      }

      // Handle oc.shutdown
      if (data.type === "oc.shutdown" && data.instanceId) {
        if (onShutdown) {
          onShutdown(data as unknown as ShutdownPacket);
        }
        return;
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
  const { updateServers, updateSessions } = useAppActions();
  const { handleAnnounce, handleShutdown, state } = useConnectionManager();

  // Sync ConnectionManager state to AppContext
  React.useEffect(() => {
    updateServers(state.servers);
    updateSessions(state.sessions);
  }, [state.servers, state.sessions, updateServers, updateSessions]);

  // Start UDP server on mount
  React.useEffect(() => {
    const socket = startUdpServer(handleAnnounce, handleShutdown);

    return () => {
      socket.close();
    };
  }, [handleAnnounce, handleShutdown]);

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

    const { getConnectionManager, initSdk: initConnectionSdk } =
      await import("./connections.js");

    // Initialize SDK
    await initConnectionSdk();
    const manager = getConnectionManager();

    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "oc.announce" && data.serverUrl) {
          manager.handleAnnounce(data);
        } else if (data.type === "oc.shutdown") {
          manager.handleShutdown(data);
        }
      } catch (err: any) {
        logDaemon(`Parse error: ${err.message}`);
      }
    });
    socket.bind(PORT);
    return;
  }

  // Headless mode - run ConnectionManager without TUI for testing
  if (isHeadless) {
    console.log("=== Headless Mode (no TUI) ===");
    console.log(`Listening for UDP on port ${PORT}...`);

    const { getConnectionManager, initSdk: initConnectionSdk } =
      await import("./connections.js");

    // Initialize SDK
    const sdkOk = await initConnectionSdk();
    console.log(`SDK initialized: ${sdkOk}`);

    const manager = getConnectionManager();

    // Log state changes
    manager.onConnectionChange((serverUrl, status) => {
      console.log(`[Connection] ${serverUrl} -> ${status}`);
    });

    manager.onSessionsUpdate((serverUrl, sessions) => {
      console.log(`[Sessions] ${serverUrl}: ${sessions.length} sessions`);
      for (const s of sessions) {
        const prefix = s.parentID ? "  └─" : "  ";
        console.log(
          `${prefix} ${s.id.slice(-8)} [${s.status}] "${s.title?.slice(0, 40) || "(no title)"}"`,
        );
      }
    });

    // Start UDP listener
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        if (data.type === "oc.announce") {
          console.log(
            `\n[UDP] Announce from ${data.instanceId}: ${data.serverUrl || "(no url)"}`,
          );
          if (data.serverUrl) {
            manager.handleAnnounce(data);
          }
        } else if (data.type === "oc.shutdown") {
          console.log(`[UDP] Shutdown: ${data.instanceId}`);
          manager.handleShutdown(data);
        }
      } catch (err: any) {
        console.error("[UDP] Parse error:", err.message);
      }
    });

    socket.on("listening", () => {
      const addr = socket.address();
      console.log(`[UDP] Bound to ${addr.address}:${addr.port}`);
      console.log("\nWaiting for oc.announce packets...\n");
    });

    socket.bind(PORT);

    // Keep running
    process.on("SIGINT", () => {
      console.log("\nShutting down...");
      socket.close();
      manager.dispose();
      process.exit(0);
    });

    return;
  }

  // Normal TUI mode
  checkDaemon();

  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    console.error("Error: stdin is not a TTY. Run in an interactive terminal.");
    console.error("Tip: Use --headless for non-TTY testing.");
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
