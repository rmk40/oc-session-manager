// oc-session-manager.js - OpenCode plugin that announces server presence
//
// This plugin broadcasts UDP announcements so the TUI can discover OpenCode servers.
// All session state is queried directly from the SDK by the TUI - this plugin only
// provides server discovery.
//
// Install: Copy or symlink to ~/.config/opencode/plugin/
// Configure: Set OC_SESSION_HOST to your desktop's IP address
//
// Environment variables:
//   OC_SESSION_HOST  - IP address(es) of machine(s) running oc-session-manager TUI
//                      Supports multiple hosts: "192.168.1.50" or "192.168.1.50,10.0.0.5"
//   OC_SESSION_PORT  - UDP port (default: 19876)
//   OC_SESSION_DEBUG - Set to "1" to enable debug logging

import { createSocket } from "node:dgram";
import { execSync } from "node:child_process";
import { basename } from "node:path";
import { hostname } from "node:os";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HOSTS = (process.env.OC_SESSION_HOST || "127.0.0.1")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const PORT = parseInt(process.env.OC_SESSION_PORT, 10) || 19876;
const DEBUG = process.env.OC_SESSION_DEBUG === "1";
const HEARTBEAT_INTERVAL = 30_000;

const socket = createSocket("udp4");

function debug(...args) {
  if (DEBUG) console.error("[oc-session-manager]", ...args);
}

function getGitBranch(cwd) {
  try {
    return (
      execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")
        .pop() || null
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const OcSessionManager = async ({ project, directory, client }) => {
  const instanceId = `${hostname()}-${process.pid}`;
  const dirName = basename(directory);

  console.error(
    `[oc-session-manager] Starting for ${dirName} (PID: ${process.pid})`,
  );
  console.error(
    `[oc-session-manager] Announcing to: ${HOSTS.join(", ")}:${PORT}`,
  );

  // Discover server URL from SDK
  let serverUrl = null;
  async function discoverServerUrl() {
    if (serverUrl) return serverUrl;
    try {
      const resp = await client.session.list();
      if (resp.response?.url) {
        const url = new URL(resp.response.url);
        serverUrl = `${url.protocol}//${url.host}`;
        console.error(`[oc-session-manager] Server URL: ${serverUrl}`);
      }
    } catch (err) {
      debug("Failed to discover server URL:", err.message);
    }
    return serverUrl;
  }

  // Send announcement packet
  async function sendAnnounce() {
    if (!serverUrl) await discoverServerUrl();

    const payload = {
      type: "oc.announce",
      serverUrl,
      project: project?.name ?? dirName,
      directory,
      branch: getGitBranch(directory),
      instanceId,
      ts: Date.now(),
    };

    const buffer = Buffer.from(JSON.stringify(payload));
    for (const host of HOSTS) {
      socket.send(buffer, 0, buffer.length, PORT, host, (err) => {
        if (err) debug(`Send failed to ${host}:`, err.message);
      });
    }
    debug("Sent announce:", payload.serverUrl);
  }

  // Send shutdown notification
  function sendShutdown() {
    const payload = { type: "oc.shutdown", instanceId, ts: Date.now() };
    const buffer = Buffer.from(JSON.stringify(payload));
    for (const host of HOSTS) {
      socket.send(buffer, 0, buffer.length, PORT, host);
    }
    debug("Sent shutdown");
  }

  // Initial announce after short delay (let SDK initialize)
  setTimeout(sendAnnounce, 100);

  // Periodic heartbeat
  const heartbeatTimer = setInterval(sendAnnounce, HEARTBEAT_INTERVAL);

  // Shutdown handling
  let shuttingDown = false;
  const handleShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeatTimer);
    sendShutdown();
    setTimeout(() => socket.close(), 50);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
  process.on("exit", handleShutdown);

  return {
    // No event handling needed - TUI queries SDK directly
    event: () => {},
    dispose: handleShutdown,
  };
};
