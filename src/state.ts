// Global state management

import type { 
  Instance, 
  ViewMode, 
  SelectableItem, 
  RenderedLine, 
  Permission, 
  ServerConnection,
  Message
} from './types.js'

// ---------------------------------------------------------------------------
// Instance Tracking
// ---------------------------------------------------------------------------

export const instances = new Map<string, Instance>()
export const busySince = new Map<string, number>()
export const idleSince = new Map<string, number>()

// ---------------------------------------------------------------------------
// Server Connections
// ---------------------------------------------------------------------------

export const serverConnections = new Map<string, ServerConnection>()

// ---------------------------------------------------------------------------
// View State
// ---------------------------------------------------------------------------

export let viewMode: ViewMode = 'grouped'
export let selectedIndex = -1
export let selectableItems: SelectableItem[] = []
export let collapsedGroups = new Set<string>()
export let detailView: string | null = null
export let spinnerFrame = 0
export let termWidth = 80
export let termHeight = 24

// ---------------------------------------------------------------------------
// Session Viewer State
// ---------------------------------------------------------------------------

export let sessionViewActive = false
export let sessionViewClient: any = null
export let sessionViewInstance: Instance | null = null
export let sessionViewSessionID: string | null = null
export let sessionViewMessages: Message[] = []
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

// ---------------------------------------------------------------------------
// State Setters
// ---------------------------------------------------------------------------

export function setViewMode(mode: ViewMode) { viewMode = mode }
export function setSelectedIndex(idx: number) { selectedIndex = idx }
export function setSelectableItems(items: SelectableItem[]) { selectableItems = items }
export function setDetailView(view: string | null) { detailView = view }
export function setSpinnerFrame(frame: number) { spinnerFrame = frame }
export function setTermSize(width: number, height: number) { 
  termWidth = width
  termHeight = height
}

// Session viewer setters
export function setSessionViewActive(active: boolean) { sessionViewActive = active }
export function setSessionViewClient(client: any) { sessionViewClient = client }
export function setSessionViewInstance(inst: Instance | null) { sessionViewInstance = inst }
export function setSessionViewSessionID(id: string | null) { sessionViewSessionID = id }
export function setSessionViewMessages(msgs: Message[]) { sessionViewMessages = msgs }
export function setSessionViewScrollOffset(offset: number) { sessionViewScrollOffset = offset }
export function setSessionViewRenderedLines(lines: RenderedLine[]) { sessionViewRenderedLines = lines }
export function setSessionViewInputMode(mode: boolean) { sessionViewInputMode = mode }
export function setSessionViewInputBuffer(buffer: string) { sessionViewInputBuffer = buffer }
export function setSessionViewConfirmAbort(confirm: boolean) { sessionViewConfirmAbort = confirm }
export function setSessionViewError(error: string | null) { sessionViewError = error }
export function setSessionViewConnecting(connecting: boolean) { sessionViewConnecting = connecting }
export function setSessionViewStatus(status: string) { sessionViewStatus = status }
export function setSessionViewSessions(sessions: any[]) { sessionViewSessions = sessions }
export function setSessionViewSessionIndex(idx: number) { sessionViewSessionIndex = idx }
export function setSessionViewSessionTitle(title: string) { sessionViewSessionTitle = title }
export function setSessionViewEventAbort(abort: AbortController | null) { sessionViewEventAbort = abort }

// ---------------------------------------------------------------------------
// State Reset Functions
// ---------------------------------------------------------------------------

export function resetSessionViewState() {
  sessionViewActive = false
  sessionViewClient = null
  sessionViewInstance = null
  sessionViewSessionID = null
  sessionViewMessages = []
  sessionViewScrollOffset = 0
  sessionViewRenderedLines = []
  sessionViewPendingPermissions.clear()
  sessionViewInputMode = false
  sessionViewInputBuffer = ''
  sessionViewConfirmAbort = false
  sessionViewError = null
  sessionViewConnecting = false
  sessionViewStatus = 'idle'
  sessionViewSessions = []
  sessionViewSessionIndex = 0
  sessionViewSessionTitle = ''
  if (sessionViewEventAbort) {
    sessionViewEventAbort.abort()
    sessionViewEventAbort = null
  }
}
