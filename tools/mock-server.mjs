#!/usr/bin/env node
// mock-server.mjs - Mock OpenCode SDK server for testing
//
// Usage:
//   node tools/mock-server.mjs                    # Basic server on port 4096
//   node tools/mock-server.mjs --port=5000        # Custom port
//   node tools/mock-server.mjs --scenario=basic   # Run predefined scenario
//   node tools/mock-server.mjs --announce         # Also send UDP announcements
//   node tools/mock-server.mjs --announce-interval=5000  # Announce every 5s
//
// Scenarios:
//   basic       - Single session, cycles idle/busy every few seconds
//   hierarchy   - Parent with multiple children at various depths
//   permissions - Sessions that request permissions
//   chaos       - Random session creation/deletion, state changes
//   disconnect  - Server that periodically disconnects
//
// Interactive commands (stdin):
//   busy <id>      - Set session to busy
//   idle <id>      - Set session to idle
//   perm <id>      - Trigger permission request on session
//   spawn <id>     - Spawn child of session
//   kill <id>      - Delete session
//   list           - List all sessions
//   help           - Show commands

import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { hostname } from "node:os";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
};
const hasFlag = (name) => args.includes(`--${name}`);

const PORT = parseInt(getArg("port", "4096"), 10);
const SCENARIO = getArg("scenario", "basic");
const ANNOUNCE = hasFlag("announce");
const ANNOUNCE_INTERVAL = parseInt(getArg("announce-interval", "30000"), 10);
const UDP_PORT = parseInt(getArg("udp-port", "19876"), 10);
const UDP_HOST = getArg("udp-host", "127.0.0.1");

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

const sessions = new Map();
const sseClients = new Set();
let nextPermissionId = 1;

function generateId() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

function createSession(opts = {}) {
  const id = opts.id || generateId();
  const session = {
    id,
    parentID: opts.parentID || null,
    title: opts.title || "Test session",
    status: opts.status || "idle",
    directory: opts.directory || "/home/user/test-project",
    createdAt: Date.now(),
    // For stats
    cost: opts.cost || 0,
    tokens: opts.tokens || { input: 0, output: 0, total: 0 },
    model: opts.model || "anthropic/claude-sonnet-4",
    // Messages
    messages: opts.messages || [],
    // Pending permission
    pendingPermission: null,
  };
  sessions.set(id, session);
  broadcastSSE({ type: "session.created", properties: { sessionID: id } });
  return session;
}

function deleteSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  
  // Delete children first
  for (const [childId, child] of sessions) {
    if (child.parentID === id) {
      deleteSession(childId);
    }
  }
  
  sessions.delete(id);
  broadcastSSE({ type: "session.deleted", properties: { sessionID: id } });
  return true;
}

function setSessionStatus(id, status) {
  const session = sessions.get(id);
  if (!session) return false;
  
  const oldStatus = session.status;
  session.status = status;
  
  broadcastSSE({
    type: "session.status",
    properties: { sessionID: id, status },
  });
  
  if (status === "idle" && oldStatus !== "idle") {
    broadcastSSE({ type: "session.idle", properties: { sessionID: id } });
  }
  
  return true;
}

function requestPermission(id, tool = "bash", args = { command: "rm -rf /" }) {
  const session = sessions.get(id);
  if (!session) return null;
  
  const permId = `perm_${nextPermissionId++}`;
  session.pendingPermission = {
    id: permId,
    tool,
    args,
    message: `Allow ${tool}?`,
    createdAt: Date.now(),
  };
  
  broadcastSSE({
    type: "permission.updated",
    properties: {
      sessionID: id,
      permissionID: permId,
      tool,
      args,
    },
  });
  
  return permId;
}

function replyPermission(sessionId, permId, allow) {
  const session = sessions.get(sessionId);
  if (!session || !session.pendingPermission) return false;
  if (session.pendingPermission.id !== permId) return false;
  
  session.pendingPermission = null;
  
  broadcastSSE({
    type: "permission.replied",
    properties: {
      sessionID: sessionId,
      permissionID: permId,
      allowed: allow,
    },
  });
  
  return true;
}

function getChildren(parentId) {
  const children = [];
  for (const session of sessions.values()) {
    if (session.parentID === parentId) {
      children.push(session);
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// SSE Broadcasting
// ---------------------------------------------------------------------------

function broadcastSSE(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
  console.log(`[SSE] ${event.type} ${event.properties?.sessionID || ""}`);
}

// ---------------------------------------------------------------------------
// HTTP Server (SDK API)
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route: GET /session - List all sessions
  if (method === "GET" && path === "/session") {
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      parentID: s.parentID,
      title: s.title,
      status: s.status,
      directory: s.directory,
      createdAt: s.createdAt,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: list }));
    return;
  }

  // Route: GET /session/status - Status map for all sessions
  if (method === "GET" && path === "/session/status") {
    const statusMap = {};
    for (const [id, session] of sessions) {
      statusMap[id] = session.status;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: statusMap }));
    return;
  }

  // Route: GET /session/:id - Get session details
  const sessionMatch = path.match(/^\/session\/([a-f0-9]+)$/);
  if (method === "GET" && sessionMatch) {
    const id = sessionMatch[1];
    const session = sessions.get(id);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: {
          id: session.id,
          parentID: session.parentID,
          title: session.title,
          status: session.status,
          directory: session.directory,
          createdAt: session.createdAt,
        },
      })
    );
    return;
  }

  // Route: GET /session/:id/children - Get child sessions
  const childrenMatch = path.match(/^\/session\/([a-f0-9]+)\/children$/);
  if (method === "GET" && childrenMatch) {
    const parentId = childrenMatch[1];
    const children = getChildren(parentId).map((s) => ({
      id: s.id,
      parentID: s.parentID,
      title: s.title,
      status: s.status,
      directory: s.directory,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: children }));
    return;
  }

  // Route: GET /session/:id/messages - Get messages
  const messagesMatch = path.match(/^\/session\/([a-f0-9]+)\/messages$/);
  if (method === "GET" && messagesMatch) {
    const id = messagesMatch[1];
    const session = sessions.get(id);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    // Return mock messages with stats
    const messages = session.messages.length > 0 ? session.messages : [
      {
        info: {
          role: "assistant",
          cost: session.cost,
          tokens: session.tokens,
          providerID: "anthropic",
          modelID: session.model.split("/")[1],
        },
        parts: [{ type: "text", text: "Mock response" }],
      },
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: messages }));
    return;
  }

  // Route: POST /session/:id/abort - Abort session
  const abortMatch = path.match(/^\/session\/([a-f0-9]+)\/abort$/);
  if (method === "POST" && abortMatch) {
    const id = abortMatch[1];
    if (setSessionStatus(id, "idle")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
    }
    return;
  }

  // Route: POST /session/:id/prompt - Send prompt
  const promptMatch = path.match(/^\/session\/([a-f0-9]+)\/prompt$/);
  if (method === "POST" && promptMatch) {
    const id = promptMatch[1];
    const session = sessions.get(id);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    // Set to busy to simulate processing
    setSessionStatus(id, "running");
    
    // Auto-idle after a few seconds
    setTimeout(() => {
      if (sessions.has(id) && sessions.get(id).status === "running") {
        setSessionStatus(id, "idle");
      }
    }, 3000);
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Route: POST /session/:id/permissions/:permId - Reply to permission
  const permMatch = path.match(
    /^\/session\/([a-f0-9]+)\/permissions\/([a-z0-9_]+)$/
  );
  if (method === "POST" && permMatch) {
    const sessionId = permMatch[1];
    const permId = permMatch[2];
    
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { allow } = JSON.parse(body);
        if (replyPermission(sessionId, permId, allow)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Permission not found" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // Route: GET /event/subscribe - SSE stream
  if (method === "GET" && path === "/event/subscribe") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    
    sseClients.add(res);
    console.log(`[SSE] Client connected (${sseClients.size} total)`);
    
    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (${sseClients.size} total)`);
    });
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path }));
});

// ---------------------------------------------------------------------------
// UDP Announcements
// ---------------------------------------------------------------------------

const udpSocket = createSocket("udp4");

function sendAnnounce() {
  const payload = {
    type: "oc.announce",
    serverUrl: `http://127.0.0.1:${PORT}`,
    project: "mock-project",
    directory: "/home/user/mock-project",
    branch: "main",
    instanceId: `${hostname()}-mock-${PORT}`,
    ts: Date.now(),
  };
  
  const buffer = Buffer.from(JSON.stringify(payload));
  udpSocket.send(buffer, 0, buffer.length, UDP_PORT, UDP_HOST, (err) => {
    if (err) {
      console.error(`[UDP] Failed to send announce:`, err.message);
    } else {
      console.log(`[UDP] Sent announce to ${UDP_HOST}:${UDP_PORT}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function runScenario(name) {
  console.log(`[SCENARIO] Running: ${name}`);
  
  switch (name) {
    case "basic": {
      // Single session that cycles idle/busy
      const session = createSession({ title: "Basic test session" });
      console.log(`[SCENARIO] Created session: ${session.id.slice(-8)}`);
      
      setInterval(() => {
        if (session.status === "idle") {
          setSessionStatus(session.id, "running");
        } else {
          setSessionStatus(session.id, "idle");
        }
      }, 5000);
      break;
    }
    
    case "hierarchy": {
      // Parent with multiple children at various depths
      const parent = createSession({ title: "Parent session" });
      console.log(`[SCENARIO] Created parent: ${parent.id.slice(-8)}`);
      
      setTimeout(() => {
        const child1 = createSession({
          title: "Child 1 - explore agent",
          parentID: parent.id,
        });
        console.log(`[SCENARIO] Created child1: ${child1.id.slice(-8)}`);
        
        setTimeout(() => {
          const child2 = createSession({
            title: "Child 2 - code search",
            parentID: parent.id,
          });
          console.log(`[SCENARIO] Created child2: ${child2.id.slice(-8)}`);
          
          setTimeout(() => {
            const grandchild = createSession({
              title: "Grandchild - deep search",
              parentID: child1.id,
            });
            console.log(`[SCENARIO] Created grandchild: ${grandchild.id.slice(-8)}`);
            
            // Cycle statuses
            setInterval(() => {
              const all = [parent, child1, child2, grandchild];
              const random = all[Math.floor(Math.random() * all.length)];
              if (random.status === "idle") {
                setSessionStatus(random.id, "running");
              } else {
                setSessionStatus(random.id, "idle");
              }
            }, 3000);
          }, 2000);
        }, 2000);
      }, 1000);
      break;
    }
    
    case "permissions": {
      // Sessions that request permissions
      const session = createSession({ title: "Permission test" });
      console.log(`[SCENARIO] Created session: ${session.id.slice(-8)}`);
      
      setInterval(() => {
        if (!session.pendingPermission) {
          const tools = ["bash", "write", "edit", "read"];
          const tool = tools[Math.floor(Math.random() * tools.length)];
          requestPermission(session.id, tool, { path: "/etc/passwd" });
        }
      }, 8000);
      break;
    }
    
    case "chaos": {
      // Random everything
      createSession({ title: "Initial session" });
      
      setInterval(() => {
        const actions = ["create", "delete", "busy", "idle", "perm"];
        const action = actions[Math.floor(Math.random() * actions.length)];
        const allSessions = Array.from(sessions.values());
        
        switch (action) {
          case "create":
            if (sessions.size < 10) {
              const parent = allSessions.length > 0 && Math.random() < 0.3
                ? allSessions[Math.floor(Math.random() * allSessions.length)]
                : null;
              createSession({
                title: `Chaos session ${sessions.size + 1}`,
                parentID: parent?.id,
              });
            }
            break;
          case "delete":
            if (allSessions.length > 1) {
              const toDelete = allSessions[Math.floor(Math.random() * allSessions.length)];
              deleteSession(toDelete.id);
            }
            break;
          case "busy":
          case "idle":
            if (allSessions.length > 0) {
              const session = allSessions[Math.floor(Math.random() * allSessions.length)];
              setSessionStatus(session.id, action === "busy" ? "running" : "idle");
            }
            break;
          case "perm":
            if (allSessions.length > 0) {
              const session = allSessions[Math.floor(Math.random() * allSessions.length)];
              if (!session.pendingPermission) {
                requestPermission(session.id, "bash");
              }
            }
            break;
        }
      }, 2000);
      break;
    }
    
    case "disconnect": {
      // Server that periodically stops responding
      const session = createSession({ title: "Disconnect test" });
      console.log(`[SCENARIO] Created session: ${session.id.slice(-8)}`);
      console.log(`[SCENARIO] Server will disconnect in 10s, reconnect in 5s after`);
      
      let connected = true;
      setInterval(() => {
        if (connected) {
          console.log(`[SCENARIO] Simulating disconnect...`);
          // Close all SSE connections
          for (const client of sseClients) {
            client.end();
          }
          sseClients.clear();
          connected = false;
          
          setTimeout(() => {
            console.log(`[SCENARIO] Reconnection available`);
            connected = true;
          }, 5000);
        }
      }, 15000);
      break;
    }
    
    default:
      console.log(`[SCENARIO] Unknown scenario: ${name}`);
      console.log(`[SCENARIO] Available: basic, hierarchy, permissions, chaos, disconnect`);
  }
}

// ---------------------------------------------------------------------------
// Interactive CLI
// ---------------------------------------------------------------------------

function startCLI() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "mock> ",
  });

  console.log(`\nInteractive commands available. Type 'help' for list.\n`);
  rl.prompt();

  rl.on("line", (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    
    switch (cmd) {
      case "help":
        console.log(`Commands:
  busy <id>      - Set session to busy/running
  idle <id>      - Set session to idle
  perm <id>      - Trigger permission request
  spawn <id>     - Create child session
  kill <id>      - Delete session
  create         - Create new root session
  list           - List all sessions
  announce       - Send UDP announce
  help           - Show this help`);
        break;
        
      case "list":
        if (sessions.size === 0) {
          console.log("No sessions");
        } else {
          for (const [id, s] of sessions) {
            const parent = s.parentID ? ` (child of ${s.parentID.slice(-8)})` : "";
            const perm = s.pendingPermission ? " [PERM]" : "";
            console.log(`  ${id.slice(-8)} ${s.status.padEnd(8)} ${s.title}${parent}${perm}`);
          }
        }
        break;
        
      case "create":
        const newSession = createSession({ title: args.join(" ") || "New session" });
        console.log(`Created: ${newSession.id.slice(-8)}`);
        break;
        
      case "busy":
      case "idle":
        if (!args[0]) {
          console.log(`Usage: ${cmd} <session-id-prefix>`);
        } else {
          const id = findSession(args[0]);
          if (id) {
            setSessionStatus(id, cmd === "busy" ? "running" : "idle");
            console.log(`Set ${id.slice(-8)} to ${cmd}`);
          } else {
            console.log(`Session not found: ${args[0]}`);
          }
        }
        break;
        
      case "perm":
        if (!args[0]) {
          console.log("Usage: perm <session-id-prefix>");
        } else {
          const id = findSession(args[0]);
          if (id) {
            const permId = requestPermission(id, "bash", { command: "test" });
            console.log(`Permission requested: ${permId}`);
          } else {
            console.log(`Session not found: ${args[0]}`);
          }
        }
        break;
        
      case "spawn":
        if (!args[0]) {
          console.log("Usage: spawn <parent-session-id-prefix>");
        } else {
          const parentId = findSession(args[0]);
          if (parentId) {
            const child = createSession({
              title: args.slice(1).join(" ") || "Child session",
              parentID: parentId,
            });
            console.log(`Created child: ${child.id.slice(-8)}`);
          } else {
            console.log(`Parent session not found: ${args[0]}`);
          }
        }
        break;
        
      case "kill":
        if (!args[0]) {
          console.log("Usage: kill <session-id-prefix>");
        } else {
          const id = findSession(args[0]);
          if (id) {
            deleteSession(id);
            console.log(`Deleted: ${id.slice(-8)}`);
          } else {
            console.log(`Session not found: ${args[0]}`);
          }
        }
        break;
        
      case "announce":
        sendAnnounce();
        break;
        
      case "":
        break;
        
      default:
        console.log(`Unknown command: ${cmd}. Type 'help' for list.`);
    }
    
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nShutting down...");
    process.exit(0);
  });
}

function findSession(prefix) {
  for (const id of sessions.keys()) {
    if (id.endsWith(prefix) || id.startsWith(prefix)) {
      return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Mock OpenCode server listening on http://127.0.0.1:${PORT}`);
  console.log(`  Scenario: ${SCENARIO}`);
  console.log(`  UDP announce: ${ANNOUNCE ? `${UDP_HOST}:${UDP_PORT}` : "disabled"}`);
  console.log(``);
  
  // Run scenario
  runScenario(SCENARIO);
  
  // Start UDP announcements if enabled
  if (ANNOUNCE) {
    sendAnnounce();
    setInterval(sendAnnounce, ANNOUNCE_INTERVAL);
  }
  
  // Start interactive CLI
  if (process.stdin.isTTY) {
    startCLI();
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close();
  udpSocket.close();
  process.exit(0);
});
