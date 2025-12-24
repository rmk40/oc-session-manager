# oc-session-manager Architecture Documentation

## Overview

`oc-session-manager` is a monitoring and interaction system for multiple OpenCode instances. It provides:

- Real-time status monitoring (IDLE/BUSY/PENDING/DISCONNECTED)
- Desktop notifications for status changes and permission requests
- Session viewer with live message streaming
- Remote session control (abort, send messages, respond to permissions)
- Permission indicator for sessions awaiting user action

## Architecture (SDK-Driven)

The system now uses a **SDK-driven architecture** where the OpenCode SDK is the source of truth:

```
┌─────────────────────────┐       UDP (announce only)    ┌─────────────────────────┐
│  OpenCode Instance      │  ─────────────────────────►  │   TUI Dashboard         │
│  (any host)             │   { serverUrl, project }     │   (Desktop)             │
│                         │   every 30s + startup        │                         │
│  Plugin: ~150 lines     │                              │  On UDP announce:       │
│  Just announces URL     │         SSE + HTTP           │  - Track server         │
│                         │  ◄─────────────────────────  │  - Connect if new       │
│                         │                              │  - Subscribe to events  │
│  OpenCode SDK Server    │         (queries)            │  - Build session tree   │
│  on dynamic port        │  ◄─────────────────────────  │  - Track permissions    │
└─────────────────────────┘                              └─────────────────────────┘
```

### Key Design Decisions

1. **SDK as Single Source of Truth** - All session state comes from querying OpenCode servers
2. **UDP for Discovery Only** - Plugin just announces presence with serverUrl
3. **SSE for Real-Time Updates** - Subscribe to events from each server
4. **Auto-Reconnect with Backoff** - Show disconnected state with timer
5. **Remove Stale Servers** - After 3 minutes without UDP announce

## Data Model

```typescript
// A known OpenCode server (from UDP announce)
interface Server {
  serverUrl: string;
  instanceId: string;
  project: string;
  directory: string;
  branch: string;

  // Connection state
  status: "connecting" | "connected" | "disconnected";
  disconnectedAt?: number;
  lastAnnounce: number;
  reconnectAttempts: number;

  // SDK connection
  client?: OpencodeClient;
  eventAbort?: AbortController;
}

// A session on a server (from SDK)
interface Session {
  id: string;
  serverUrl: string;
  parentID?: string;

  // From SDK
  title?: string;
  status: "idle" | "running" | "pending";
  directory?: string;

  // Tracked locally
  busySince?: number;
  pendingPermission?: {
    id: string;
    tool: string;
    args?: Record<string, unknown>;
    message?: string;
  };

  // Stats
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  model?: string;
}
```

## Session States

| State                  | Detection                                   | Display           |
| ---------------------- | ------------------------------------------- | ----------------- |
| Idle                   | `session.status === 'idle'`                 | Green ●           |
| Busy                   | `session.status === 'running' \| 'pending'` | Yellow spinner    |
| Waiting for Permission | `pendingPermission !== undefined`           | Yellow ◆          |
| Long Running           | Busy > 10 minutes                           | Red !             |
| Server Disconnected    | `server.status === 'disconnected'`          | Gray ◌ + duration |

## System Components

### Plugin (`opencode/plugin/oc-session-manager.js`)

Minimal presence announcer (~150 lines):

- Discovers serverUrl from OpenCode
- Sends UDP announce every 30s + startup
- Sends shutdown on process exit
- No event handling or status tracking

**UDP Packet Format**:

```json
{
  "type": "oc.announce",
  "serverUrl": "http://192.168.1.100:54321",
  "project": "my-project",
  "directory": "/path/to/project",
  "branch": "main",
  "instanceId": "hostname-pid",
  "ts": 1703123456789
}
```

### ConnectionManager (`src/connections.ts`)

Core module managing server connections:

- Tracks known servers from UDP announces
- Creates SDK clients and SSE subscriptions
- Handles auto-reconnection with exponential backoff
- Cleans up stale servers (no announce for 3+ minutes)
- Triggers desktop notifications for status changes

**Key Methods**:

- `handleAnnounce(packet)` - Process UDP announce
- `handleShutdown(packet)` - Remove server
- `getSessions()` - Get all sessions across servers
- `getServers()` - Get all known servers

**Callbacks**:

- `onSessionEvent(callback)` - Raw SSE events
- `onConnectionChange(callback)` - Server connect/disconnect
- `onSessionsUpdate(callback)` - Session state changes

### TUI Module Structure

```
src/
├── index.tsx         # Entry point, CLI, React app
├── config.ts         # Environment variables, constants, debug flags
├── types.ts          # TypeScript interfaces
├── connections.ts    # ConnectionManager (SSE, SDK)
├── sdk.ts            # SDK initialization
├── utils.ts          # Formatting, text helpers
├── daemon.ts         # Daemon mode (background notifications)
├── server.ts         # Legacy UDP server (being deprecated)
├── session.ts        # Legacy session viewer
├── state.ts          # Legacy global state
├── render.ts         # Legacy TUI rendering
├── input.ts          # Legacy keyboard handlers
└── components/
    ├── index.tsx         # Component exports
    ├── App.tsx           # Main app component
    ├── AppContext.tsx    # React context (state management)
    ├── Header.tsx        # Status bar
    ├── HelpBar.tsx       # Keyboard shortcuts
    ├── GroupedView.tsx   # Grouped instance list
    ├── FlatView.tsx      # Flat instance list
    ├── DetailView.tsx    # Instance details
    ├── InstanceRow.tsx   # Single instance row
    ├── SessionView.tsx   # Session message viewer
    └── SessionWatcher.tsx # SSE subscription for viewer
```

## Event Handling

| SSE Event              | Action                                               |
| ---------------------- | ---------------------------------------------------- |
| `session.created`      | Add to sessions map, fetch details                   |
| `session.deleted`      | Remove from sessions map                             |
| `session.status`       | Update session status field                          |
| `session.idle`         | Set status to idle, trigger notification if was busy |
| `session.updated`      | Refresh session details                              |
| `permission.updated`   | Set pendingPermission, trigger notification          |
| `permission.replied`   | Clear pendingPermission                              |
| `message.updated`      | Update if in session viewer                          |
| `message.part.updated` | Update if in session viewer                          |

## Desktop Notifications

Fire desktop notification when:

1. Session transitions busy → idle
2. Session receives permission request (user action required)

**Platforms**:

- **macOS**: Uses `osascript` (Notification Center)
- **Linux**: Uses `notify-send` (libnotify)

## Network Considerations

### Docker Networking

When running OpenCode in Docker containers:

1. **Plugin broadcasts to host IP**:

   ```bash
   export OC_SESSION_HOST=192.168.1.50
   ```

2. **TUI connects to OpenCode server**:
   - OpenCode server must be accessible from host
   - Use Docker port mapping: `-p 4096:4096`

### Multiple Hosts

Plugin can broadcast to multiple TUIs:

```bash
export OC_SESSION_HOST="192.168.1.50,10.0.0.5"
```

## Environment Variables

### Plugin

| Variable           | Default     | Description                         |
| ------------------ | ----------- | ----------------------------------- |
| `OC_SESSION_HOST`  | `127.0.0.1` | Target TUI host(s), comma-separated |
| `OC_SESSION_PORT`  | `19876`     | UDP port                            |
| `OC_SESSION_DEBUG` | `0`         | Enable debug logging                |

### TUI

| Variable                  | Default | Description                          |
| ------------------------- | ------- | ------------------------------------ |
| `OC_SESSION_PORT`         | `19876` | UDP port to listen on                |
| `OC_SESSION_TIMEOUT`      | `120`   | Seconds before instance marked stale |
| `OC_SESSION_LONG_RUNNING` | `10`    | Minutes before busy flagged          |
| `OC_SESSION_NOTIFY`       | `1`     | Enable desktop notifications         |

## Testing

### Mock Server

```bash
# Start mock OpenCode server with announces
node tools/mock-server.mjs --announce --scenario=hierarchy
```

### Unit Tests

```bash
npm test              # Run all tests
npm run test:coverage # With coverage report
```

## Dependencies

### Runtime

- **Node.js 18+**
- **React 18** - UI components
- **Ink 5** - Terminal UI framework
- **@opencode-ai/sdk** - OpenCode API client (optional)

### Development

- **vitest** - Test framework
- **tsup** - Bundler
- **tsx** - Development with hot reload
- **typescript** - Type checking
