# Migration Plan: oc-busy-status → oc-session-manager

## Overview

Refactor the monolithic `oc-busy-status-tui.mjs` (2548 lines) into a TypeScript project with proper module structure, hot-reload development, and bundled production output.

**Source project**: `/Users/rmk/projects/oc-busy-status/`
**Target project**: `/Users/rmk/projects/oc-session-manager/`

## Project Details

- **Name**: `oc-session-manager`
- **Version**: `0.1.0`
- **Type**: ESM (`"type": "module"`)
- **Binary**: `oc-session-manager` (for npx/global install)

## File Structure

```
oc-session-manager/
├── src/
│   ├── index.ts           # Entry point, CLI parsing, mode dispatch
│   ├── config.ts          # Constants, ANSI codes, env vars (OC_SESSION_*)
│   ├── types.ts           # Instance, Session, ToolState, ViewMode, etc.
│   ├── state.ts           # instances Map, busySince, idleSince, view state
│   ├── utils.ts           # Formatting, text helpers, status functions
│   ├── server.ts          # UDP socket, session discovery, notifications
│   ├── session.ts         # Session viewer logic, SSE, actions
│   ├── render.ts          # All TUI rendering (grouped, flat, detail, session)
│   ├── input.ts           # Keyboard handlers (main + session view)
│   └── daemon.ts          # PID management, daemon start/stop/status
│
├── opencode/
│   └── plugin/
│       └── oc-session-manager.js   # Plugin (stays JS)
│
├── dist/
│   └── index.mjs          # Bundled output
│
├── context/
│   └── migration-plan.md  # This file
│
├── tsconfig.json
├── package.json
├── README.md
└── .gitignore
```

## Environment Variable Renames

| Old Name | New Name |
|----------|----------|
| `OC_STATUS_HOST` | `OC_SESSION_HOST` |
| `OC_STATUS_PORT` | `OC_SESSION_PORT` |
| `OC_STATUS_TIMEOUT` | `OC_SESSION_TIMEOUT` |
| `OC_STATUS_LONG_RUNNING` | `OC_SESSION_LONG_RUNNING` |
| `OC_STATUS_NOTIFY` | `OC_SESSION_NOTIFY` |
| `OC_STATUS_DEBUG` | `OC_SESSION_DEBUG` |
| `OC_STATUS_IDLE_LIMIT` | `OC_SESSION_IDLE_LIMIT` |

## Module Breakdown

### src/types.ts
Type definitions extracted from the codebase:

```typescript
export interface Instance {
  instanceId: string
  sessionID?: string
  parentID?: string
  status: string
  project?: string
  directory?: string
  dirName?: string
  branch?: string
  host?: string
  title?: string
  serverUrl?: string
  ts: number
  cost?: number
  tokens?: { input: number; output: number; total: number }
  model?: string
  busyTime?: number
  _isChildSession?: boolean
  _fromServer?: boolean
}

export interface Session {
  id: string
  title?: string
  status?: string
  parentID?: string
  directory?: string
  time?: { created?: number; updated?: number }
}

export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  output?: string
  title?: string
}

export interface MessagePart {
  type: 'text' | 'tool' | 'reasoning' | 'step-start' | 'step-finish'
  text?: string
  tool?: string
  state?: ToolState
  reasoning?: string
}

export interface Message {
  info: {
    role: 'user' | 'assistant'
    cost?: number
    tokens?: { input?: number; output?: number }
  }
  parts: MessagePart[]
}

export interface Permission {
  id: string
  tool: string
  args?: Record<string, unknown>
  message?: string
}

export interface GroupStats {
  idle: number
  busy: number
  stale: number
  cost: number
  tokens: number
}

export type ViewMode = 'grouped' | 'flat'
export type EffectiveStatus = 'idle' | 'busy' | 'stale'

export interface SelectableItem {
  type: 'group' | 'instance'
  key?: string
  instanceId?: string
  index: number
}

export interface RenderedLine {
  type: string
  text: string
  plain: string
}

export interface ServerConnection {
  client: any // OpencodeClient
  sessions: Session[]
  lastFetch: number
  error: string | null
}
```

### src/config.ts
Configuration and constants:

```typescript
// Environment variables
export const PORT = parseInt(process.env.OC_SESSION_PORT || '', 10) || 19876
export const STALE_TIMEOUT_SEC = parseInt(process.env.OC_SESSION_TIMEOUT || '', 10) || 120
export const STALE_TIMEOUT_MS = STALE_TIMEOUT_SEC * 1000
export const LONG_RUNNING_MIN = parseInt(process.env.OC_SESSION_LONG_RUNNING || '', 10) || 10
export const LONG_RUNNING_MS = LONG_RUNNING_MIN * 60 * 1000
export const NOTIFY_ENABLED = process.env.OC_SESSION_NOTIFY !== '0'
export const DEBUG = process.env.OC_SESSION_DEBUG === '1'

// Paths
export const PID_FILE = join(homedir(), '.oc-session-manager.pid')
export const LOG_FILE = join(homedir(), '.oc-session-manager.log')

// Intervals
export const REFRESH_INTERVAL = 1000
export const SESSION_REFRESH_INTERVAL = 5000

// ANSI escape codes
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // ... rest of ANSI codes
}

// Spinner frames
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
```

### src/state.ts
Global state management (module-level):

```typescript
import type { Instance, ViewMode, SelectableItem, RenderedLine, Permission, ServerConnection } from './types.js'

// Instance tracking
export const instances = new Map<string, Instance>()
export const busySince = new Map<string, number>()
export const idleSince = new Map<string, number>()

// Server connections
export const serverConnections = new Map<string, ServerConnection>()

// View state
export let viewMode: ViewMode = 'grouped'
export let selectedIndex = -1
export let selectableItems: SelectableItem[] = []
export let collapsedGroups = new Set<string>()
export let detailView: string | null = null
export let spinnerFrame = 0
export let termWidth = 80
export let termHeight = 24

// Session viewer state
export let sessionViewActive = false
export let sessionViewClient: any = null
export let sessionViewInstance: Instance | null = null
export let sessionViewSessionID: string | null = null
export let sessionViewMessages: any[] = []
export let sessionViewScrollOffset = 0
export let sessionViewRenderedLines: RenderedLine[] = []
export let sessionViewPendingPermissions = new Map<string, Permission>()
export let sessionViewInputMode = false
export let sessionViewInputBuffer = ''
export let sessionViewConfirmAbort = false
export let sessionViewError: string | null = null
export let sessionViewConnecting = false
export let sessionViewStatus = 'idle'
export let sessionViewSessions: any[] = []
export let sessionViewSessionIndex = 0
export let sessionViewSessionTitle = ''
export let sessionViewEventAbort: AbortController | null = null

// Setters for mutable state
export function setViewMode(mode: ViewMode) { viewMode = mode }
export function setSelectedIndex(idx: number) { selectedIndex = idx }
// ... more setters as needed
```

### src/utils.ts
All utility functions:

- `formatRelativeTime(ts: number): string`
- `formatDuration(ms: number): string`
- `formatCost(cost: number): string`
- `formatTokens(tokens: number): string`
- `truncate(str: string, maxLen: number): string`
- `wrapText(text: string, maxWidth: number): string[]`
- `escapeShell(str: string): string`
- `getEffectiveStatus(instance: Instance): EffectiveStatus`
- `isLongRunning(instance: Instance): boolean`
- `getBusyDuration(instance: Instance): number`
- `getGroupKey(instance: Instance): string`
- `getSortedInstances(): Instance[]`
- `getGroupedInstances(): [string, Instance[]][]`
- `countByStatus(): { idle: number; busy: number; stale: number }`
- `getGroupStats(instances: Instance[]): GroupStats`
- `formatToolArgs(args: Record<string, unknown>): string`

### src/daemon.ts
Daemon mode functionality:

- `readPid(): number | null`
- `isProcessRunning(pid: number): boolean`
- `checkDaemon(): void`
- `handleStop(): void`
- `handleStatus(): void`
- `handleDaemon(): void`
- `initDaemonChild(): void`

### src/server.ts
UDP server and session discovery:

- `removeChildSessions(parentSessionID: string): void`
- `discoverChildSessions(serverUrl: string, parentSessionID: string, baseInstance: Instance): Promise<void>`
- `discoverServerSessions(serverUrl: string): Promise<void>`
- `refreshAllServerSessions(): Promise<void>`
- `isBusyToIdleTransition(instanceId: string, newStatus: string): boolean`
- `showDesktopNotification(data: Instance): void`
- `startServer(): void` - Main UDP socket setup and message handling

### src/session.ts
Session viewer functionality:

- `isSessionViewerAvailable(): boolean`
- `enterSessionView(instance: Instance): Promise<void>`
- `buildSessionTree(rootSessionID: string): Promise<void>`
- `loadCurrentSessionMessages(): Promise<void>`
- `switchSession(direction: 'next' | 'prev'): Promise<void>`
- `exitSessionView(): void`
- `subscribeToSessionEvents(): Promise<void>`
- `handleSessionEvent(event: any): void`
- `refreshMessages(): Promise<void>`
- `abortSession(): Promise<void>`
- `abortInstanceSession(instance: Instance): Promise<void>`
- `respondToPermission(permissionId: string, response: string, remember?: boolean): Promise<void>`
- `sendMessage(text: string): Promise<void>`
- `renderSessionViewLines(): void`
- `renderPart(part: MessagePart): void`
- `renderTextPart(part: MessagePart): void`
- `renderToolPart(part: MessagePart): void`
- `renderReasoningPart(part: MessagePart): void`
- `scrollSessionView(direction: 'up' | 'down' | 'pageup' | 'pagedown' | 'home' | 'end'): void`

### src/render.ts
All TUI rendering:

- `renderRow(content: string, visibleLen: number, isSelected?: boolean, borderColor?: string): string`
- `renderDetailView(inst: Instance): string`
- `renderSessionView(): string`
- `renderSessionViewMessage(message: string, height: number, color?: string): string`
- `renderSessionViewConfirmAbort(height: number): string`
- `renderSessionViewInput(height: number): string`
- `renderSessionViewWithPermissions(height: number): string`
- `renderSessionViewContent(height: number): string`
- `buildInstanceTree(instances: Map<string, Instance>): Instance[]`
- `renderGrouped(): string`
- `renderFlat(): string`
- `render(): void` - Main render dispatcher

### src/input.ts
Keyboard handling:

- `handleMainKeypress(str: string, key: any): void`
- `handleSessionViewKeypress(str: string, key: any): void`
- `setupKeyboardInput(): void`

### src/index.ts
Entry point:

```typescript
#!/usr/bin/env node
import { checkDaemon, handleDaemon, handleStatus, handleStop } from './daemon.js'
import { startServer } from './server.js'
import { startTui } from './tui.js'

const args = process.argv.slice(2)

if (args.includes('--daemon')) {
  handleDaemon()
} else if (args.includes('--status')) {
  handleStatus()
} else if (args.includes('--stop')) {
  handleStop()
} else if (args.includes('--debug')) {
  // Debug mode - show raw packets
  startServer({ debug: true })
} else {
  // Normal TUI mode
  checkDaemon()
  startTui()
}
```

## Plugin Changes (oc-session-manager.js)

The plugin stays as plain JavaScript. Changes needed:

1. **Rename file**: `oc-busy-status.js` → `oc-session-manager.js`
2. **Update log prefix**: `[oc-busy-status]` → `[oc-session-manager]`
3. **Rename env vars**:
   - `OC_STATUS_HOST` → `OC_SESSION_HOST`
   - `OC_STATUS_PORT` → `OC_SESSION_PORT`
   - `OC_STATUS_DEBUG` → `OC_SESSION_DEBUG`
   - `OC_STATUS_IDLE_LIMIT` → `OC_SESSION_IDLE_LIMIT`
4. **Update PID file reference**: `.oc-busy-status.pid` → `.oc-session-manager.pid`

## Configuration Files

### package.json

```json
{
  "name": "oc-session-manager",
  "version": "0.1.0",
  "description": "TUI dashboard for monitoring and managing multiple OpenCode sessions",
  "type": "module",
  "main": "dist/index.mjs",
  "bin": {
    "oc-session-manager": "dist/index.mjs"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --outDir dist --clean",
    "start": "node dist/index.mjs"
  },
  "keywords": ["opencode", "tui", "session", "monitor"],
  "license": "MIT",
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### .gitignore

```
# Dependencies
node_modules/

# Build output
dist/

# Logs
*.log

# Runtime files
.oc-session-manager.pid

# OS files
.DS_Store
Thumbs.db

# Editor directories
.idea/
.vscode/
*.swp
*.swo
*~

# Environment
.env
.env.local
```

## Execution Steps

1. **Create package.json**
2. **Create tsconfig.json**
3. **Create .gitignore**
4. **Run `npm install`**
5. **Create src/types.ts** - Type definitions
6. **Create src/config.ts** - Constants, env vars, ANSI codes
7. **Create src/state.ts** - Global state maps and variables
8. **Create src/utils.ts** - Formatting and helper functions
9. **Create src/daemon.ts** - Daemon mode logic
10. **Create src/server.ts** - UDP, discovery, notifications
11. **Create src/session.ts** - Session viewer logic
12. **Create src/render.ts** - All TUI rendering
13. **Create src/input.ts** - Keyboard handlers
14. **Create src/index.ts** - Entry point, CLI dispatch
15. **Create opencode/plugin/oc-session-manager.js** - Renamed plugin
16. **Create README.md** - Updated documentation
17. **Test with `npm run dev`** - Verify hot reload
18. **Build with `npm run build`** - Verify bundled output
19. **Test built version** - `npm start`
20. **Init git and commit**

## Source Reference

The original source file is at:
`/Users/rmk/projects/oc-busy-status/oc-busy-status-tui.mjs` (2548 lines)

Key line ranges in the original file:
- Lines 1-50: Imports, CLI args
- Lines 32-45: Configuration constants
- Lines 62-92: ANSI codes, spinner
- Lines 114-147: Session viewer state variables
- Lines 150-310: Utility functions
- Lines 313-505: Server session discovery
- Lines 507-915: Session viewer functions
- Lines 919-1155: Message rendering (parts, tools, etc.)
- Lines 1159-1530: TUI rendering helpers
- Lines 1531-1565: Instance tree building
- Lines 1580-1893: renderGrouped, renderFlat
- Lines 1895-1912: Main render dispatcher
- Lines 1915-2010: Daemon functions
- Lines 2012-2060: Notifications
- Lines 2064-2165: UDP server (startServer)
- Lines 2167-2328: TUI setup (startTui), main keypress handler
- Lines 2330-2525: Session view keypress handler
- Lines 2526-2548: Main entry point dispatch

## Testing Checklist

After migration, verify:

- [ ] `npm run dev` starts with hot reload
- [ ] TUI displays correctly
- [ ] UDP packets received from plugin
- [ ] Session viewer works (Enter on instance)
- [ ] Abort works (a key)
- [ ] Daemon mode works (--daemon, --status, --stop)
- [ ] Desktop notifications work
- [ ] `npm run build` produces working bundle
- [ ] `node dist/index.mjs` runs correctly
- [ ] Plugin installs and works with OpenCode
