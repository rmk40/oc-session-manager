// UDP server, session discovery, and desktop notifications

import { createSocket, Socket } from 'node:dgram'
import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { PORT, NOTIFY_ENABLED } from './config.js'
import { 
  instances, 
  busySince, 
  idleSince, 
  serverConnections,
  sessionViewActive
} from './state.js'
import type { Instance, ServerConnection } from './types.js'
import { getEffectiveStatus, escapeShell } from './utils.js'
import { render } from './render.js'
import { isDaemonChild, logDaemon } from './daemon.js'

// SDK import - dynamically loaded
let createOpencodeClient: any = null

/* v8 ignore start - dynamic SDK import */
export async function initSdk(): Promise<boolean> {
  try {
    const sdk = await import('@opencode-ai/sdk')
    createOpencodeClient = sdk.createOpencodeClient
    return true
  } catch {
    return false
  }
}
/* v8 ignore stop */

export function isSessionViewerAvailable(): boolean {
  return createOpencodeClient !== null
}

export function getOpencodeClient(baseUrl: string): any {
  if (!createOpencodeClient) return null
  return createOpencodeClient({ baseUrl })
}

// ---------------------------------------------------------------------------
// Child Session Management
// ---------------------------------------------------------------------------

export function removeChildSessions(parentSessionID: string): void {
  if (!parentSessionID) return
  
  const toRemove: string[] = []
  for (const [id, inst] of instances) {
    if (inst._isChildSession && inst.parentID === parentSessionID) {
      toRemove.push(id)
      // Recursively find children of this child
      if (inst.sessionID) {
        removeChildSessions(inst.sessionID)
      }
    }
  }
  
  for (const id of toRemove) {
    instances.delete(id)
    busySince.delete(id)
    idleSince.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Session Discovery (integration code - requires SDK)
// ---------------------------------------------------------------------------

/* v8 ignore start - SDK integration code */
export async function discoverChildSessions(
  serverUrl: string, 
  parentSessionID: string, 
  baseInstance: Instance
): Promise<void> {
  if (!isSessionViewerAvailable() || !serverUrl || !parentSessionID) return
  
  let conn = serverConnections.get(serverUrl)
  
  // Create client if not exists
  if (!conn) {
    try {
      const client = getOpencodeClient(serverUrl)
      conn = { client, sessions: [], lastFetch: 0, error: null }
      serverConnections.set(serverUrl, conn)
    } catch {
      return
    }
  }
  
  try {
    // Fetch only children of this specific session
    const childrenResp = await conn.client.session.children({
      path: { id: parentSessionID }
    })
    const children = childrenResp.data || []
    
    if (children.length === 0) return
    
    // Get status for all sessions
    let statusMap: Record<string, string> = {}
    try {
      const statusResp = await conn.client.session.status()
      statusMap = statusResp.data || {}
    } catch {
      // Status endpoint may not exist in older versions
    }
    
    // Add child sessions as instances
    for (const child of children) {
      const childStatus = statusMap[child.id] || 'idle'
      const childInstanceId = `${serverUrl}-${child.id}`
      
      // Only add if not already exists or update if it does
      const existing = instances.get(childInstanceId)
      if (existing) {
        // Update existing
        existing.title = child.title || existing.title
        existing.status = String(childStatus)
        existing.ts = Date.now()
      } else {
        // Create new instance for child session
        instances.set(childInstanceId, {
          instanceId: childInstanceId,
          sessionID: child.id,
          parentID: parentSessionID,
          title: child.title || 'Subagent',
          status: String(childStatus),
          ts: Date.now(),
          serverUrl: baseInstance.serverUrl,
          host: baseInstance.host,
          project: baseInstance.project,
          directory: child.directory || baseInstance.directory,
          dirName: baseInstance.dirName,
          branch: baseInstance.branch,
          _fromServer: true,
          _isChildSession: true,
        })
      }
      
      // Recursively fetch children of this child
      await discoverChildSessions(serverUrl, child.id, baseInstance)
    }
    
  } catch {
    // Ignore errors - child session fetch is best effort
  }
}

export async function discoverServerSessions(serverUrl: string): Promise<void> {
  if (!isSessionViewerAvailable() || !serverUrl) return
  
  // Find the base instance for this server
  let baseInstance: Instance | null = null
  for (const inst of instances.values()) {
    if (inst.serverUrl === serverUrl && !inst._isChildSession) {
      baseInstance = inst
      break
    }
  }
  
  if (!baseInstance) return
  
  // If the base instance doesn't have a sessionID yet, try to get the current session
  if (!baseInstance.sessionID) {
    try {
      let conn = serverConnections.get(serverUrl)
      if (!conn) {
        const client = getOpencodeClient(serverUrl)
        conn = { client, sessions: [], lastFetch: 0, error: null }
        serverConnections.set(serverUrl, conn)
      }
      
      // Get status for all sessions to find active ones
      const statusResp = await conn.client.session.status()
      const statusMap = statusResp.data || {}
      
      // Find sessions that are running/busy
      for (const [sessionId, status] of Object.entries(statusMap)) {
        if (status === 'running' || status === 'pending') {
          // Get session details
          try {
            const sessionResp = await conn.client.session.get({ path: { id: sessionId } })
            const session = sessionResp.data
            if (session && !session.parentID) {
              // This is a root session that's active
              baseInstance.sessionID = sessionId
              baseInstance.title = session.title || baseInstance.title
              baseInstance.status = String(status)
              break
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }
  
  // Now fetch children for all parent instances
  const parentInstances: Instance[] = []
  for (const inst of instances.values()) {
    if (inst.serverUrl === serverUrl && inst.sessionID && !inst._isChildSession) {
      parentInstances.push(inst)
    }
  }
  
  for (const parent of parentInstances) {
    await discoverChildSessions(serverUrl, parent.sessionID!, parent)
  }
}

export async function refreshAllServerSessions(): Promise<void> {
  if (!isSessionViewerAvailable()) return
  
  // Get unique server URLs from instances
  const serverUrls = new Set<string>()
  for (const inst of instances.values()) {
    if (inst.serverUrl) {
      serverUrls.add(inst.serverUrl)
    }
  }
  
  // Fetch sessions from each server
  for (const serverUrl of serverUrls) {
    await discoverServerSessions(serverUrl)
  }
}
/* v8 ignore stop */

// ---------------------------------------------------------------------------
// Desktop Notifications
// ---------------------------------------------------------------------------

function isBusyToIdleTransition(instanceId: string, newStatus: string): boolean {
  const oldInst = instances.get(instanceId)
  if (!oldInst) return false
  const oldStatus = getEffectiveStatus(oldInst)
  return oldStatus === 'busy' && (newStatus === 'idle' || newStatus === 'shutdown')
}

export function showDesktopNotification(data: Instance): void {
  if (!NOTIFY_ENABLED) return
  if (!isBusyToIdleTransition(data.instanceId, data.status)) return
  
  const title = 'OpenCode'
  const subtitle = `${data.project || data.dirName || 'Session'}:${data.branch || 'main'}`
  const message = data.title || 'Session is idle'
  
  const os = platform()
  
  if (os === 'darwin') {
    // macOS - use osascript
    const script = `display notification "${escapeShell(message)}" with title "${escapeShell(title)}" subtitle "${escapeShell(subtitle)}"`
    exec(`osascript -e '${script}'`, /* v8 ignore next */ (err) => {
      /* v8 ignore next 2 */
      if (err && isDaemonChild()) logDaemon(`Notification error: ${err.message}`)
    })
  } else if (os === 'linux') {
    // Linux - use notify-send
    exec(`notify-send "${escapeShell(title)}" "${escapeShell(subtitle)}: ${escapeShell(message)}"`, /* v8 ignore next */ (err) => {
      /* v8 ignore next 2 */
      if (err && isDaemonChild()) logDaemon(`Notification error: ${err.message}`)
    })
  }
}

// ---------------------------------------------------------------------------
// UDP Server
// ---------------------------------------------------------------------------

let socket: Socket | null = null

/* v8 ignore start - UDP socket event handlers */
export function startServer(options: { debug?: boolean } = {}): void {
  const isDebug = options.debug || false
  const daemon = isDaemonChild()
  
  socket = createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString()) as Instance & { type: string }

      if (isDebug) {
        console.log(`[DEBUG] Received from ${rinfo.address}:${rinfo.port}:`)
        console.log(JSON.stringify(data, null, 2))
        return
      }

      if (data.type === 'oc.status' && data.instanceId) {
        if (data.status === 'shutdown') {
          // Remove this instance and all its child sessions (recursively)
          const shutdownInst = instances.get(data.instanceId)
          if (shutdownInst && shutdownInst.sessionID) {
            removeChildSessions(shutdownInst.sessionID)
          }
          instances.delete(data.instanceId)
          busySince.delete(data.instanceId)
          idleSince.delete(data.instanceId)
          if (!sessionViewActive) render()
          return
        }

        // Track busy/idle start times
        const oldInst = instances.get(data.instanceId)
        const oldStatus = oldInst ? getEffectiveStatus(oldInst) : null
        const newStatus = data.status
        
        // Track when instance became busy or idle
        if (newStatus === 'busy') {
          if (oldStatus !== 'busy') {
            busySince.set(data.instanceId, Date.now())
          }
          idleSince.delete(data.instanceId)
        } else if (newStatus === 'idle') {
          if (oldStatus !== 'idle') {
            idleSince.set(data.instanceId, Date.now())
          }
          busySince.delete(data.instanceId)
        } else {
          // shutdown or other status - clear both
          busySince.delete(data.instanceId)
          idleSince.delete(data.instanceId)
        }
        
        // Check for busy->idle transition BEFORE updating instance
        showDesktopNotification(data)
        
        // Check if session changed - if so, remove old child sessions
        if (oldInst && oldInst.sessionID && data.sessionID && oldInst.sessionID !== data.sessionID) {
          // Session changed - remove all child sessions from the old session (recursively)
          removeChildSessions(oldInst.sessionID)
        }
        
        // Update instance tracking
        instances.set(data.instanceId, {
          ...data,
          ts: data.ts || Date.now(),
        })
        
        // Trigger session discovery from this server
        if (data.serverUrl && isSessionViewerAvailable()) {
          discoverServerSessions(data.serverUrl)
        }
        
        if (!sessionViewActive) render()
      }
    } catch (err: any) {
      if (daemon) {
        logDaemon(`Parse error: ${err.message}`)
      } else if (!isDebug) {
        // Only log errors in non-debug TUI mode
      }
    }
  })

  socket.on('listening', () => {
    const addr = socket!.address()
    if (daemon) {
      logDaemon(`Listening on UDP ${addr.address}:${addr.port}`)
      console.log(`Listening for status updates on UDP ${addr.address}:${addr.port}`)
    }
  })

  socket.on('error', (err) => {
    if (daemon) {
      logDaemon(`Socket error: ${err.message}`)
    } else {
      console.error('Socket error:', err.message)
    }
    socket?.close()
    process.exit(1)
  })

  socket.bind(PORT)
  
  // Handle shutdown
  const shutdown = (signal: string) => {
    if (daemon) {
      logDaemon(`Received ${signal}, shutting down`)
    }
    socket?.close()
    process.exit(0)
  }
  
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
/* v8 ignore stop */

export function getSocket(): Socket | null {
  return socket
}
