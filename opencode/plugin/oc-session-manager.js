// oc-session-manager.js - OpenCode plugin that broadcasts session status changes
//
// Install: Copy or symlink to ~/.config/opencode/plugin/
// Configure: Set OC_SESSION_HOST to your desktop's IP address
//
// Environment variables:
//   OC_SESSION_HOST - IP address(es) of machine(s) running oc-session-manager
//                     Supports multiple hosts: "192.168.1.50" or "192.168.1.50,10.0.0.5"
//   OC_SESSION_PORT - UDP port (default: 19876)
//   OC_SESSION_DEBUG - Set to "1" to enable debug logging
//   OC_SESSION_IDLE_LIMIT - Max idle heartbeats before stopping (default: 5)

import { createSocket } from "node:dgram"
import { execSync } from "node:child_process"
import { basename } from "node:path"
import { hostname } from "node:os"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Parse comma-separated hosts, trim whitespace, filter empty
const HOSTS = (process.env.OC_SESSION_HOST || "127.0.0.1")
  .split(",")
  .map(h => h.trim())
  .filter(Boolean)

const PORT = parseInt(process.env.OC_SESSION_PORT, 10) || 19876
const DEBUG = process.env.OC_SESSION_DEBUG === "1"

// Heartbeat interval (ms) - send periodic updates even when status unchanged
const HEARTBEAT_INTERVAL = 30_000

// Max consecutive idle heartbeats to send before stopping (to clear TUI)
const IDLE_LIMIT = parseInt(process.env.OC_SESSION_IDLE_LIMIT, 10) || 5

// Reusable UDP socket for high-performance multi-host broadcasting
const socket = createSocket("udp4")

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------
// 
// OpenCode emits many events. We classify them into two states:
//   - IDLE: Ready for user input
//   - BUSY: Processing (LLM generating, tool executing, etc.)
//
// Events that transition to BUSY:
//   - session.status { status: "running" | "pending" }
//   - session.updated (when session.status is running/pending)
//   - message.updated { role: "user" } - user just submitted a prompt
//   - message.updated { role: "assistant" } - assistant is generating
//   - message.part.updated - streaming response parts
//   - tool.execute.before - tool is about to run
//   - permission.updated - waiting for permission (still busy, not idle)
//
// Events that transition to IDLE:
//   - session.idle - explicit idle signal
//   - session.status { status: "idle" }
//   - session.error - error occurred, back to idle
//
// Events that don't change state:
//   - session.created - new session, starts idle
//   - session.deleted - cleanup
//   - session.compacted - background maintenance
//   - session.diff - informational
//   - file.* events - informational
//   - lsp.* events - informational
//
// ---------------------------------------------------------------------------

const BUSY_EVENTS = new Set([
  "tool.execute.before",      // Tool is about to execute
  "message.part.updated",     // Streaming response chunk
])

const IDLE_EVENTS = new Set([
  "session.idle",             // Explicit idle signal
  "session.error",            // Error = back to waiting
])

// Events that require checking properties to determine state
const CHECK_EVENTS = new Set([
  "session.status",           // Check status property
  "session.updated",          // Check session.status via API
  "message.updated",          // Check role property
  "permission.updated",       // Permission request = busy (waiting)
  "permission.replied",       // Permission answered, may still be busy
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function debug(...args) {
  if (DEBUG) {
    console.error(`[oc-session-manager]`, ...args)
  }
}

/**
 * Get the current git branch name for a directory
 */
function getGitBranch(cwd) {
  try {
    const output = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    
    // If output is multi-line (e.g. due to an echoing alias), take the last line
    const lines = output.split("\n")
    return lines[lines.length - 1].trim() || null
  } catch {
    return null
  }
}

/**
 * Sanitize session title for display
 * - Removes command syntax patterns (e.g., "[acpsdlu][.] ['msg']...")
 * - Truncates to reasonable length
 * - Returns null for unhelpful titles
 */
function sanitizeTitle(title) {
  if (!title) return null
  
  // Skip titles that look like command syntax/help text
  // Pattern: contains multiple bracket groups like "[abc][def]" or "| empty="
  if (/\[[^\]]+\]\s*\[[^\]]+\]/.test(title) || /\|\s*\w+=/.test(title)) {
    return null
  }
  
  // Skip titles that are mostly special characters
  const alphanumCount = (title.match(/[a-zA-Z0-9]/g) || []).length
  if (alphanumCount < title.length * 0.3) {
    return null
  }
  
  // Truncate very long titles
  if (title.length > 80) {
    return title.slice(0, 77) + "..."
  }
  
  return title
}

/**
 * Broadcast a UDP packet to all configured hosts
 * Uses a single reusable socket for performance
 */
function broadcastUdpMessage(message) {
  const buffer = Buffer.from(JSON.stringify(message))
  
  // Send to all hosts concurrently (fire-and-forget)
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host, (err) => {
      if (err && DEBUG) {
        console.error(`[oc-session-manager] Failed to send to ${host}:${PORT}:`, err.message)
      }
    })
  }
}

/**
 * Aggregate token usage and cost from session messages
 */
function aggregateSessionStats(messages) {
  let totalCost = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let model = null

  for (const { info } of messages.data ?? []) {
    if (info.role === "assistant") {
      totalCost += info.cost ?? 0
      totalInputTokens += info.tokens?.input ?? 0
      totalOutputTokens += info.tokens?.output ?? 0

      // Track the most recent model used
      if (info.providerID && info.modelID) {
        model = `${info.providerID}/${info.modelID}`
      }
    }
  }

  return {
    model,
    cost: totalCost,
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const OcSessionManager = async ({ project, directory, client }) => {
  // Generate a unique instance ID for this OpenCode session
  const instanceId = `${hostname()}-${process.pid}`
  const dirName = basename(directory)
  
  // Always log startup info
  console.error(`[oc-session-manager] Starting plugin for ${dirName} (PID: ${process.pid})`)
  console.error(`[oc-session-manager] Broadcasting to: ${HOSTS.join(", ")}:${PORT}`)
  
  // Extract server URL from the client
  let serverUrl = null
  try {
    const config = client._client?.getConfig?.()
    serverUrl = config?.baseUrl || null
    console.error(`[oc-session-manager] Server URL: ${serverUrl}`)
  } catch {
    console.error(`[oc-session-manager] Could not extract server URL from client`)
  }
  
  // Track current status to avoid redundant sends
  let currentStatus = null
  let heartbeatTimer = null
  let idleHeartbeatCount = 0
  
  // Track cumulative busy time (wall clock)
  let accumulatedBusyTime = 0
  let busyStartTime = null

  debug(`Initialized with ${HOSTS.length} target host(s): ${HOSTS.join(", ")}`)

  /**
   * Build and send status update
   */
  async function sendStatus(status, sessionID = null, sessionTitle = null, parentID = null) {
    const branch = getGitBranch(directory)
    
    // Calculate total busy time including current segment if busy
    let currentBusyDuration = 0
    if (status === "busy" && busyStartTime) {
      currentBusyDuration = Date.now() - busyStartTime
    }
    const totalBusyTime = accumulatedBusyTime + currentBusyDuration

    const payload = {
      type: "oc.status",
      ts: Date.now(),
      instanceId,
      status, // "busy" | "idle" | "shutdown"
      project: project?.name ?? dirName,
      directory,
      dirName,
      branch,
      host: hostname(),
      sessionID,
      parentID,
      title: sanitizeTitle(sessionTitle),
      busyTime: totalBusyTime,
      serverUrl, // Full URL to the OpenCode server (e.g., "http://localhost:54416")
    }

    // If we have a session, try to get stats
    if (sessionID && client) {
      try {
        const messages = await client.session.messages({ path: { id: sessionID } })
        const stats = aggregateSessionStats(messages)
        Object.assign(payload, stats)
      } catch {
        // Ignore errors fetching stats
      }
    }

    broadcastUdpMessage(payload)
    currentStatus = status
  }

  /**
   * Start heartbeat timer
   */
  function startHeartbeat(sessionID, sessionTitle, parentID) {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (currentStatus === "idle") {
        idleHeartbeatCount++
        if (idleHeartbeatCount > IDLE_LIMIT) {
          debug(`Idle limit reached (${IDLE_LIMIT}), stopping heartbeats`)
          stopHeartbeat()
          return
        }
      }

      if (currentStatus) {
        sendStatus(currentStatus, sessionID, sessionTitle, parentID)
      }
    }, HEARTBEAT_INTERVAL)
  }

  /**
   * Stop heartbeat timer
   */
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  // Track current session (will be populated by session.created event)
  let currentSessionID = null
  let currentSessionTitle = null
  
  // Send initial "idle" status without session info
  // Session will be set when session.created event fires
  sendStatus("idle", null, null)
  startHeartbeat(null, null)
  
  // Handle process exit to send shutdown signal
  // This catches Ctrl+C, kill, and normal exit
  let shuttingDown = false
  const handleShutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    debug("Sending shutdown signal")
    stopHeartbeat()
    sendStatus("shutdown")
    // Give UDP packet time to send before process exits
    setTimeout(() => socket.close(), 50)
  }
  
  process.on("SIGINT", handleShutdown)
  process.on("SIGTERM", handleShutdown)
  process.on("exit", handleShutdown)

  /**
   * Determine new status based on event type and properties
   * Returns: "busy" | "idle" | null (no change)
   */
  async function determineStatus(event) {
    const eventType = event.type
    const props = event.properties || {}
    const sessionID = props.sessionID

    // Direct BUSY events - no further checking needed
    if (BUSY_EVENTS.has(eventType)) {
      debug(`BUSY <- ${eventType}`)
      return "busy"
    }

    // Direct IDLE events - no further checking needed
    if (IDLE_EVENTS.has(eventType)) {
      debug(`IDLE <- ${eventType}`)
      return "idle"
    }

    // Events requiring property/API checks
    if (CHECK_EVENTS.has(eventType)) {
      switch (eventType) {
        case "session.status": {
          const status = props.status
          debug(`session.status: status=${status}`)
          if (status === "running" || status === "pending") {
            return "busy"
          } else if (status === "idle") {
            return "idle"
          }
          break
        }

        case "session.updated": {
          // Fetch session to check its current status
          if (sessionID && client) {
            try {
              const session = await client.session.get({ path: { id: sessionID } })
              const status = session?.data?.status
              debug(`session.updated: fetched status=${status}`)
              if (status === "running" || status === "pending") {
                return "busy"
              }
            } catch {
              // Ignore fetch errors
            }
          }
          break
        }

        case "message.updated": {
          // Any message update means activity is happening
          // - role: "user" = user just submitted a prompt, LLM will process
          // - role: "assistant" = LLM is generating a response
          const role = props.role
          debug(`message.updated: role=${role}`)
          if (role === "user" || role === "assistant") {
            return "busy"
          }
          break
        }

        case "permission.updated": {
          // Permission request means we're waiting, still "busy" from user perspective
          debug(`permission.updated: waiting for user`)
          // Note: Could introduce a "waiting" state here in the future
          return "busy"
        }

        case "permission.replied": {
          // Permission answered - session will continue, stay busy
          debug(`permission.replied`)
          return "busy"
        }
      }
    }

    // Lifecycle events
    switch (eventType) {
      case "session.created":
        debug(`session.created -> idle`)
        return "idle"

      case "session.deleted":
        debug(`session.deleted -> idle`)
        return "idle"
    }

    // Unknown or informational event - no state change
    return null
  }

  return {
    event: async ({ event }) => {
      const eventSessionID = event.properties?.sessionID
      
      debug(`Event: ${event.type}`, JSON.stringify(event.properties || {}))
      
      // Handle session.created specially - this is a new session, update immediately
      if (event.type === "session.created" && eventSessionID) {
        // Check if this is a root session (no parent) for our directory
        try {
          const session = await client.session.get({ path: { id: eventSessionID } })
          if (session?.data && !session.data.parentID && session.data.directory === directory) {
            debug(`New session created: ${eventSessionID}`)
            currentSessionID = eventSessionID
            currentSessionTitle = session.data.title || null
            // Reset busy time for new session
            accumulatedBusyTime = 0
            busyStartTime = null
            idleHeartbeatCount = 0
            // Send status update with new session
            sendStatus("idle", currentSessionID, currentSessionTitle)
            startHeartbeat(currentSessionID, currentSessionTitle)
            return
          }
        } catch {
          // Ignore errors
        }
      }
      
      // Update tracked session if event has one
      if (eventSessionID) {
        currentSessionID = eventSessionID
      }
      
      // Determine if this event changes our status
      const newStatus = await determineStatus(event)
      
      if (newStatus && newStatus !== currentStatus) {
        // Use tracked session ID (falls back if event didn't have one)
        const sessionID = currentSessionID
        
        // Fetch session title and parentID for the status update
        let title = currentSessionTitle
        let parentID = null
        if (sessionID && client) {
          try {
            const session = await client.session.get({ path: { id: sessionID } })
            title = session?.data?.title ?? currentSessionTitle
            parentID = session?.data?.parentID ?? null
            // Update tracked title
            currentSessionTitle = title
          } catch {
            // Ignore - use existing title
          }
        }

        debug(`State transition: ${currentStatus} -> ${newStatus}`)
        
        // Reset idle counter on any state change
        idleHeartbeatCount = 0
        
        // Update busy time tracking
        if (newStatus === "busy" && currentStatus !== "busy") {
          busyStartTime = Date.now()
        } else if (newStatus !== "busy" && currentStatus === "busy") {
          if (busyStartTime) {
            accumulatedBusyTime += (Date.now() - busyStartTime)
            busyStartTime = null
          }
        }
        
        sendStatus(newStatus, sessionID, title, parentID)
        startHeartbeat(sessionID, title, parentID)
      }
    },

    // Cleanup on plugin unload (if supported)
    dispose: () => {
      stopHeartbeat()
      sendStatus("shutdown")
      // Close the reusable socket
      socket.close()
    },
  }
}
