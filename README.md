# oc-session-manager

Monitor and manage multiple OpenCode instances from a single TUI dashboard.

## Quick Start

```bash
# Install dependencies and build
npm install
npm run build

# Run the TUI
npm start

# Or during development (with hot reload)
npm run dev
```

## Plugin Installation

```bash
# Copy plugin to OpenCode's plugin directory
mkdir -p ~/.config/opencode/plugin
cp opencode/plugin/oc-session-manager.js ~/.config/opencode/plugin/

# Set your desktop IP if running in a container
export OC_SESSION_HOST=192.168.1.50
```

## Overview

When running multiple OpenCode sessions (especially in Docker containers), it's useful to know at a glance which instances are:
- **IDLE** - Ready for your input
- **BUSY** - Currently processing (with animated spinner)
- **LONG RUNNING** - Busy for longer than expected (highlighted in red)
- **STALE** - No heartbeat received (instance may have closed)

## Features

| Feature | Description |
|---------|-------------|
| **Desktop Notifications** | Get notified instantly when any session becomes idle (BUSY → IDLE) |
| **Grouped by Branch** | Instances organized by `project:branch` with collapsible groups |
| **Cost & Token Tracking** | See cumulative cost and tokens per session and per group |
| **Long-Running Detection** | Sessions busy >10min highlighted in red with `!` indicator |
| **Animated Spinners** | Busy sessions show animated braille spinner |
| **Session Viewer** | Press Enter to view live session messages with SSE streaming |
| **Abort Sessions** | Stop busy sessions from the TUI |
| **Quick Removal** | Press `d` to immediately remove stale/dead sessions |
| **Dual View Modes** | Toggle between grouped and flat views with Tab |

## Keyboard Shortcuts

### Main List

| Key | Action |
|-----|--------|
| `q` | Quit |
| `↑`/`↓` or `k`/`j` | Navigate/select rows |
| `Enter` | Expand/collapse group, or open session viewer |
| `i` | Open detail view |
| `a` | Abort selected busy session |
| `d` | Remove selected instance (or entire group) |
| `Esc` | Clear selection |
| `Tab` | Toggle grouped/flat view |
| `c` | Clear all stale instances |
| `r` | Force refresh |

### Session Viewer

| Key | Action |
|-----|--------|
| `Esc` / `q` | Return to main list |
| `↑`/`↓` | Scroll messages |
| `Ctrl+←/→` | Switch between parent/child sessions |
| `a` | Abort session (with confirmation) |
| `m` | Send a message to the session |
| `a`/`A` | Allow permission (once / always) |
| `d`/`D` | Deny permission (once / always) |

## Environment Variables

### TUI

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_PORT` | `19876` | UDP port for communication |
| `OC_SESSION_TIMEOUT` | `120` | Seconds before instance marked stale |
| `OC_SESSION_LONG_RUNNING` | `10` | Minutes before busy instance flagged as long-running |
| `OC_SESSION_NOTIFY` | `1` | Set to `0` to disable desktop notifications |

### Plugin

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_SESSION_HOST` | `127.0.0.1` | IP(s) of machine(s) running TUI (comma-separated) |
| `OC_SESSION_PORT` | `19876` | UDP port for communication |
| `OC_SESSION_DEBUG` | `0` | Set to `1` to enable plugin debug logging |
| `OC_SESSION_IDLE_LIMIT` | `5` | Consecutive idle heartbeats to send before stopping |

## Architecture

```
┌─────────────────────┐         UDP          ┌─────────────────────┐
│  Docker Container   │  ──────────────────► │   Your Desktop      │
│  (OpenCode)         │    port 19876        │   (TUI display)     │
│                     │                      │                     │
│  oc-session-manager │   status updates     │   oc-session-manager│
│  plugin             │   every 30s +        │   TUI               │
│                     │   on state change    │                     │
└─────────────────────┘                      └─────────────────────┘
```

1. **Plugin** - Broadcasts status changes via UDP
2. **TUI** - Receives UDP packets and displays live status

## CLI Options

```bash
oc-session-manager              # Run TUI (default)
oc-session-manager --daemon     # Run as background daemon (notifications only)
oc-session-manager --status     # Check if daemon is running
oc-session-manager --stop       # Stop the daemon
oc-session-manager --debug      # Show raw UDP packets
```

## Development

```bash
# Run with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## License

MIT
