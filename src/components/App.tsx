// Main App component - Full-screen TUI using Ink best practices

import React, { useState, useEffect, useMemo } from 'react'
import { Box, useApp as useInkApp, useInput, useStdout } from 'ink'
import { useAppState, useAppActions, useViewState, useStatusHelpers } from './AppContext.js'
import { Header } from './Header.js'
import { GroupedView } from './GroupedView.js'
import { FlatView } from './FlatView.js'
import { DetailView } from './DetailView.js'
import { SessionView } from './SessionView.js'
import { HelpBar } from './HelpBar.js'
import type { Instance } from '../types.js'

// Spinner context to share frame across components
export const SpinnerContext = React.createContext(0)

export function App(): React.ReactElement {
  const { exit } = useInkApp()
  const { stdout } = useStdout()
  const { instances } = useAppState()
  const { viewMode, selectedIndex, collapsedGroups, detailView, sessionViewActive } = useViewState()
  const actions = useAppActions()
  const { getEffectiveStatus } = useStatusHelpers()
  
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  
  // Get terminal dimensions
  const termWidth = stdout?.columns || 80
  const termHeight = stdout?.rows || 24
  
  // Check if any instance is busy (for spinner animation)
  const hasBusyInstances = useMemo(() => {
    for (const inst of instances.values()) {
      if (getEffectiveStatus(inst) === 'busy') return true
    }
    return false
  }, [instances, getEffectiveStatus])
  
  // Main animation loop - updates currentTime
  useEffect(() => {
    const interval = setInterval(() => {
      actions.tick()
    }, 1000)
    return () => clearInterval(interval)
  }, [actions.tick])
  
  // Spinner update
  useEffect(() => {
    if (!hasBusyInstances) return
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % 10)
    }, 150)
    return () => clearInterval(interval)
  }, [hasBusyInstances])
  
  // Handle keyboard input
  useInput((input, key) => {
    if (sessionViewActive) return
    if (detailView) {
        if (key.escape || key.return) actions.setDetailView(null)
        return
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit()
      return
    }
    
    const itemCount = getSelectableItemCount()
    
    if (key.upArrow || input === 'k') {
      if (selectedIndex > 0) actions.setSelectedIndex(selectedIndex - 1)
      else if (selectedIndex === -1 && itemCount > 0) actions.setSelectedIndex(itemCount - 1)
      return
    }
    
    if (key.downArrow || input === 'j') {
      if (selectedIndex < itemCount - 1) actions.setSelectedIndex(selectedIndex + 1)
      return
    }
    
    if (key.tab) {
      actions.setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')
      actions.setSelectedIndex(-1)
      return
    }
    
    if (key.return) {
      handleEnterKey()
      return
    }
    
    if (input === 'i') {
      const item = getSelectedItem()
      if (item?.type === 'instance' && item.instanceId) actions.setDetailView(item.instanceId)
      return
    }
    
    if (input === 'd' || key.delete || key.backspace) {
      handleDelete()
      return
    }
    
    if (input === 'c') {
      actions.clearStaleInstances()
      return
    }
    
    if (key.escape) {
      actions.setSelectedIndex(-1)
      return
    }
  })

  function getSelectableItemCount(): number {
    if (viewMode === 'flat') return instances.size
    const groups = getGroupedInstances()
    let count = 0
    for (const [groupKey, groupInstances] of groups) {
      count++
      if (!collapsedGroups.has(groupKey)) count += groupInstances.length
    }
    return count
  }

  function getSelectedItem(): { type: 'group' | 'instance'; key?: string; instanceId?: string } | null {
    if (selectedIndex < 0) return null
    if (viewMode === 'flat') {
      const insts = Array.from(instances.values())
      return selectedIndex < insts.length ? { type: 'instance', instanceId: insts[selectedIndex].instanceId } : null
    }
    const groups = getGroupedInstances()
    let idx = 0
    for (const [groupKey, groupInstances] of groups) {
      if (idx === selectedIndex) return { type: 'group', key: groupKey }
      idx++
      if (!collapsedGroups.has(groupKey)) {
        for (const inst of groupInstances) {
          if (idx === selectedIndex) return { type: 'instance', instanceId: inst.instanceId }
          idx++
        }
      }
    }
    return null
  }

  function handleEnterKey(): void {
    const item = getSelectedItem()
    if (!item) return
    if (item.type === 'group' && item.key) actions.toggleCollapsedGroup(item.key)
    else if (item.type === 'instance' && item.instanceId) {
      const inst = instances.get(item.instanceId)
      if (inst) actions.enterSessionView(inst)
    }
  }

  function handleDelete(): void {
    const item = getSelectedItem()
    if (!item) return
    if (item.type === 'instance' && item.instanceId) actions.removeInstance(item.instanceId)
    else if (item.type === 'group' && item.key) {
      for (const inst of instances.values()) {
        const project = inst.project || inst.dirName || 'unknown'
        const branch = inst.branch || 'main'
        if (`${project}:${branch}` === item.key) actions.removeInstance(inst.instanceId)
      }
    }
  }

  function getGroupedInstances(): [string, Instance[]][] {
    const sorted = Array.from(instances.values()).sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
    const groups = new Map<string, Instance[]>()
    for (const inst of sorted) {
      const project = inst.project || inst.dirName || 'unknown'
      const branch = inst.branch || 'main'
      const key = `${project}:${branch}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(inst)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }

  // Views
  if (sessionViewActive) {
    return (
      <SpinnerContext.Provider value={spinnerFrame}>
        <Box width="100%" height="100%">
          <SessionView />
        </Box>
      </SpinnerContext.Provider>
    )
  }
  
  if (detailView) {
    const inst = instances.get(detailView)
    if (inst) return (
      <SpinnerContext.Provider value={spinnerFrame}>
        <Box width="100%" height="100%">
          <DetailView instance={inst} />
        </Box>
      </SpinnerContext.Provider>
    )
  }

  return (
    <SpinnerContext.Provider value={spinnerFrame}>
      <Box 
        flexDirection="column" 
        width="100%"
        height="100%"
      >
        <Header />
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {viewMode === 'grouped' ? <GroupedView /> : <FlatView />}
        </Box>
        <HelpBar />
      </Box>
    </SpinnerContext.Provider>
  )
}
