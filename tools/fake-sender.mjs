#!/usr/bin/env node
// fake-sender.mjs - Fake sender for testing the TUI
//
// Usage:
//   node tools/fake-sender.mjs                  # Send 5 instances, continuous updates
//   node tools/fake-sender.mjs --count=10       # Send 10 instances
//   node tools/fake-sender.mjs --interval=500   # Update every 500ms (default: 2000)
//   node tools/fake-sender.mjs --chaos          # Randomly add/remove instances over time
//
// Environment variables:
//   OC_SESSION_HOST - Target IP(s) (default: 127.0.0.1)
//                     Supports multiple hosts: "192.168.1.50,10.0.0.5"
//   OC_SESSION_PORT - Target port (default: 19876)

import { createSocket } from "node:dgram"
import { hostname } from "node:os"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HOSTS = (process.env.OC_SESSION_HOST || "127.0.0.1")
  .split(",")
  .map(h => h.trim())
  .filter(Boolean)

const PORT = parseInt(process.env.OC_SESSION_PORT, 10) || 19876

// Parse CLI args
const args = process.argv.slice(2)
const getArg = (name, defaultVal) => {
  const arg = args.find(a => a.startsWith(`--${name}=`))
  return arg ? arg.split("=")[1] : defaultVal
}
const hasFlag = (name) => args.includes(`--${name}`)

const INSTANCE_COUNT = parseInt(getArg("count", "5"), 10)
const UPDATE_INTERVAL = parseInt(getArg("interval", "2000"), 10)
const CHAOS_MODE = hasFlag("chaos")

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
]

const BRANCHES = [
  "main",
  "develop",
  "feature/auth",
  "feature/dashboard",
  "fix/memory-leak",
  "refactor/api",
  "chore/deps",
  "release/v2.0",
]

const TITLES = [
  "Implement user authentication",
  "Add dashboard charts",
  "Fix memory leak in worker",
  "Refactor API endpoints",
  "Update dependencies",
  "Add unit tests",
  "Optimize database queries",
  "Implement caching layer",
  "Add error handling",
  "Create documentation",
  "Fix race condition",
  "Add logging middleware",
  "Implement rate limiting",
  "Add webhook support",
  "Fix timezone issues",
  "Implement search feature",
  "Add export functionality",
  "Fix pagination bug",
  "Add bulk operations",
  "Implement notifications",
]

const MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku",
  "openai/gpt-4o",
  "openai/gpt-4-turbo",
  "anthropic/claude-opus",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateSessionId() {
  return Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join("")
}

function generateInstanceId() {
  return `${hostname()}-${randomInt(10000, 99999)}`
}

// ---------------------------------------------------------------------------
// Instance management
// ---------------------------------------------------------------------------

const instances = new Map()

function createInstance() {
  const instanceId = generateInstanceId()
  const project = randomChoice(PROJECTS)
  const branch = randomChoice(BRANCHES)
  
  // 30% chance to be a child of an existing instance in the same project/branch
  let parentID = null
  const potentialParents = Array.from(instances.values()).filter(
    i => i.project === project && i.branch === branch && !i.parentID
  )
  
  if (potentialParents.length > 0 && Math.random() < 0.3) {
    const parent = randomChoice(potentialParents)
    parentID = parent.sessionID
  }

  const instance = {
    instanceId,
    status: "idle",
    project,
    directory: `/home/user/projects/${project}`,
    dirName: project,
    branch,
    host: `docker-${randomInt(1, 5)}`,
    sessionID: generateSessionId(),
    parentID,
    title: randomChoice(TITLES),
    model: randomChoice(MODELS),
    cost: 0,
    tokens: { input: 0, output: 0, total: 0 },
    busyTime: 0,
    // Internal tracking
    _busyStart: null,
    _targetBusyDuration: null,
  }
  
  instances.set(instanceId, instance)
  return instance
}

function updateInstance(instance) {
  const now = Date.now()
  
  // State machine transitions
  if (instance.status === "idle") {
    // 40% chance to start working each cycle
    if (Math.random() < 0.4) {
      instance.status = "busy"
      instance._busyStart = now
      instance._targetBusyDuration = randomInt(3000, 15000) // 3-15 seconds
      instance.title = randomChoice(TITLES)
    }
  } else if (instance.status === "busy") {
    // Check if done being busy
    const elapsed = now - instance._busyStart
    if (elapsed >= instance._targetBusyDuration) {
      instance.status = "idle"
      instance._busyStart = null
      instance._targetBusyDuration = null
      
      // Add some cost and tokens for the "work" done
      const newTokensIn = randomInt(500, 5000)
      const newTokensOut = randomInt(100, 2000)
      instance.tokens.input += newTokensIn
      instance.tokens.output += newTokensOut
      instance.tokens.total += newTokensIn + newTokensOut
      instance.cost += (newTokensIn * 0.000003) + (newTokensOut * 0.000015)
      
      // Update busy time
      instance.busyTime += elapsed
    }
  }
  
  return instance
}

// ---------------------------------------------------------------------------
// UDP sending
// ---------------------------------------------------------------------------

const socket = createSocket("udp4")

function broadcastStatus(instance) {
  const payload = {
    type: "oc.status",
    ts: Date.now(),
    instanceId: instance.instanceId,
    status: instance.status,
    project: instance.project,
    directory: instance.directory,
    dirName: instance.dirName,
    branch: instance.branch,
    host: instance.host,
    sessionID: instance.sessionID,
    parentID: instance.parentID,
    title: instance.title,
    model: instance.model,
    cost: instance.cost,
    tokens: instance.tokens,
    busyTime: instance.busyTime + (instance.status === "busy" ? (Date.now() - instance._busyStart) : 0),
    serverPort: 4096,  // For session viewer compatibility
  }
  
  const buffer = Buffer.from(JSON.stringify(payload))
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host, (err) => {
      if (err) {
        console.error(`Failed to send to ${host}:${PORT}:`, err.message)
      }
    })
  }
}

function broadcastShutdown(instance) {
  const payload = {
    type: "oc.status",
    ts: Date.now(),
    instanceId: instance.instanceId,
    status: "shutdown",
    dirName: instance.dirName,
    branch: instance.branch,
  }
  
  const buffer = Buffer.from(JSON.stringify(payload))
  for (const host of HOSTS) {
    socket.send(buffer, 0, buffer.length, PORT, host)
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

console.log(`oc-session-manager fake-sender`)
console.log(`  Targets: ${HOSTS.join(", ")} (Port: ${PORT})`)
console.log(`  Instances: ${INSTANCE_COUNT}`)
console.log(`  Update interval: ${UPDATE_INTERVAL}ms`)
console.log(`  Chaos mode: ${CHAOS_MODE}`)
console.log(``)
console.log(`Press Ctrl+C to stop`)
console.log(``)

// Create initial instances
for (let i = 0; i < INSTANCE_COUNT; i++) {
  const inst = createInstance()
  
  // Randomize initial state (40% busy by default)
  if (Math.random() < 0.4) {
    inst.status = "busy"
    inst._busyStart = Date.now()
    inst._targetBusyDuration = randomInt(5000, 20000)
  }
  
  // Add some initial cost/tokens so it looks realistic
  inst.tokens.input = randomInt(1000, 20000)
  inst.tokens.output = randomInt(500, 10000)
  inst.tokens.total = inst.tokens.input + inst.tokens.output
  inst.cost = (inst.tokens.input * 0.000003) + (inst.tokens.output * 0.000015)
  
  broadcastStatus(inst)
  console.log(`[INIT] ${inst.dirName}:${inst.branch}:${inst.sessionID.slice(-4)} (${inst.status})`)
}

// Main update loop
setInterval(() => {
  // Update all instances
  for (const inst of instances.values()) {
    const oldStatus = inst.status
    updateInstance(inst)
    broadcastStatus(inst)
    
    if (oldStatus !== inst.status) {
      const arrow = inst.status === "busy" ? "→ BUSY" : "→ IDLE"
      console.log(`[${arrow}] ${inst.dirName}:${inst.branch}:${inst.sessionID.slice(-4)}`)
    }
  }
  
  // Chaos mode: randomly add/remove instances
  if (CHAOS_MODE) {
    // 10% chance to add a new instance
    if (Math.random() < 0.1 && instances.size < INSTANCE_COUNT * 2) {
      const inst = createInstance()
      broadcastStatus(inst)
      console.log(`[CHAOS +] ${inst.dirName}:${inst.branch}:${inst.sessionID.slice(-4)}`)
    }
    
    // 5% chance to remove an instance
    if (Math.random() < 0.05 && instances.size > 2) {
      const keys = Array.from(instances.keys())
      const removeKey = randomChoice(keys)
      const inst = instances.get(removeKey)
      broadcastShutdown(inst)
      instances.delete(removeKey)
      console.log(`[CHAOS -] ${inst.dirName}:${inst.branch}:${inst.sessionID.slice(-4)}`)
    }
  }
}, UPDATE_INTERVAL)

// Cleanup on exit
process.on("SIGINT", () => {
  console.log(`\nShutting down, sending shutdown for all instances...`)
  for (const inst of instances.values()) {
    broadcastShutdown(inst)
  }
  setTimeout(() => {
    socket.close()
    process.exit(0)
  }, 100)
})
