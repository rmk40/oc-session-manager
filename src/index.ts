#!/usr/bin/env node

// oc-session-manager - TUI dashboard for monitoring OpenCode sessions
//
// Usage:
//   oc-session-manager           Run TUI display
//   oc-session-manager --daemon  Run as background daemon (notifications only)
//   oc-session-manager --status  Check if daemon is running
//   oc-session-manager --stop    Stop the daemon
//   oc-session-manager --debug   Show raw UDP packets
//
// Environment variables:
//   OC_SESSION_PORT        - UDP port to listen on (default: 19876)
//   OC_SESSION_TIMEOUT     - Seconds before instance considered stale (default: 120)
//   OC_SESSION_LONG_RUNNING - Minutes before busy instance flagged as long-running (default: 10)

import { REFRESH_INTERVAL, ANSI } from './config.js'
import { 
  checkDaemon, 
  handleDaemon, 
  handleStatus, 
  handleStop, 
  isDaemonChild,
  initDaemonChild 
} from './daemon.js'
import { initSdk, startServer } from './server.js'
import { setupKeyboardInput } from './input.js'
import { render } from './render.js'

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

const isDebug = args.includes('--debug')
const isDaemon = args.includes('--daemon')
const isStatus = args.includes('--status')
const isStop = args.includes('--stop')
const isDaemonChildProcess = isDaemonChild()

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Handle CLI commands
  if (isStatus) {
    handleStatus()
    return
  }
  
  if (isStop) {
    handleStop()
    return
  }
  
  if (isDaemon) {
    handleDaemon()
    return
  }
  
  // Initialize SDK
  await initSdk()
  
  // Debug mode - just show raw packets
  if (isDebug) {
    console.log('Debug mode: showing raw UDP packets')
    startServer({ debug: true })
    return
  }
  
  // Daemon child process
  if (isDaemonChildProcess) {
    initDaemonChild()
    startServer()
    return
  }
  
  // Normal TUI mode
  checkDaemon()
  
  // Hide cursor immediately
  process.stdout.write(ANSI.hideCursor)
  
  // Start UDP server
  startServer()
  
  // Set up keyboard input
  setupKeyboardInput()
  
  // Initial render
  render()
  
  // Periodic refresh for animations and stale detection
  setInterval(() => {
    render()
  }, REFRESH_INTERVAL)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
