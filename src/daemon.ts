// Daemon mode functionality

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { PID_FILE, LOG_FILE } from './config.js'

// ---------------------------------------------------------------------------
// PID File Management
// ---------------------------------------------------------------------------

export function readPid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      return parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    }
  } catch {
    // Ignore
  }
  return null
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Daemon Commands
// ---------------------------------------------------------------------------

export function checkDaemon(): void {
  const pid = readPid()
  if (pid && isProcessRunning(pid)) {
    console.log(`Daemon already running (PID: ${pid}). Use --stop to stop it first.`)
    process.exit(1)
  }
}

export function handleStop(): void {
  const pid = readPid()
  if (pid && isProcessRunning(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
      console.log(`Stopped daemon (PID: ${pid})`)
      if (existsSync(PID_FILE)) {
        unlinkSync(PID_FILE)
      }
    } catch (err) {
      console.error(`Failed to stop daemon: ${err}`)
      process.exit(1)
    }
  } else {
    console.log('No daemon running')
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
  }
  process.exit(0)
}

export function handleStatus(): void {
  const pid = readPid()
  if (pid && isProcessRunning(pid)) {
    console.log(`Daemon is running (PID: ${pid})`)
  } else {
    console.log('Daemon is not running')
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
  }
  process.exit(0)
}

export function handleDaemon(): void {
  const pid = readPid()
  if (pid && isProcessRunning(pid)) {
    console.log(`Daemon already running (PID: ${pid})`)
    process.exit(0)
  }

  // Spawn detached child process
  const child = spawn(process.execPath, [process.argv[1], '--daemon-child'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })

  child.unref()

  // Write PID file
  writeFileSync(PID_FILE, String(child.pid))
  console.log(`Started daemon (PID: ${child.pid})`)
  process.exit(0)
}

export function logDaemon(message: string): void {
  try {
    const timestamp = new Date().toISOString()
    writeFileSync(LOG_FILE, `[${timestamp}] ${message}\n`, { flag: 'a' })
  } catch {
    // Ignore logging errors
  }
}

export function isDaemonChild(): boolean {
  return process.argv.includes('--daemon-child')
}

export function initDaemonChild(): void {
  // Write our own PID (might differ from parent's record)
  writeFileSync(PID_FILE, String(process.pid))
  logDaemon(`Daemon started (PID: ${process.pid})`)
  
  // Handle signals
  const shutdown = (signal: string) => {
    logDaemon(`Received ${signal}, shutting down`)
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    process.exit(0)
  }
  
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
