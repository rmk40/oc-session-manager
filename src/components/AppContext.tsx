// React Context for shared application state

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { Instance, ViewMode, Permission, Message, RenderedLine } from '../types.js'
import { STALE_TIMEOUT_MS, LONG_RUNNING_MS } from '../config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppState {
  // Instance tracking
  instances: Map<string, Instance>
  busySince: Map<string, number>
  idleSince: Map<string, number>
  
  // View state
  viewMode: ViewMode
  selectedIndex: number
  collapsedGroups: Set<string>
  detailView: string | null
  
  // Session viewer state
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
  // Instance actions
  setInstance: (id: string, instance: Instance) => void
  removeInstance: (id: string) => void
  clearStaleInstances: () => void
  
  // View actions
  setViewMode: (mode: ViewMode) => void
  setSelectedIndex: (idx: number) => void
  toggleCollapsedGroup: (key: string) => void
  setDetailView: (id: string | null) => void
  
  // Session view actions
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
  
  // Status helpers
  getEffectiveStatus: (instance: Instance) => 'idle' | 'busy' | 'stale'
  isLongRunning: (instance: Instance) => boolean
  getBusyDuration: (instance: Instance) => number
}

export interface AppContextValue {
  state: AppState
  actions: AppActions
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps): React.ReactElement {
  // Instance tracking
  const [instances, setInstances] = useState<Map<string, Instance>>(new Map())
  const [busySince, setBusySince] = useState<Map<string, number>>(new Map())
  const [idleSince, setIdleSince] = useState<Map<string, number>>(new Map())
  
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [detailView, setDetailView] = useState<string | null>(null)
  
  // Session viewer state
  const [sessionViewActive, setSessionViewActive] = useState(false)
  const [sessionViewInstance, setSessionViewInstance] = useState<Instance | null>(null)
  const [sessionViewSessionID, setSessionViewSessionID] = useState<string | null>(null)
  const [sessionViewMessages, setSessionViewMessages] = useState<Message[]>([])
  const [sessionViewScrollOffset, setSessionViewScrollOffset] = useState(0)
  const [sessionViewRenderedLines, setSessionViewRenderedLines] = useState<RenderedLine[]>([])
  const [sessionViewPendingPermissions, setSessionViewPendingPermissions] = useState<Map<string, Permission>>(new Map())
  const [sessionViewInputMode, setSessionViewInputMode] = useState(false)
  const [sessionViewInputBuffer, setSessionViewInputBuffer] = useState('')
  const [sessionViewConfirmAbort, setSessionViewConfirmAbort] = useState(false)
  const [sessionViewError, setSessionViewError] = useState<string | null>(null)
  const [sessionViewConnecting, setSessionViewConnecting] = useState(false)
  const [sessionViewStatus, setSessionViewStatus] = useState('idle')
  const [sessionViewSessions, setSessionViewSessions] = useState<any[]>([])
  const [sessionViewSessionIndex, setSessionViewSessionIndex] = useState(0)
  const [sessionViewSessionTitle, setSessionViewSessionTitle] = useState('')

  // Status helpers
  const getEffectiveStatus = useCallback((instance: Instance): 'idle' | 'busy' | 'stale' => {
    const age = Date.now() - instance.ts
    if (age > STALE_TIMEOUT_MS) return 'stale'
    if (instance.status === 'shutdown') return 'stale'
    if (instance.status === 'busy' || instance.status === 'running' || instance.status === 'pending') {
      return 'busy'
    }
    return 'idle'
  }, [])

  const isLongRunning = useCallback((instance: Instance): boolean => {
    const status = getEffectiveStatus(instance)
    if (status !== 'busy') return false
    const busyStart = busySince.get(instance.instanceId)
    if (!busyStart) return false
    return Date.now() - busyStart > LONG_RUNNING_MS
  }, [busySince, getEffectiveStatus])

  const getBusyDuration = useCallback((instance: Instance): number => {
    const busyStart = busySince.get(instance.instanceId)
    if (!busyStart) return 0
    return Date.now() - busyStart
  }, [busySince])

  // Instance actions
  const setInstance = useCallback((id: string, instance: Instance) => {
    setInstances(prev => {
      const next = new Map(prev)
      const oldInst = prev.get(id)
      const oldStatus = oldInst ? getEffectiveStatus(oldInst) : null
      const newStatus = instance.status
      
      next.set(id, instance)
      
      // Track busy/idle transitions
      if (newStatus === 'busy' && oldStatus !== 'busy') {
        setBusySince(prev => new Map(prev).set(id, Date.now()))
        setIdleSince(prev => {
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      } else if (newStatus === 'idle' && oldStatus !== 'idle') {
        setIdleSince(prev => new Map(prev).set(id, Date.now()))
        setBusySince(prev => {
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      }
      
      return next
    })
  }, [getEffectiveStatus])

  const removeInstance = useCallback((id: string) => {
    setInstances(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setBusySince(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setIdleSince(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const clearStaleInstances = useCallback(() => {
    setInstances(prev => {
      const next = new Map(prev)
      for (const [id, inst] of prev) {
        if (getEffectiveStatus(inst) === 'stale') {
          next.delete(id)
        }
      }
      return next
    })
  }, [getEffectiveStatus])

  // View actions
  const toggleCollapsedGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  // Session view actions
  const enterSessionView = useCallback((instance: Instance) => {
    setSessionViewActive(true)
    setSessionViewInstance(instance)
    setSessionViewSessionID(instance.sessionID || null)
    setSessionViewConnecting(true)
    setSessionViewMessages([])
    setSessionViewScrollOffset(0)
    setSessionViewRenderedLines([])
    setSessionViewPendingPermissions(new Map())
    setSessionViewInputMode(false)
    setSessionViewInputBuffer('')
    setSessionViewConfirmAbort(false)
    setSessionViewError(null)
    setSessionViewStatus(String(instance.status || 'idle'))
    setSessionViewSessions([])
    setSessionViewSessionIndex(0)
    setSessionViewSessionTitle('')
  }, [])

  const exitSessionView = useCallback(() => {
    setSessionViewActive(false)
    setSessionViewInstance(null)
    setSessionViewSessionID(null)
    setSessionViewConnecting(false)
    setSessionViewMessages([])
    setSessionViewScrollOffset(0)
    setSessionViewRenderedLines([])
    setSessionViewPendingPermissions(new Map())
    setSessionViewInputMode(false)
    setSessionViewInputBuffer('')
    setSessionViewConfirmAbort(false)
    setSessionViewError(null)
    setSessionViewStatus('idle')
    setSessionViewSessions([])
    setSessionViewSessionIndex(0)
    setSessionViewSessionTitle('')
  }, [])

  const addPermission = useCallback((permission: Permission) => {
    setSessionViewPendingPermissions(prev => new Map(prev).set(permission.id, permission))
  }, [])

  const removePermission = useCallback((id: string) => {
    setSessionViewPendingPermissions(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const state: AppState = {
    instances,
    busySince,
    idleSince,
    viewMode,
    selectedIndex,
    collapsedGroups,
    detailView,
    sessionViewActive,
    sessionViewInstance,
    sessionViewSessionID,
    sessionViewMessages,
    sessionViewScrollOffset,
    sessionViewRenderedLines,
    sessionViewPendingPermissions,
    sessionViewInputMode,
    sessionViewInputBuffer,
    sessionViewConfirmAbort,
    sessionViewError,
    sessionViewConnecting,
    sessionViewStatus,
    sessionViewSessions,
    sessionViewSessionIndex,
    sessionViewSessionTitle,
  }

  const actions: AppActions = {
    setInstance,
    removeInstance,
    clearStaleInstances,
    setViewMode,
    setSelectedIndex,
    toggleCollapsedGroup,
    setDetailView,
    enterSessionView,
    exitSessionView,
    setSessionViewScrollOffset,
    setSessionViewInputMode,
    setSessionViewInputBuffer,
    setSessionViewConfirmAbort,
    setSessionViewError,
    setSessionViewConnecting,
    setSessionViewStatus,
    setSessionViewMessages,
    setSessionViewRenderedLines,
    setSessionViewSessions,
    setSessionViewSessionIndex,
    setSessionViewSessionTitle,
    addPermission,
    removePermission,
    getEffectiveStatus,
    isLongRunning,
    getBusyDuration,
  }

  return (
    <AppContext.Provider value={{ state, actions }}>
      {children}
    </AppContext.Provider>
  )
}
