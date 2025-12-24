# REFACTOR-PLAN.md - SDK-Driven Session Manager

## Overview

This document outlines a fundamental refactoring of oc-session-manager to use the OpenCode SDK as the single source of truth for session state, replacing the current plugin-driven status tracking approach.

**Status:** Planning complete, implementation starting with Phase 0.

## Table of Contents

1. [Core Purpose](#core-purpose)
2. [Problems with Current Architecture](#problems-with-current-architecture)
3. [Design Decisions](#design-decisions)
4. [New Architecture](#new-architecture)
5. [Implementation Phases](#implementation-phases)
6. [File Changes](#file-changes)
7. [Testing Strategy](#testing-strategy)
8. [Migration Notes](#migration-notes)
9. [Open Questions (Resolved)](#open-questions-resolved)

---

## Core Purpose

The fundamental goal of oc-session-manager is **user efficiency**. Users running multiple OpenCode sessions need to know:

### 1. When their involvement is required

- Session waiting for permission (needs user decision)
- Session completed (may need review or next task)

### 2. What's currently happening

- Which sessions are actively working
- How long they've been busy (runaway detection)
- Session hierarchy (sub-agents spawned)

### 3. Quick access to interact

- Jump into any session to view/respond
- Handle permissions without switching terminals
- Abort runaway processes

Everything else (cost tracking, token counts, model info) is secondary - nice to have but not the core value proposition.

---

## Problems with Current Architecture

### 1. Plugin Tracks State Instead of Querying It

**Current behavior:**
The plugin maintains its own state machine, tracking transitions between IDLE and BUSY based on OpenCode events. This duplicates state that OpenCode already knows.

**Problems encountered:**

- Single global status variable means all sessions (parent + children) share one status
- When parent is busy and child becomes busy, child's status is suppressed (already "busy")
- When child sessions complete, they may not fire `session.idle` events
- Status updates are often inaccurate or stale

**Example failure:**

```
Parent session: busy
Child session 1 spawned: sends "busy" (works)
Child session 2 spawned: no update sent (status already "busy")
Child session 1 completes: may or may not send "idle"
Result: TUI shows incorrect states
```

### 2. Composite Keys Are a Workaround

**Current behavior:**
To differentiate parent from child sessions (which share the same process), we generate composite keys: `instanceId:sessionID`

**Problems encountered:**

- Original `instanceId` was `hostname-PID`, shared by all sessions in a process
- Child sessions were overwriting parent entries in the instances map
- We're fighting the data model instead of using proper session relationships

### 3. serverUrl Discovery Is Fragile

**Current behavior:**
Plugin tries to extract `serverUrl` from SDK client internals, falling back to parsing API response URLs.

**Problems encountered:**

- `client._client?.getConfig?.()?.baseUrl` often returns null
- Had to add async discovery via `client.session.list()` response URL parsing
- This delays first status broadcast and adds complexity

### 4. Duplicate State Management

**Current behavior:**

- `state.ts` has global Maps for instances, busySince, idleSince
- `AppContext.tsx` has React state with its own instances Map
- `server.ts` updates global state
- `index.tsx` has a separate UDP handler updating React state

**Problems encountered:**

- Fixes applied to one location didn't work because another was being used
- The composite key fix had to be applied to `index.tsx`, not `server.ts`
- Confusing to understand which state is authoritative

### 5. SSE/Events Not Used for Main List

**Current behavior:**

- UDP provides status updates for the main instance list
- SSE is only used when you open the session viewer
- Child sessions are "discovered" via periodic SDK calls, not real-time

**Problems encountered:**

- Main list updates lag behind actual state
- Child sessions appear/disappear with delay
- No real-time permission visibility in main list

---

## Design Decisions

### Decision 1: SDK as Single Source of Truth

**Choice:** All session state comes from querying OpenCode servers directly via SDK.

**Rationale:**

- OpenCode already knows the true state of every session
- The SDK provides `session.status()`, `session.list()`, `session.children()`
- SSE events provide real-time updates
- No need to duplicate this logic in the plugin

### Decision 2: Keep UDP for Discovery Only

**Choice:** UDP remains for cross-machine server discovery, but only announces presence.

**Rationale:**

- Cross-machine support is essential (OpenCode in Docker, TUI on desktop)
- Need some mechanism to discover dynamic server ports
- UDP is simple and works across network boundaries
- Plugin becomes ~50 lines instead of ~400

**UDP packet (new format):**

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

### Decision 3: SSE for Real-Time Updates

**Choice:** Subscribe to SSE events from each OpenCode server for immediate state changes.

**Rationale:**

- Sub-second responsiveness for status changes
- Permission requests visible immediately
- Tool executions tracked in real-time
- No polling delay

**Trade-off considered:** Polling would be simpler but adds 1-2 second delay. User preferred SSE.

### Decision 4: Group by project:branch:host

**Choice:** When same project:branch exists on multiple machines, show as separate groups.

**Rationale:**

- Prevents confusion about which instance is which
- Makes it clear when you have duplicate setups
- Each group maps to one OpenCode server

### Decision 5: Unlimited Hierarchy Depth

**Choice:** Display child sessions to unlimited depth.

**Rationale:**

- User wants to see "runaway setups" where agents spawn agents
- Tree structure makes depth visually clear
- No arbitrary cutoff needed

### Decision 6: Permission Visibility

**Choice:** Show permission-waiting state in main list, not just session viewer.

**Rationale:**

- User may have multiple sessions and needs to see which needs attention
- Desktop notification should also fire for permission requests
- Distinct visual indicator (not just "busy")

### Decision 7: Connection Management

**Choice:** Auto-reconnect with backoff, show disconnected state with duration timer, remove after no UDP for 3 minutes.

**Rationale:**

- Transient network issues shouldn't lose a server
- User can see how long something has been disconnected
- UDP announcements provide reliable "still alive" signal
- 3 minutes allows for brief interruptions without flapping
- No polling fallback - keep it simple, just show disconnected

---

## New Architecture

```
┌─────────────────────────┐       UDP (announce only)    ┌─────────────────────────┐
│  OpenCode Instance      │  ─────────────────────────►  │   TUI Dashboard         │
│  (any host)             │   { serverUrl, project }     │   (Desktop)             │
│                         │   every 30s + startup        │                         │
│  Plugin: ~50 lines      │                              │  On UDP announce:       │
│  Just announces URL     │         SSE + HTTP           │  - Track server         │
│                         │  ◄─────────────────────────  │  - Connect if new       │
│                         │                              │  - Subscribe to events  │
│  OpenCode SDK Server    │         (queries)            │  - Build session tree   │
│  on dynamic port        │  ◄─────────────────────────  │  - Track permissions    │
└─────────────────────────┘                              └─────────────────────────┘
```

### Data Model

```typescript
// A known OpenCode server
interface Server {
  serverUrl: string;
  instanceId: string;
  project: string;
  directory: string;
  branch: string;

  // Connection state
  status: "connecting" | "connected" | "disconnected";
  disconnectedAt?: number; // For "disconnected Xm" display
  lastAnnounce: number; // Last UDP timestamp
  reconnectAttempts: number;

  // SDK connection
  client?: OpencodeClient;
  eventAbort?: AbortController;
}

// A session on a server
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

  // Stats (fetched periodically, cached ~30s)
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  model?: string;
  statsUpdatedAt?: number;
}

// State structure
interface AppState {
  servers: Map<string, Server>; // keyed by serverUrl
  sessions: Map<string, Session>; // keyed by sessionId
}
```

### Session States

| State                  | Detection                                   | Display           |
| ---------------------- | ------------------------------------------- | ----------------- |
| Idle                   | `session.status === 'idle'`                 | Green ●           |
| Busy                   | `session.status === 'running' \| 'pending'` | Yellow spinner    |
| Waiting for Permission | `pendingPermission !== undefined`           | Orange ◆          |
| Long Running           | Busy > 10 minutes                           | Red !             |
| Server Disconnected    | `server.status === 'disconnected'`          | Gray ◌ + duration |

### Event Handling

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

### Notifications

Fire desktop notification when:

1. Session transitions busy → idle
2. Session receives permission request (user action required)

---

## Implementation Phases

### Phase 0: Testing Infrastructure

**Status:** Not started

**Goal:** Enable autonomous testing without requiring user to run commands manually.

**Tasks:**

1. **Mock OpenCode Server** (`tools/mock-server.mjs`)
   - Simulates OpenCode SDK API endpoints
   - Configurable sessions, statuses, hierarchy
   - SSE event emission on demand
   - Can simulate:
     - Session state changes (idle → busy → idle)
     - Permission requests
     - Child session creation
     - Server disconnection/reconnection

2. **Enhanced fake-sender** (`tools/fake-sender.mjs`)
   - Update to send new `oc.announce` packet format
   - Add `--mock-server` flag to also start mock SDK server
   - Add `--scenario` flag for predefined test scenarios:
     - `basic` - Single session, idle/busy cycling
     - `hierarchy` - Parent with multiple children
     - `permissions` - Sessions waiting for permissions
     - `chaos` - Random additions/removals/state changes
     - `disconnect` - Simulates server going away

3. **Debug flags for TUI**
   - `--debug` - Show raw UDP packets (existing)
   - `--debug-sse` - Log all SSE events received
   - `--debug-state` - Periodic state dump to stderr
   - `--dry-run` - Don't send actual SDK requests, log instead

4. **Test helpers** (`src/test-utils.ts`)
   - `createMockServer()` - Programmatic mock server for unit tests
   - `createMockAnnounce()` - Generate announce packets
   - `createMockSession()` - Generate session objects
   - `simulateSSEEvent()` - Inject events into connection manager

**Test scenarios to support:**

| Scenario                         | What it tests                      |
| -------------------------------- | ---------------------------------- |
| Single server, single session    | Basic flow                         |
| Single server, session hierarchy | Child discovery, tree display      |
| Multiple servers                 | Grouping by host                   |
| Server disconnect                | Reconnection, stale display        |
| Permission flow                  | Permission indicator, notification |
| Long-running session             | 10min+ detection                   |
| Rapid state changes              | No flicker, debouncing             |

**Usage example:**

```bash
# Terminal 1: Start mock server + announcer
node tools/mock-server.mjs --scenario=hierarchy

# Terminal 2: Start TUI with debug
npm start -- --debug-sse --debug-state

# Or run automated test
npm test -- --run src/connections.test.ts
```

---

### Phase 1: Minimal Plugin

**Status:** Not started

**Goal:** Reduce plugin to presence announcer only.

**Tasks:**

1. Remove all event handling (~300 lines)
2. Remove status state machine
3. Remove busy time tracking
4. Keep serverUrl discovery
5. Keep UDP broadcast (30s interval + startup + shutdown)
6. Change packet type from `oc.status` to `oc.announce`
7. Remove status, sessionID, parentID, cost, tokens, model, busyTime fields

**New plugin size:** ~50 lines

**Test:** Plugin starts, broadcasts announce packets, shuts down cleanly.

---

### Phase 2: Connection Manager

**Status:** Not started

**Goal:** Manage SSE connections to multiple OpenCode servers.

**New file:** `src/connections.ts`

**Tasks:**

1. Create `Server` interface and state
2. Implement connection lifecycle:
   - `connectToServer(serverUrl)` - Create SDK client, subscribe to SSE
   - `disconnectFromServer(serverUrl)` - Abort SSE, cleanup
   - `reconnectWithBackoff(serverUrl)` - Exponential backoff on failure
3. Track connection state (connecting/connected/disconnected)
4. Track disconnected duration for display
5. Handle SSE errors and reconnection
6. Export hooks/callbacks for React integration

**Interface:**

```typescript
interface ConnectionManager {
  servers: Map<string, Server>;

  addServer(announce: AnnouncePacket): void;
  removeServer(serverUrl: string): void;

  onSessionEvent(callback: (serverUrl: string, event: SSEEvent) => void): void;
  onConnectionChange(
    callback: (serverUrl: string, status: ConnectionStatus) => void,
  ): void;
}
```

**Test:** Can connect to OpenCode server, receive events, reconnect on failure.

---

### Phase 3: Session State Management

**Status:** Not started

**Goal:** Build session tree from SDK queries.

**Changes to:** `src/components/AppContext.tsx`

**Tasks:**

1. Replace `instances` Map with `servers` and `sessions` Maps
2. On server connect:
   - Fetch `session.list()` to get all sessions
   - For each session, fetch children recursively
   - Populate sessions Map
3. On SSE events:
   - Update individual session state
   - Add/remove sessions as needed
4. Track busySince locally (set when status becomes busy)
5. Track pendingPermission from permission events
6. Periodic stats refresh (~30s) with caching

**Test:** Sessions appear with correct state, updates are real-time.

---

### Phase 4: Update UDP Handler

**Status:** Not started

**Goal:** Handle new announce-only packets.

**Changes to:** `src/index.tsx` and `src/server.ts`

**Tasks:**

1. Change packet parsing for `oc.announce` type
2. On announce:
   - If new server, add and connect
   - If known server, update lastAnnounce timestamp
3. Periodic cleanup (every 30s):
   - Remove servers with no announce for 3+ minutes
   - Disconnect their SSE connections
4. Remove all status tracking from UDP handler

**Test:** Servers appear when announced, disappear when stale.

---

### Phase 5: Update GroupedView

**Status:** Not started

**Goal:** Display sessions grouped by project:branch:host with hierarchy.

**Changes to:** `src/components/GroupedView.tsx`

**Tasks:**

1. Group sessions by `${project}:${branch}:${host}`
2. Build tree from parentID relationships
3. Show server connection status in group header
4. Add permission indicator (◆) to sessions
5. Update stats calculation to work with new data model

**Test:** Hierarchy displays correctly, permissions visible, connection status shown.

---

### Phase 6: Update Session Viewer

**Status:** Not started

**Goal:** Full parity with foreground OpenCode.

**Changes to:** `src/components/SessionView.tsx`, `SessionWatcher.tsx`

**Tasks:**

1. Use server's existing SSE connection (or dedicated one)
2. Filter events to selected session only
3. Display all message types (text, tool, reasoning)
4. Show tool execution in real-time
5. Show pending permissions with action buttons
6. Implement all actions:
   - Send message via `session.prompt()`
   - Respond to permissions
   - Abort session
7. When viewing parent, don't show child activity inline

**Test:** Full session interaction works.

---

### Phase 7: Cleanup and Polish

**Status:** Not started

**Goal:** Remove dead code, improve UX.

**Tasks:**

1. Remove `src/state.ts` (if no longer needed)
2. Simplify `src/server.ts` to UDP listener only
3. Remove duplicate type definitions
4. Update `src/types.ts` for new model
5. Add "disconnected for Xm" display
6. Add reconnecting spinner/indicator
7. Test notifications for idle and permissions
8. Update `context/architecture.md` for new design

**Test:** All features work, no dead code, clean architecture.

---

## File Changes

| File                                    | Change                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| `tools/mock-server.mjs`                 | **New** - Mock OpenCode server for testing              |
| `tools/fake-sender.mjs`                 | **Update** - New packet format, scenarios               |
| `src/test-utils.ts`                     | **New** - Test helpers                                  |
| `opencode/plugin/oc-session-manager.js` | **Rewrite** - ~50 lines, announce only                  |
| `src/connections.ts`                    | **New** - Connection manager                            |
| `src/components/AppContext.tsx`         | **Major changes** - New state model                     |
| `src/components/GroupedView.tsx`        | **Major changes** - Group by host, show connection      |
| `src/components/InstanceRow.tsx`        | **Rename to SessionRow.tsx** - Add permission indicator |
| `src/components/SessionView.tsx`        | **Moderate changes** - Enhanced display                 |
| `src/components/SessionWatcher.tsx`     | **Simplify** - Use connection manager                   |
| `src/index.tsx`                         | **Moderate changes** - Wire up connection manager       |
| `src/server.ts`                         | **Simplify** - UDP listener only                        |
| `src/state.ts`                          | **Maybe remove** - If fully migrated                    |
| `src/types.ts`                          | **Update** - New interfaces                             |
| `context/architecture.md`               | **Update** - Document new architecture                  |

---

## Testing Strategy

### Unit Tests

1. Connection manager: connect, disconnect, reconnect logic
2. Session tree building from flat list + parentID
3. State transitions (idle → busy, permission handling)
4. Stale server removal logic

### Integration Tests

1. Full flow: plugin announces → TUI connects → sessions appear
2. Session viewer: open, view messages, send prompt
3. Permission flow: permission.updated → display → respond → permission.replied
4. Reconnection: kill server → reconnect → state recovers

### Manual Testing

1. Start multiple OpenCode instances
2. Spawn sub-agents (Task tool)
3. Watch hierarchy build
4. Trigger permissions
5. Kill/restart OpenCode
6. Verify notifications

### Automated Testing with Mock Server

```bash
# Run all scenarios
npm run test:scenarios

# Run specific scenario
node tools/mock-server.mjs --scenario=hierarchy &
npm start -- --debug-sse
```

---

## Migration Notes

### Breaking Changes

1. **Plugin packet format changes** - Old TUI won't understand new packets
2. **UDP packet type** - `oc.status` → `oc.announce`
3. **Many fields removed** from UDP packet

### Rollout Strategy

1. Deploy new plugin and TUI together
2. Old plugin + new TUI: Won't work (missing serverUrl handling)
3. New plugin + old TUI: Won't work (different packet type)
4. Must update both simultaneously

### Rollback

If issues found:

1. Restore plugin from `main` branch (commit 181d0c7)
2. Restore TUI from `main` branch
3. Both must be rolled back together

---

## Open Questions (Resolved)

1. **Stats fetching strategy** - ✅ Resolved
   - Fetch periodically (~30s interval)
   - Cache results to avoid hammering API
   - Primary focus is busy/idle/permission status for user efficiency

2. **Polling fallback** - ✅ Resolved
   - Just show disconnected, no polling fallback
   - Keep it simple - reconnect via SSE or stay disconnected
   - Auto-reconnect with exponential backoff

3. **Existing tests** - Partially addressed
   - Will need rewriting as architecture changes significantly
   - New connection manager needs comprehensive tests
   - Mock server enables autonomous testing

---

## Implementation Order

1. **Phase 0** (Testing Infrastructure) - Enables autonomous development/testing
2. **Phase 1** (Plugin) - Quick win, reduces complexity immediately
3. **Phase 2** (Connections) - Foundation for everything else
4. **Phase 4** (UDP Handler) - Can test Phase 1+2 together
5. **Phase 3** (Session State) - Core functionality
6. **Phase 5** (GroupedView) - Make it visible
7. **Phase 6** (Session Viewer) - Full functionality
8. **Phase 7** (Cleanup) - Polish

**Estimated effort:** 3-4 focused sessions.

---

## Session Notes

Use this section to track progress across sessions.

### Session: 2024-12-24

- Created REFACTOR-PLAN.md
- Documented all design decisions and problems
- Ready to begin Phase 0
