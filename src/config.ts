// Configuration, constants, and ANSI codes

import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Environment Variables
// ---------------------------------------------------------------------------

export const PORT = parseInt(process.env.OC_SESSION_PORT || '', 10) || 19876
export const STALE_TIMEOUT_SEC = parseInt(process.env.OC_SESSION_TIMEOUT || '', 10) || 120
export const STALE_TIMEOUT_MS = STALE_TIMEOUT_SEC * 1000
export const LONG_RUNNING_MIN = parseInt(process.env.OC_SESSION_LONG_RUNNING || '', 10) || 10
export const LONG_RUNNING_MS = LONG_RUNNING_MIN * 60 * 1000
export const NOTIFY_ENABLED = process.env.OC_SESSION_NOTIFY !== '0'
export const DEBUG = process.env.OC_SESSION_DEBUG === '1'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const PID_FILE = join(homedir(), '.oc-session-manager.pid')
export const LOG_FILE = join(homedir(), '.oc-session-manager.log')

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

export const REFRESH_INTERVAL = 1000
export const SESSION_REFRESH_INTERVAL = 5000

// ---------------------------------------------------------------------------
// ANSI Escape Codes
// ---------------------------------------------------------------------------

export const ANSI = {
  // Reset
  reset: '\x1b[0m',
  
  // Styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  
  // Cursor
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  cursorHome: '\x1b[H',
  
  // Screen
  clearScreen: '\x1b[2J',
  clearLine: '\x1b[2K',
  
  // Alternate screen buffer (like vim, htop, less)
  enterAltScreen: '\x1b[?1049h',
  exitAltScreen: '\x1b[?1049l',
  
  // Inverse (swap fg/bg)
  inverse: '\x1b[7m',
}

// ---------------------------------------------------------------------------
// Spinner Frames
// ---------------------------------------------------------------------------

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
