# oc-session-manager Architecture Documentation

## Overview

`oc-session-manager` is a monitoring system for multiple OpenCode instances. It allows users to see at a glance which OpenCode sessions are ready for input (IDLE) vs actively processing (BUSY). The system uses a hybrid approach: UDP broadcasting for lightweight discovery, and HTTP/SSE for detailed session viewing and interaction.

This project is the TypeScript successor to `oc-busy-status`.

## System Architecture

```
┌─────────────────────────┐         UDP (19876)        ┌─────────────────────────┐
│   Docker Container      │  ─────────────────────────►│   Desktop Machine       │
│   (OpenCode Session)    │                            │                         │
│                         │                            │   oc-session-manager    │
│   oc-session-manager.js │   JSON status packets      │   (TUI or daemon)       │
│   (OpenCode plugin)     │   every 30s + on change    │                         │
└─────────────────────────┘                            │   Desktop notifications │
         │                                             │   when BUSY → IDLE      │
         │ HTTP/SSE (4096)                             │                         │
         │ (when session viewer active)                │   Session Viewer:       │
         └─────────────────────────────────────────────│   - Live message stream │
                                                       │   - Send messages       │
┌─────────────────────────┐                            │   - Abort sessions      │
│   Another Container     │  ─────────────────────────►│   - Respond permissions │
└─────────────────────────┘                            └─────────────────────────┘
```

## Project Structure

```
oc-session-manager/
├── src/
│   ├── index.ts       # Entry point, CLI parsing
│   ├── config.ts      # Constants, ANSI codes, env vars
│   ├── types.ts       # TypeScript interfaces
│   ├── state.ts       # Global state (instances, view state)
│   ├── utils.ts       # Formatting, text helpers
│   ├── daemon.ts      # PID management, daemon start/stop
│   ├── server.ts      # UDP socket, session discovery
│   ├── session.ts     # Session viewer logic, SSE
│   ├── render.ts      # All TUI rendering
│   └── input.ts       # Keyboard handlers
│
├── opencode/plugin/
│   └── oc-session-manager.js   # OpenCode plugin
│
├── tools/
│   └── fake-sender.mjs         # Test utility
│
├── context/
│   ├── architecture.md         # This file
│   └── migration-plan.md       # Migration from oc-busy-status
│
├── dist/
│   └── index.js       # Bundled output (~68 KB)
│
├── tsconfig.json
├── package.json
└── README.md
```

## Component Details

### 1. Plugin: `opencode/plugin/oc-session-manager.js`

**Location**: `~/.config/opencode/plugin/oc-session-manager.js`

**Purpose**: Broadcasts session status changes via UDP

**Key Features**:
- Hooks into OpenCode's event system
- Maintains a state machine (IDLE/BUSY)
- Sends heartbeats every 30 seconds
- Tracks cost, tokens, model used
- Supports multiple TUI hosts (comma-separated IPs)
- Broadcasts server port for session viewer connections

**State Machine**:
```
         ┌─────────────────────────────────────────┐
         │                                         │
┌────────▼────────┐                    ┌──────────┴─────────┐
│                 │                    │                    │
│      IDLE       │◄──────────────────►│       BUSY         │
│ (Ready for      │                    │  (Processing)      │
│  user input)    │                    │                    │
└─────────────────┘                    └────────────────────┘
```

**Events → BUSY**:
- `tool.execute.before` - Tool about to execute
- `message.part.updated` - Streaming response chunk
- `session.status {running|pending}` - Session is active
- `message.updated {role: user|assistant}` - Message being processed
- `permission.updated` / `permission.replied` - Waiting for/answered permission

**Events → IDLE**:
- `session.idle` - Explicit idle signal
- `session.error` - Error occurred
- `session.status {idle}` - Session is idle
- `session.created` / `session.deleted` - Lifecycle events

**Configuration (Environment Variables)**:
| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_HOST` | `127.0.0.1` | Target IP(s), comma-separated |
| `OC_SESSION_PORT` | `19876` | UDP port |
| `OC_SERVER_PORT` | `4096` | OpenCode server port (for session viewer) |
| `OC_SESSION_IDLE_LIMIT` | `5` | Stop heartbeats after N idle cycles |
| `OC_SESSION_DEBUG` | `0` | Enable debug logging |

### 2. TUI: `src/` (TypeScript modules)

**Purpose**: Display status of all OpenCode instances in a terminal UI

**Modules**:
- `index.ts` - Entry point, CLI argument parsing
- `config.ts` - Environment variables, ANSI escape codes
- `types.ts` - TypeScript interfaces (Instance, Session, Message, etc.)
- `state.ts` - Global state management
- `utils.ts` - Text formatting, status functions
- `daemon.ts` - Daemon mode with PID management
- `server.ts` - UDP socket, instance tracking, notifications
- `session.ts` - Session viewer, SSE subscription, actions
- `render.ts` - TUI rendering for all view modes
- `input.ts` - Keyboard input handlers

**Operating Modes**:
1. **TUI Mode** (default) - Interactive terminal display
2. **Daemon Mode** (`--daemon`) - Background process, notifications only
3. **Debug Mode** (`--debug`) - Show raw UDP packets

**View Modes**:

1. **Grouped View** (default):
   ```
   ▼ product:main  ●2 ○1  $0.45 12.3k
      ● a1b2  "Feature X"          $0.12  now
      ├─ ⠋ c3d4  "Run Tests"       $0.23  45s  ← subagent
      └─ ⠋ e5f6  "Write Docs"      $0.10  12s  ← subagent
   ```

2. **Flat View**:
   ```
   ●  product:main:a1b2        "Ready for input"   $0.12     now
   ⠋  product:main:c3d4        "Working..."        $0.23   45s
   ```

3. **Session Viewer** (press Enter on instance):
   - Live streaming of messages
   - Tool calls with collapsible output
   - Send messages, abort sessions
   - Respond to permission requests

**Status Icons**:
| Icon | Color | Meaning |
|------|-------|---------|
| `●` | Green | IDLE - ready for input |
| `⠋` | Yellow | BUSY - processing (animated) |
| `!` | Red | Long-running (busy >10 min) |
| `◌` | Gray | STALE - no heartbeat |

**Keyboard Shortcuts (Main View)**:
| Key | Action |
|-----|--------|
| `q` | Quit |
| `↑`/`k`, `↓`/`j` | Navigate |
| `Enter` or `w` | Open session viewer |
| `i` | Open detail view |
| `Tab` | Toggle grouped/flat view |
| `d` | Remove selected |
| `c` | Clear stale instances |
| `r` | Force refresh |

**Keyboard Shortcuts (Session Viewer)**:
| Key | Action |
|-----|--------|
| `Esc` | Exit session viewer |
| `↑`/`k`, `↓`/`j` | Scroll up/down |
| `g` / `G` | Top / Bottom |
| `a` | Abort session |
| `m` | Send message |
| `p` | Focus permissions |

**Configuration (Environment Variables)**:
| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_PORT` | `19876` | UDP port to listen on |
| `OC_SESSION_TIMEOUT` | `5` | Minutes before stale |
| `OC_SESSION_LONG_RUNNING` | `10` | Minutes before flagged |
| `OC_SESSION_NOTIFY` | `1` | Enable desktop notifications |

### 3. Test Utility: `tools/fake-sender.mjs`

**Purpose**: Generate mock data to test TUI without real OpenCode sessions

**Usage**:
```bash
node tools/fake-sender.mjs                  # 5 instances, 2s updates
node tools/fake-sender.mjs --count=10       # 10 instances
node tools/fake-sender.mjs --interval=500   # Faster updates
node tools/fake-sender.mjs --chaos          # Random add/remove
```

## UDP Protocol

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
  "sessionID": "abc123...",
  "parentID": "def456...",
  "title": "Working on feature X",
  "model": "anthropic/claude-sonnet-4",
  "cost": 0.0234,
  "tokens": {
    "input": 1500,
    "output": 800,
    "total": 2300
  },
  "busyTime": 45000,
  "serverPort": 4096
}
```

**Status Values**:
- `idle` - Ready for user input
- `busy` - Actively processing
- `shutdown` - Instance shutting down (TUI removes immediately)

## Session Viewer Architecture

The session viewer uses a hybrid approach:

1. **Discovery via UDP**: The main list is populated via UDP packets
2. **Detailed viewing via HTTP/SSE**: Connect directly to OpenCode instance

**Connection Flow**:
1. User selects an instance (Enter or `w`)
2. TUI reads `host` and `serverPort` from instance data
3. TUI creates SDK client: `createOpencodeClient({ baseUrl: "http://{host}:{serverPort}" })`
4. TUI fetches initial messages
5. TUI subscribes to SSE events for real-time updates

**Interaction APIs**:
- `client.session.messages()` - Fetch messages
- `client.session.get()` - Get session status
- `client.session.abort()` - Abort session
- `client.session.prompt()` - Send message
- `client.postSessionByIdPermissionsByPermissionId()` - Respond to permissions
- `client.event.subscribe()` - SSE stream

## Data Flow

1. **Plugin Initialization**: Generate instanceId, send initial "idle", start heartbeat
2. **Event Processing**: OpenCode event → state machine → UDP broadcast
3. **Heartbeat Management**: Every 30s, stop after IDLE_LIMIT consecutive idle
4. **TUI Processing**: UDP → parse → track transitions → notify → render
5. **Session Viewer**: HTTP connect → fetch messages → SSE subscribe → auto-scroll
6. **Shutdown**: Plugin sends "shutdown" → TUI removes immediately

## Desktop Notifications

**Trigger**: Only on BUSY → IDLE transition

**Platforms**:
- **macOS**: `osascript` → Notification Center
- **Linux**: `notify-send` → libnotify

**Disable**: `OC_SESSION_NOTIFY=0`

## Key Design Decisions

1. **UDP vs TCP**: Fire-and-forget, no connection management
2. **Hybrid Architecture**: UDP for discovery, HTTP/SSE for details
3. **TypeScript**: Type safety, better maintainability
4. **Modular Design**: 10 focused modules vs 1 monolithic file
5. **Hot Reload**: `tsx watch` for development
6. **Single Bundle**: `tsup` bundles to one file for distribution

## Dependencies

- **Node.js 18+**
- **@opencode-ai/sdk** - Session viewer functionality
- **tsup** - Bundling (dev dependency)
- **tsx** - Development with hot reload (dev dependency)
- **typescript** - Type checking (dev dependency)

Built-in Node.js modules:
- `node:dgram` - UDP sockets
- `node:os` - hostname
- `node:path` - directory name
- `node:fs` - PID file
- `node:child_process` - git branch, notifications
- `node:readline` - keyboard input
