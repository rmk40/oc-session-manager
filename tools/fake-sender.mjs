#!/usr/bin/env node
// fake-sender.mjs - Fake UDP announcer for testing the TUI
//
// Usage:
//   node tools/fake-sender.mjs                  # Send 5 server announcements
//   node tools/fake-sender.mjs --count=10       # Send 10 announcements
//   node tools/fake-sender.mjs --interval=5000  # Announce every 5s (default: 30000)
//   node tools/fake-sender.mjs --mock-server    # Also start mock SDK servers
//   node tools/fake-sender.mjs --legacy         # Use old oc.status format (for compatibility)
//
// Environment variables:
//   OC_SESSION_HOST - Target IP(s) (default: 127.0.0.1)
//   OC_SESSION_PORT - Target port (default: 19876)

import { createSocket } from "node:dgram";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HOSTS = (process.env.OC_SESSION_HOST || "127.0.0.1")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const PORT = parseInt(process.env.OC_SESSION_PORT, 10) || 19876;

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
};
const hasFlag = (name) => args.includes(`--${name}`);

const INSTANCE_COUNT = parseInt(getArg("count", "5"), 10);
const ANNOUNCE_INTERVAL = parseInt(getArg("interval", "30000"), 10);
const START_MOCK_SERVERS = hasFlag("mock-server");
const LEGACY_MODE = hasFlag("legacy");

// Base port for mock servers (each instance gets its own)
const MOCK_SERVER_BASE_PORT = 14096;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const PROJECTS = [
  "product",
  "strata",
  "polaris",
  "obsidian",
  "eclipse",
  "nebula",
  "quantum",
  "atlas",
];

const BRANCHES = [
  "main",
  "develop",
  "feature/auth",
  "feature/dashboard",
  "fix/memory-leak",
  "refactor/api",
  "chore/deps",
  "release/v2.0",
];

const HOSTS_FAKE = [
  "docker-1",
  "docker-2",
  "docker-3",
  "container-a",
  "container-b",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateInstanceId(fakeHost) {
  return `${fakeHost}-${randomInt(10000, 99999)}`;
}

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------

const servers = new Map();
const mockProcesses = [];

function createServer(index) {
  const project = PROJECTS[index % PROJECTS.length];
  const branch = BRANCHES[index % BRANCHES.length];
  const fakeHost = HOSTS_FAKE[index % HOSTS_FAKE.length];
  const port = MOCK_SERVER_BASE_PORT + index;

  const server = {
    instanceId: generateInstanceId(fakeHost),
    project,
    directory: `/home/user/projects/${project}`,
    branch,
    host: fakeHost,
    port,
    serverUrl: `http://127.0.0.1:${port}`,
  };

  servers.set(server.instanceId, server);
  return server;
}

// ---------------------------------------------------------------------------
// UDP sending
// ---------------------------------------------------------------------------

const socket = createSocket("udp4");

function broadcastAnnounce(server) {
  const payload = {
    type: "oc.announce",
    serverUrl: server.serverUrl,
    project: server.project,
    directory: server.directory,
    branch: server.branch,
    instanceId: server.instanceId,
    ts: Date.now(),
  };

  const buffer = Buffer.from(JSON.stringify(payload));
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host, (err) => {
      if (err) {
        console.error(`Failed to send to ${host}:${PORT}:`, err.message);
      }
    });
  }
}

function broadcastShutdown(server) {
  const payload = {
    type: "oc.shutdown",
    instanceId: server.instanceId,
    ts: Date.now(),
  };

  const buffer = Buffer.from(JSON.stringify(payload));
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host);
  }
}

// Legacy format for backwards compatibility testing
function broadcastLegacyStatus(server, status = "idle") {
  const payload = {
    type: "oc.status",
    ts: Date.now(),
    instanceId: server.instanceId,
    status,
    project: server.project,
    directory: server.directory,
    dirName: server.project,
    branch: server.branch,
    host: server.host,
    sessionID: null,
    parentID: null,
    title: "Legacy mode session",
    model: "anthropic/claude-sonnet-4",
    cost: 0,
    tokens: { input: 0, output: 0, total: 0 },
    busyTime: 0,
    serverUrl: server.serverUrl,
  };

  const buffer = Buffer.from(JSON.stringify(payload));
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host);
  }
}

// ---------------------------------------------------------------------------
// Mock server spawning
// ---------------------------------------------------------------------------

function startMockServer(server, scenario = "basic") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const mockServerPath = join(__dirname, "mock-server.mjs");

  const proc = spawn(
    "node",
    [
      mockServerPath,
      `--port=${server.port}`,
      `--scenario=${scenario}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  proc.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[mock:${server.port}] ${line}`);
    }
  });

  proc.stderr.on("data", (data) => {
    console.error(`[mock:${server.port}] ${data.toString().trim()}`);
  });

  proc.on("error", (err) => {
    console.error(`[mock:${server.port}] Failed to start: ${err.message}`);
  });

  proc.on("exit", (code) => {
    console.log(`[mock:${server.port}] Exited with code ${code}`);
  });

  mockProcesses.push(proc);
  return proc;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`oc-session-manager fake-sender`);
console.log(`  Targets: ${HOSTS.join(", ")} (Port: ${PORT})`);
console.log(`  Servers: ${INSTANCE_COUNT}`);
console.log(`  Announce interval: ${ANNOUNCE_INTERVAL}ms`);
console.log(`  Mock servers: ${START_MOCK_SERVERS}`);
console.log(`  Legacy mode: ${LEGACY_MODE}`);
console.log(``);
console.log(`Press Ctrl+C to stop`);
console.log(``);

// Scenarios to distribute across servers
const SCENARIOS = ["basic", "hierarchy", "permissions", "basic", "chaos"];

// Create servers
for (let i = 0; i < INSTANCE_COUNT; i++) {
  const server = createServer(i);
  const scenario = SCENARIOS[i % SCENARIOS.length];

  if (START_MOCK_SERVERS) {
    console.log(
      `[INIT] Starting mock server for ${server.project}:${server.branch} on port ${server.port} (${scenario})`
    );
    startMockServer(server, scenario);
  }

  // Initial announcement
  if (LEGACY_MODE) {
    broadcastLegacyStatus(server, "idle");
  } else {
    broadcastAnnounce(server);
  }
  console.log(
    `[ANNOUNCE] ${server.project}:${server.branch} @ ${server.serverUrl}`
  );
}

// Wait for mock servers to start
if (START_MOCK_SERVERS) {
  console.log(`\nWaiting for mock servers to start...`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`Mock servers ready.\n`);
}

// Periodic announcements
setInterval(() => {
  for (const server of servers.values()) {
    if (LEGACY_MODE) {
      broadcastLegacyStatus(server, "idle");
    } else {
      broadcastAnnounce(server);
    }
  }
  console.log(`[HEARTBEAT] Sent ${servers.size} announcements`);
}, ANNOUNCE_INTERVAL);

// Cleanup on exit
process.on("SIGINT", () => {
  console.log(`\nShutting down...`);

  // Send shutdown for all servers
  for (const server of servers.values()) {
    broadcastShutdown(server);
  }

  // Kill mock servers
  for (const proc of mockProcesses) {
    proc.kill("SIGTERM");
  }

  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 100);
});

process.on("SIGTERM", () => {
  process.emit("SIGINT");
});
