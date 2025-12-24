// React Context for shared application state

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react'
import type { Instance, ViewMode, Permission, Message, RenderedLine } from '../types.js'
import { STALE_TIMEOUT_MS, LONG_RUNNING_MS } from '../config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppState {
  instances: Map<string, Instance>
  busySince: Map<string, number>
  idleSince: Map<string, number>
}

export interface ViewState {
  viewMode: ViewMode
  selectedIndex: number
  collapsedGroups: Set<string>
  detailView: string | null
  sessionViewActive: boolean
  sessionViewInstance: Instance | null
  sessionViewSessionID: string | null
  sessionViewMessages: Message[]
  sessionViewScrollOffset: number
  sessionViewRenderedLines: RenderedLine[]
  sessionViewPendingPermissions: Map<string, Permission>
  sessionViewInputMode: boolean
  sessionViewInputBuffer: string
  sessionViewConfirmAbort: boolean
  sessionViewError: string | null
  sessionViewConnecting: boolean
  sessionViewStatus: string
  sessionViewSessions: any[]
  sessionViewSessionIndex: number
  sessionViewSessionTitle: string
}

export interface AppActions {
  setInstance: (id: string, instance: Instance) => void
  removeInstance: (id: string) => void
  clearStaleInstances: () => void
  setViewMode: (mode: ViewMode) => void
  setSelectedIndex: (idx: number) => void
  toggleCollapsedGroup: (key: string) => void
  setDetailView: (id: string | null) => void
  enterSessionView: (instance: Instance) => void
  exitSessionView: () => void
  setSessionViewScrollOffset: (offset: number) => void
  setSessionViewInputMode: (mode: boolean) => void
  setSessionViewInputBuffer: (buffer: string) => void
  setSessionViewConfirmAbort: (confirm: boolean) => void
  setSessionViewError: (error: string | null) => void
  setSessionViewConnecting: (connecting: boolean) => void
  setSessionViewStatus: (status: string) => void
  setSessionViewMessages: (messages: Message[]) => void
  setSessionViewRenderedLines: (lines: RenderedLine[]) => void
  setSessionViewSessions: (sessions: any[]) => void
  setSessionViewSessionIndex: (idx: number) => void
  setSessionViewSessionTitle: (title: string) => void
  addPermission: (permission: Permission) => void
  removePermission: (id: string) => void
  tick: (now?: number) => void
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const AppStateContext = createContext<AppState | null>(null)
const ViewStateContext = createContext<ViewState | null>(null)
const AppActionsContext = createContext<AppActions | null>(null)
const TimeContext = createContext<number>(Date.now())

export function useAppState(): AppState {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used within AppProvider')
  return context
}

export function useViewState(): ViewState {
  const context = useContext(ViewStateContext)
  if (!context) throw new Error('useViewState must be used within AppProvider')
  return context
}

export function useAppActions(): AppActions {
  const context = useContext(AppActionsContext)
  if (!context) throw new Error('useAppActions must be used within AppProvider')
  return context
}

export function useTime(): number {
  return useContext(TimeContext)
}

export function useStatusHelpers() {
  const { busySince } = useAppState()
  const currentTime = useTime()
  
  const getEffectiveStatus = useCallback((instance: Instance): 'idle' | 'busy' | 'stale' => {
    const age = currentTime - instance.ts
    if (age > STALE_TIMEOUT_MS) return 'stale'
    if (instance.status === 'shutdown') return 'stale'
    if (['busy', 'running', 'pending'].includes(instance.status)) return 'busy'
    return 'idle'
  }, [currentTime])

  const isLongRunning = useCallback((instance: Instance): boolean => {
    if (getEffectiveStatus(instance) !== 'busy') return false
    const busyStart = busySince.get(instance.instanceId)
    return busyStart ? (currentTime - busyStart > LONG_RUNNING_MS) : false
  }, [currentTime, getEffectiveStatus, busySince])

  const getBusyDuration = useCallback((instance: Instance): number => {
    const busyStart = busySince.get(instance.instanceId)
    return busyStart ? (currentTime - busyStart) : 0
  }, [currentTime, busySince])

  return { getEffectiveStatus, isLongRunning, getBusyDuration }
}

// Legacy hook for compatibility
export function useApp(): { state: AppState & ViewState & { currentTime: number }; actions: AppActions } {
  const appState = useAppState()
  const viewState = useViewState()
  const actions = useAppActions()
  const currentTime = useTime()
  return { state: { ...appState, ...viewState, currentTime }, actions }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }): React.ReactElement {
  // Instance tracking
  const [instances, setInstances] = useState<Map<string, Instance>>(new Map())
  const [busySince, setBusySince] = useState<Map<string, number>>(new Map())
  const [idleSince, setIdleSince] = useState<Map<string, number>>(new Map())
  const [currentTime, setCurrentTime] = useState<number>(Date.now())
  
  // View state
  const [viewMode, setViewModeInternal] = useState<ViewMode>('grouped')
  const [selectedIndex, setSelectedIndexInternal] = useState(-1)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [detailView, setDetailViewInternal] = useState<string | null>(null)
  
  // Session viewer state
  const [sessionViewActive, setSessionViewActive] = useState(false)
  const [sessionViewInstance, setSessionViewInstance] = useState<Instance | null>(null)
  const [sessionViewSessionID, setSessionViewSessionID] = useState<string | null>(null)
  const [sessionViewMessages, setSessionViewMessagesInternal] = useState<Message[]>([])
  const [sessionViewScrollOffset, setSessionViewScrollOffsetInternal] = useState(0)
  const [sessionViewRenderedLines, setSessionViewRenderedLinesInternal] = useState<RenderedLine[]>([])
  const [sessionViewPendingPermissions, setSessionViewPendingPermissions] = useState<Map<string, Permission>>(new Map())
  const [sessionViewInputMode, setSessionViewInputModeInternal] = useState(false)
  const [sessionViewInputBuffer, setSessionViewInputBufferInternal] = useState('')
  const [sessionViewConfirmAbort, setSessionViewConfirmAbortInternal] = useState(false)
  const [sessionViewError, setSessionViewErrorInternal] = useState<string | null>(null)
  const [sessionViewConnecting, setSessionViewConnectingInternal] = useState(false)
  const [sessionViewStatus, setSessionViewStatusInternal] = useState('idle')
  const [sessionViewSessions, setSessionViewSessionsInternal] = useState<any[]>([])
  const [sessionViewSessionIndex, setSessionViewSessionIndexInternal] = useState(0)
  const [sessionViewSessionTitle, setSessionViewSessionTitleInternal] = useState('')

  // Throttle state updates
  const instancesRef = useRef<Map<string, Instance>>(new Map())
  const dirtyRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) {
        setInstances(new Map(instancesRef.current))
        dirtyRef.current = false
      }
    }, 100) // Flush updates every 100ms
    return () => clearInterval(interval)
  }, [])

  const tick = useCallback((now?: number) => setCurrentTime(now || Date.now()), [])

  const setInstance = useCallback((id: string, instance: Instance) => {
    instancesRef.current.set(id, instance)
    dirtyRef.current = true
    
    // Manage busy/idle timestamps in a separate state update (less frequent than heartbeats)
    setBusySince(prevBusy => {
      const oldInst = instancesRef.current.get(id)
      const getStat = (inst: Instance | undefined) => {
          if (!inst) return null
          if (Date.now() - inst.ts > STALE_TIMEOUT_MS || inst.status === 'shutdown') return 'stale'
          return ['busy', 'running', 'pending'].includes(inst.status) ? 'busy' : 'idle'
      }
      const newStatus = getStat(instance)
      const oldStatus = oldInst ? getStat(oldInst) : null

      if (newStatus === 'busy' && oldStatus !== 'busy') {
        return new Map(prevBusy).set(id, Date.now())
      }
      return prevBusy
    })
  }, [])

  const removeInstance = useCallback((id: string) => {
    instancesRef.current.delete(id)
    setInstances(new Map(instancesRef.current))
    setBusySince(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next })
    setIdleSince(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next })
  }, [])

  const clearStaleInstances = useCallback(() => {
    const now = Date.now()
    for (const [id, inst] of instancesRef.current) {
      if (now - inst.ts > STALE_TIMEOUT_MS || inst.status === 'shutdown') {
        instancesRef.current.delete(id)
      }
    }
    setInstances(new Map(instancesRef.current))
  }, [])

  const setViewMode = useCallback((mode: ViewMode) => setViewModeInternal(mode), [])
  const setSelectedIndex = useCallback((idx: number) => setSelectedIndexInternal(idx), [])
  const toggleCollapsedGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }, [])
  const setDetailView = useCallback((id: string | null) => setDetailViewInternal(id), [])

  const enterSessionView = useCallback((instance: Instance) => {
    setSessionViewActive(true); setSessionViewInstance(instance); setSessionViewSessionID(instance.sessionID || null); setSessionViewConnectingInternal(true)
    setSessionViewMessagesInternal([]); setSessionViewScrollOffsetInternal(0); setSessionViewRenderedLinesInternal([]); setSessionViewPendingPermissions(new Map())
    setSessionViewInputModeInternal(false); setSessionViewInputBufferInternal(''); setSessionViewConfirmAbortInternal(false); setSessionViewErrorInternal(null)
    setSessionViewStatusInternal(String(instance.status || 'idle')); setSessionViewSessionsInternal([]); setSessionViewSessionIndexInternal(0); setSessionViewSessionTitleInternal('')
  }, [])

  const exitSessionView = useCallback(() => {
    setSessionViewActive(false); setSessionViewInstance(null); setSessionViewSessionID(null); setSessionViewConnectingInternal(false)
    setSessionViewMessagesInternal([]); setSessionViewScrollOffsetInternal(0); setSessionViewRenderedLinesInternal([]); setSessionViewPendingPermissions(new Map())
    setSessionViewInputModeInternal(false); setSessionViewInputBufferInternal(''); setSessionViewConfirmAbortInternal(false); setSessionViewErrorInternal(null)
    setSessionViewStatusInternal('idle'); setSessionViewSessionsInternal([]); setSessionViewSessionIndexInternal(0); setSessionViewSessionTitleInternal('')
  }, [])

  const setSessionViewScrollOffset = useCallback((offset: number) => setSessionViewScrollOffsetInternal(offset), [])
  const setSessionViewInputMode = useCallback((mode: boolean) => setSessionViewInputModeInternal(mode), [])
  const setSessionViewInputBuffer = useCallback((buffer: string) => setSessionViewInputBufferInternal(buffer), [])
  const setSessionViewConfirmAbort = useCallback((confirm: boolean) => setSessionViewConfirmAbortInternal(confirm), [])
  const setSessionViewError = useCallback((error: string | null) => setSessionViewErrorInternal(error), [])
  const setSessionViewConnecting = useCallback((connecting: boolean) => setSessionViewConnectingInternal(connecting), [])
  const setSessionViewStatus = useCallback((status: string) => setSessionViewStatusInternal(status), [])
  const setSessionViewMessages = useCallback((messages: Message[]) => setSessionViewMessagesInternal(messages), [])
  const setSessionViewRenderedLines = useCallback((lines: RenderedLine[]) => setSessionViewRenderedLinesInternal(lines), [])
  const setSessionViewSessions = useCallback((sessions: any[]) => setSessionViewSessionsInternal(sessions), [])
  const setSessionViewSessionIndex = useCallback((idx: number) => setSessionViewSessionIndexInternal(idx), [])
  const setSessionViewSessionTitle = useCallback((title: string) => setSessionViewSessionTitleInternal(title), [])

  const addPermission = useCallback((permission: Permission) => {
    setSessionViewPendingPermissions(prev => new Map(prev).set(permission.id, permission))
  }, [])

  const removePermission = useCallback((id: string) => {
    setSessionViewPendingPermissions(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next })
  }, [])

  const actions = useMemo<AppActions>(() => ({
    setInstance, removeInstance, clearStaleInstances, setViewMode, setSelectedIndex, toggleCollapsedGroup, setDetailView,
    enterSessionView, exitSessionView, setSessionViewScrollOffset, setSessionViewInputMode, setSessionViewInputBuffer,
    setSessionViewConfirmAbort, setSessionViewError, setSessionViewConnecting, setSessionViewStatus, setSessionViewMessages,
    setSessionViewRenderedLines, setSessionViewSessions, setSessionViewSessionIndex, setSessionViewSessionTitle,
    addPermission, removePermission, tick
  }), [
    setInstance, removeInstance, clearStaleInstances, setViewMode, setSelectedIndex, toggleCollapsedGroup, setDetailView,
    enterSessionView, exitSessionView, setSessionViewScrollOffset, setSessionViewInputMode, setSessionViewInputBuffer,
    setSessionViewConfirmAbort, setSessionViewError, setSessionViewConnecting, setSessionViewStatus, setSessionViewMessages,
    setSessionViewRenderedLines, setSessionViewSessions, setSessionViewSessionIndex, setSessionViewSessionTitle,
    addPermission, removePermission, tick
  ])

  const appState = useMemo<AppState>(() => ({ instances, busySince, idleSince }), [instances, busySince, idleSince])

  const viewState = useMemo<ViewState>(() => ({
    viewMode, 
    selectedIndex, 
    collapsedGroups, 
    detailView, 
    sessionViewActive, 
    sessionViewInstance, 
    sessionViewSessionID,
    sessionViewMessages: sessionViewMessagesInternal, 
    sessionViewScrollOffset: sessionViewScrollOffsetInternal, 
    sessionViewRenderedLines: sessionViewRenderedLinesInternal, 
    sessionViewPendingPermissions,
    sessionViewInputMode: sessionViewInputModeInternal, 
    sessionViewInputBuffer: sessionViewInputBufferInternal, 
    sessionViewConfirmAbort: sessionViewConfirmAbortInternal, 
    sessionViewError: sessionViewErrorInternal, 
    sessionViewConnecting: sessionViewConnectingInternal,
    sessionViewStatus: sessionViewStatusInternal, 
    sessionViewSessions: sessionViewSessionsInternal, 
    sessionViewSessionIndex: sessionViewSessionIndexInternal, 
    sessionViewSessionTitle: sessionViewSessionTitleInternal
  }), [
    viewMode, selectedIndex, collapsedGroups, detailView, sessionViewActive, sessionViewInstance, sessionViewSessionID,
    sessionViewMessagesInternal, sessionViewScrollOffsetInternal, sessionViewRenderedLinesInternal, sessionViewPendingPermissions,
    sessionViewInputModeInternal, sessionViewInputBufferInternal, sessionViewConfirmAbortInternal, sessionViewErrorInternal, sessionViewConnectingInternal,
    sessionViewStatusInternal, sessionViewSessionsInternal, sessionViewSessionIndexInternal, sessionViewSessionTitleInternal
  ])

  return (
    <AppActionsContext.Provider value={actions}>
      <AppStateContext.Provider value={appState}>
        <ViewStateContext.Provider value={viewState}>
          <TimeContext.Provider value={currentTime}>
            {children}
          </TimeContext.Provider>
        </ViewStateContext.Provider>
      </AppStateContext.Provider>
    </AppActionsContext.Provider>
  )
}
