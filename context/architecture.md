# oc-session-manager Architecture Documentation

## Overview

`oc-session-manager` is a monitoring and interaction system for multiple OpenCode instances. It provides:
- Real-time status monitoring (IDLE/BUSY/STALE)
- Desktop notifications when sessions become idle
- Session viewer with live message streaming
- Remote session control (abort, send messages, respond to permissions)

The system uses a **hybrid communication architecture**:
1. **UDP** - Lightweight, fire-and-forget status broadcasting (Plugin → TUI)
2. **HTTP/SSE** - Reliable, bidirectional communication for session interaction (TUI → OpenCode)

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DOCKER CONTAINER / HOST                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         OpenCode Instance                            │    │
│  │                                                                      │    │
│  │   ┌──────────────┐    Events    ┌─────────────────────────────┐     │    │
│  │   │   OpenCode   │─────────────►│  oc-session-manager Plugin  │     │    │
│  │   │    Core      │              │  (oc-session-manager.js)    │     │    │
│  │   └──────────────┘              └──────────────┬──────────────┘     │    │
│  │         │                                      │                     │    │
│  │         │ HTTP :4096                           │ UDP :19876          │    │
│  │   ┌─────▼──────┐                               │                     │    │
│  │   │  OpenCode  │                               │                     │    │
│  │   │ HTTP Server│                               │                     │    │
│  │   │  (SDK API) │                               │                     │    │
│  │   └────────────┘                               │                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                   │                          │
└───────────────────────────────────────────────────┼──────────────────────────┘
                                                    │
                                                    │ UDP Broadcast
                                                    │ (fire-and-forget)
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DESKTOP / LAPTOP                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      oc-session-manager TUI                          │    │
│  │                                                                      │    │
│  │   ┌──────────────┐    ┌───────────────┐    ┌──────────────────┐     │    │
│  │   │  UDP Server  │    │ Instance Map  │    │   TUI Renderer   │     │    │
│  │   │  (receiver)  │───►│   (state)     │───►│                  │     │    │
│  │   └──────────────┘    └───────────────┘    └──────────────────┘     │    │
│  │                              │                                       │    │
│  │                              │ On Enter/Select                       │    │
│  │                              ▼                                       │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │                    Session Viewer                            │   │    │
│  │   │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐     │   │    │
│  │   │  │ SDK Client  │  │ SSE Stream  │  │ Action Handlers  │     │   │    │
│  │   │  │(HTTP calls) │  │ (realtime)  │  │(abort/send/perm) │     │   │    │
│  │   │  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘     │   │    │
│  │   └─────────┼────────────────┼──────────────────┼───────────────┘   │    │
│  └─────────────┼────────────────┼──────────────────┼───────────────────┘    │
│                │                │                  │                         │
└────────────────┼────────────────┼──────────────────┼─────────────────────────┘
                 │                │                  │
                 │   HTTP/SSE    │                  │
                 └────────────────┴──────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   OpenCode HTTP API   │
              │   (via SDK client)    │
              └───────────────────────┘
```

## Communication Protocols

### 1. UDP Status Broadcasting (Plugin → TUI)

**Purpose**: Lightweight discovery and status updates
**Direction**: Plugin broadcasts TO TUI (one-way)
**Port**: 19876 (configurable via `OC_SESSION_PORT`)

**Why UDP?**
- Fire-and-forget: No connection management needed
- Works across network boundaries (Docker → Host)
- Low overhead: Status updates are small (~500 bytes)
- Resilient: Dropped packets don't affect functionality (next heartbeat syncs)

**Packet Format** (JSON):
```json
{
  "type": "oc.status",
  "ts": 1703123456789,
  "instanceId": "hostname-12345",
  "status": "idle|busy|shutdown",
  "project": "my-project",
  "directory": "/path/to/project",
  "dirName": "my-project",
  "branch": "main",
  "host": "docker-host",
  "sessionID": "abc123def456...",
  "parentID": "parent-session-id",
  "title": "Working on feature X",
  "model": "anthropic/claude-sonnet-4",
  "cost": 0.0234,
  "tokens": {
    "input": 1500,
    "output": 800,
    "total": 2300
  },
  "busyTime": 45000,
  "serverUrl": "http://localhost:4096"
}
```

**Key Fields**:
| Field | Description |
|-------|-------------|
| `instanceId` | Unique identifier: `hostname-PID` |
| `status` | Current state: `idle`, `busy`, or `shutdown` |
| `sessionID` | Current OpenCode session ID |
| `parentID` | Parent session (for subagents spawned via Task tool) |
| `serverUrl` | OpenCode HTTP server URL (for session viewer connection) |
| `busyTime` | Cumulative wall-clock busy time in milliseconds |

**Broadcasting Behavior**:
- Immediate update on state change (idle↔busy)
- Heartbeat every 30 seconds
- Shutdown signal on process exit
- Stops heartbeats after 5 consecutive idle (to clear stale entries)
- Supports multiple target hosts (comma-separated IPs)

### 2. OpenCode SDK (TUI → OpenCode)

**Purpose**: Rich interaction with OpenCode sessions
**Direction**: Bidirectional (TUI ↔ OpenCode)
**Transport**: HTTP + Server-Sent Events (SSE)
**Library**: `@opencode-ai/sdk`

**When Used**:
- Session viewer is opened (Enter key on instance)
- User actions: abort, send message, respond to permission

**Connection Flow**:
```
1. User selects instance in TUI
2. TUI reads serverUrl from instance data (from UDP packet)
3. TUI creates SDK client:
   createOpencodeClient({ baseUrl: "http://host:port" })
4. TUI fetches session data and messages via HTTP
5. TUI subscribes to SSE stream for real-time updates
```

**SDK API Endpoints Used**:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/session/{id}` | Get session details (status, title, parentID) |
| GET | `/session/{id}/messages` | Fetch all messages in session |
| GET | `/session/{id}/children` | Get child sessions (subagents) |
| GET | `/session/status` | Get status of all sessions |
| POST | `/session/{id}/abort` | Abort a running session |
| POST | `/session/{id}/prompt` | Send a new message |
| POST | `/session/{id}/permissions/{permId}` | Respond to permission request |
| GET | `/event/subscribe` | SSE stream for real-time events |

**SSE Events Handled**:
| Event | Action |
|-------|--------|
| `message.part.updated` | Refresh messages (streaming response) |
| `message.updated` | Refresh messages (complete message) |
| `session.status` | Update status indicator |
| `session.idle` | Mark session as idle |
| `permission.updated` | Show permission request UI |
| `permission.replied` | Remove permission from pending |

## Plugin Architecture

### Location
```
~/.config/opencode/plugin/oc-session-manager.js
```

### State Machine
```
                    ┌─────────────────────────────────────────┐
                    │                                         │
   ┌────────────────▼───────────────┐     ┌───────────────────┴───────────────┐
   │                                │     │                                   │
   │            IDLE                │     │              BUSY                 │
   │      (Ready for input)         │◄───►│         (Processing)              │
   │                                │     │                                   │
   └────────────────────────────────┘     └───────────────────────────────────┘

Events that transition to BUSY:
  - tool.execute.before      (tool about to run)
  - message.part.updated     (streaming response)
  - session.status {running} (session actively processing)
  - session.status {pending} (session waiting)
  - message.updated {user}   (user submitted prompt)
  - message.updated {assistant} (assistant generating)
  - permission.updated       (waiting for permission)
  - permission.replied       (permission answered, continues)

Events that transition to IDLE:
  - session.idle            (explicit idle signal)
  - session.error           (error occurred)
  - session.status {idle}   (session is idle)
  - session.created         (new session starts idle)
  - session.deleted         (cleanup)
```

### Plugin Data Flow
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ OpenCode Events │────►│  State Machine   │────►│  UDP Broadcast  │
│                 │     │                  │     │                 │
│ session.*       │     │ IDLE ←→ BUSY     │     │ To all hosts:   │
│ message.*       │     │                  │     │ 192.168.1.50,   │
│ tool.*          │     │ + Heartbeat      │     │ 10.0.0.5, ...   │
│ permission.*    │     │   (30s interval) │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                │ Also tracks:
                                │ - Session stats (cost, tokens)
                                │ - Git branch
                                │ - Busy time (wall clock)
                                │ - Server URL for SDK
```

## TUI Architecture

### Module Structure
```
src/
├── index.ts      # Entry point, CLI parsing
├── config.ts     # Environment variables, ANSI codes, constants
├── types.ts      # TypeScript interfaces
├── state.ts      # Global state (instances, view state, session viewer)
├── utils.ts      # Formatting, text helpers, status functions
├── daemon.ts     # PID management, daemon start/stop/status
├── server.ts     # UDP socket, desktop notifications, session discovery
├── session.ts    # Session viewer, SSE subscription, actions
├── render.ts     # TUI rendering (grouped/flat/detail/session views)
└── input.ts      # Keyboard and mouse handlers for all views
```

### Terminal Mode

The TUI uses **alternate screen buffer** mode (like vim, less, htop):
- Prevents terminal scroll interference from mouse/keyboard
- Preserves terminal history when exiting
- Enables proper mouse event capture

**ANSI Sequences Used**:
```
Enter alternate screen: \x1b[?1049h
Exit alternate screen:  \x1b[?1049l
Enable mouse tracking:  \x1b[?1000h\x1b[?1002h\x1b[?1006h
Disable mouse tracking: \x1b[?1006l\x1b[?1002l\x1b[?1000l
```

### Mouse Support

Mouse events are captured using **SGR extended mode** for compatibility:

| Action | Effect (Main View) | Effect (Session Viewer) |
|--------|-------------------|------------------------|
| Left click | Select row (click again to open) | - |
| Scroll up | Move selection up | Scroll messages up |
| Scroll down | Move selection down | Scroll messages down |

**Mouse Event Parsing** (SGR format):
```
Format: \x1b[<button;x;y[Mm]
- button: encoded button + modifiers
- x, y: 1-based coordinates
- M: press, m: release
```

### Data Flow
```
UDP Packet ──► Parse JSON ──► Update Instance Map ──► Check Transitions ──► Render
                                      │                      │
                                      │                      ▼
                                      │               Desktop Notification
                                      │               (if BUSY → IDLE)
                                      ▼
                               Session Discovery
                               (fetch child sessions via SDK)
```

### Instance Tracking
```typescript
// Main instance map
instances: Map<instanceId, Instance>

// Timing tracking
busySince: Map<instanceId, timestamp>  // When became busy
idleSince: Map<instanceId, timestamp>  // When became idle

// Server connections (for session viewer)
serverConnections: Map<serverUrl, {
  client: OpencodeClient,
  sessions: Session[],
  lastFetch: timestamp,
  error: string | null
}>
```

### View Modes
1. **Grouped View** - Instances grouped by `project:branch`
2. **Flat View** - Simple list of all instances
3. **Detail View** - Full instance information
4. **Session Viewer** - Live session with messages and interaction

## Desktop Notifications

**Trigger**: BUSY → IDLE transition only

**Platforms**:
- **macOS**: Uses `osascript` to display via Notification Center
- **Linux**: Uses `notify-send` (requires `libnotify-bin`)

**Content**:
```
Title: "OpenCode"
Subtitle: "project:branch"
Body: "Session title or 'Session is idle'"
```

## Session Discovery (Child Sessions)

When the TUI receives a status update with a `serverUrl`, it can discover child sessions (subagents spawned via Task tool):

```
1. Plugin sends status with serverUrl
2. TUI receives UDP packet
3. TUI calls SDK: GET /session/{parentId}/children
4. TUI creates synthetic instances for each child
5. Children displayed nested under parent in TUI
```

**Child Session Instance**:
```typescript
{
  instanceId: `${serverUrl}-${childSessionId}`,
  sessionID: childSessionId,
  parentID: parentSessionId,
  _isChildSession: true,
  _fromServer: true,
  // Inherits project/branch/host from parent
}
```

## Environment Variables

### Plugin (`oc-session-manager.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_HOST` | `127.0.0.1` | Target TUI host(s), comma-separated |
| `OC_SESSION_PORT` | `19876` | UDP port |
| `OC_SESSION_DEBUG` | `0` | Enable debug logging to stderr |
| `OC_SESSION_IDLE_LIMIT` | `5` | Stop heartbeats after N consecutive idle |

### TUI (`oc-session-manager`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_PORT` | `19876` | UDP port to listen on |
| `OC_SESSION_TIMEOUT` | `120` | Seconds before instance marked stale |
| `OC_SESSION_LONG_RUNNING` | `10` | Minutes before busy flagged as long-running |
| `OC_SESSION_NOTIFY` | `1` | Enable desktop notifications |

## Network Considerations

### Docker Networking

When running OpenCode in Docker containers:

1. **Plugin broadcasts to host IP** (not localhost):
   ```bash
   export OC_SESSION_HOST=192.168.1.50  # Host machine IP
   ```

2. **TUI needs to reach OpenCode server** for session viewer:
   - OpenCode server must be accessible from host
   - Use Docker port mapping: `-p 4096:4096`
   - Or use Docker host networking: `--network host`

### Firewall Rules

Allow UDP port 19876 (or configured port):
```bash
# Linux
sudo ufw allow 19876/udp

# macOS (usually not needed)
```

### Multiple Hosts

Plugin can broadcast to multiple TUIs:
```bash
export OC_SESSION_HOST="192.168.1.50,10.0.0.5,172.16.0.100"
```

## Security Considerations

1. **UDP is unencrypted** - Status data is sent in plain text
2. **No authentication** - Any UDP packet is processed
3. **SDK uses HTTP** - Consider HTTPS for production
4. **Mitigation**: Use on trusted networks only

## Testing

### Mock Data
```bash
# Generate fake instances for TUI testing
node tools/fake-sender.mjs --count=10 --chaos
```

### Unit Tests
```bash
npm test              # Run all 574 tests
npm run test:coverage # With 99.9% coverage report
```

## Dependencies

### Runtime
- **Node.js 18+**
- **@opencode-ai/sdk** - OpenCode API client

### Development
- **vitest** - Test framework
- **@vitest/coverage-v8** - Coverage
- **tsup** - Bundler
- **tsx** - Development with hot reload
- **typescript** - Type checking

### Built-in Modules
- `node:dgram` - UDP sockets
- `node:os` - hostname, platform
- `node:path` - directory operations
- `node:fs` - PID file management
- `node:child_process` - git branch, notifications
- `node:readline` - keyboard input
