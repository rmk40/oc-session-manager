// Main App component

import React, { useEffect } from 'react'
import { Box, useApp as useInkApp, useInput, useStdout } from 'ink'
import { useApp } from './AppContext.js'
import { Header } from './Header.js'
import { GroupedView } from './GroupedView.js'
import { FlatView } from './FlatView.js'
import { DetailView } from './DetailView.js'
import { SessionView } from './SessionView.js'
import { HelpBar } from './HelpBar.js'

export function App(): React.ReactElement {
  const { exit } = useInkApp()
  const { state, actions } = useApp()
  const { stdout } = useStdout()
  
  // Handle keyboard input
  useInput((input, key) => {
    // Session view has its own input handling
    if (state.sessionViewActive) {
      handleSessionViewInput(input, key)
      return
    }
    
    // Detail view
    if (state.detailView) {
      handleDetailViewInput(input, key)
      return
    }
    
    // Main view
    handleMainInput(input, key)
  })

  function handleMainInput(input: string, key: any): void {
    // Quit
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit()
      return
    }
    
    // Get selectable items count
    const itemCount = getSelectableItemCount()
    
    // Navigation
    if (key.upArrow || input === 'k') {
      if (state.selectedIndex > 0) {
        actions.setSelectedIndex(state.selectedIndex - 1)
      } else if (state.selectedIndex === -1 && itemCount > 0) {
        actions.setSelectedIndex(itemCount - 1)
      }
      return
    }
    
    if (key.downArrow || input === 'j') {
      if (state.selectedIndex < itemCount - 1) {
        actions.setSelectedIndex(state.selectedIndex + 1)
      }
      return
    }
    
    // Toggle view mode
    if (key.tab) {
      actions.setViewMode(state.viewMode === 'grouped' ? 'flat' : 'grouped')
      actions.setSelectedIndex(-1)
      return
    }
    
    // Enter: expand/collapse group or open session viewer
    if (key.return) {
      handleEnterKey()
      return
    }
    
    // 'i' for info (detail view)
    if (input === 'i') {
      const item = getSelectedItem()
      if (item?.type === 'instance' && item.instanceId) {
        actions.setDetailView(item.instanceId)
      }
      return
    }
    
    // Delete selected
    if (input === 'd' || key.delete || key.backspace) {
      handleDelete()
      return
    }
    
    // Clear stale
    if (input === 'c') {
      actions.clearStaleInstances()
      return
    }
    
    // Escape clears selection
    if (key.escape) {
      actions.setSelectedIndex(-1)
      return
    }
  }

  function handleDetailViewInput(input: string, key: any): void {
    if (key.escape || key.return) {
      actions.setDetailView(null)
      return
    }
    
    if (input === 'd') {
      if (state.detailView) {
        actions.removeInstance(state.detailView)
        actions.setDetailView(null)
      }
      return
    }
  }

  function handleSessionViewInput(input: string, key: any): void {
    // Input mode
    if (state.sessionViewInputMode) {
      if (key.escape) {
        actions.setSessionViewInputMode(false)
        actions.setSessionViewInputBuffer('')
        return
      }
      if (key.return) {
        // Send message - handled externally
        return
      }
      if (key.backspace) {
        actions.setSessionViewInputBuffer(state.sessionViewInputBuffer.slice(0, -1))
        return
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        actions.setSessionViewInputBuffer(state.sessionViewInputBuffer + input)
        return
      }
      return
    }
    
    // Abort confirmation
    if (state.sessionViewConfirmAbort) {
      if (input === 'y') {
        // Abort session - handled externally
        return
      }
      if (input === 'n' || key.escape) {
        actions.setSessionViewConfirmAbort(false)
        return
      }
      return
    }
    
    // Exit session view
    if (key.escape || input === 'q') {
      actions.exitSessionView()
      return
    }
    
    // Scrolling
    if (key.upArrow || input === 'k') {
      const maxScroll = Math.max(0, state.sessionViewRenderedLines.length - (stdout?.rows || 24) + 6)
      actions.setSessionViewScrollOffset(Math.min(maxScroll, state.sessionViewScrollOffset + 1))
      return
    }
    if (key.downArrow || input === 'j') {
      actions.setSessionViewScrollOffset(Math.max(0, state.sessionViewScrollOffset - 1))
      return
    }
    
    // Message input
    if (input === 'm') {
      actions.setSessionViewInputMode(true)
      actions.setSessionViewInputBuffer('')
      return
    }
    
    // Abort
    if (input === 'a') {
      const status = state.sessionViewStatus
      if (status === 'busy' || status === 'running' || status === 'pending') {
        actions.setSessionViewConfirmAbort(true)
      }
      return
    }
  }

  function getSelectableItemCount(): number {
    if (state.viewMode === 'flat') {
      return state.instances.size
    }
    
    // Grouped view - count groups and visible instances
    const groups = getGroupedInstances()
    let count = 0
    for (const [groupKey, groupInstances] of groups) {
      count++ // group header
      if (!state.collapsedGroups.has(groupKey)) {
        count += groupInstances.length
      }
    }
    return count
  }

  function getSelectedItem(): { type: 'group' | 'instance'; key?: string; instanceId?: string } | null {
    if (state.selectedIndex < 0) return null
    
    if (state.viewMode === 'flat') {
      const instances = Array.from(state.instances.values())
      if (state.selectedIndex < instances.length) {
        return { type: 'instance', instanceId: instances[state.selectedIndex].instanceId }
      }
      return null
    }
    
    // Grouped view
    const groups = getGroupedInstances()
    let idx = 0
    for (const [groupKey, groupInstances] of groups) {
      if (idx === state.selectedIndex) {
        return { type: 'group', key: groupKey }
      }
      idx++
      
      if (!state.collapsedGroups.has(groupKey)) {
        for (const inst of groupInstances) {
          if (idx === state.selectedIndex) {
            return { type: 'instance', instanceId: inst.instanceId }
          }
          idx++
        }
      }
    }
    return null
  }

  function handleEnterKey(): void {
    const item = getSelectedItem()
    if (!item) return
    
    if (item.type === 'group' && item.key) {
      actions.toggleCollapsedGroup(item.key)
    } else if (item.type === 'instance' && item.instanceId) {
      const inst = state.instances.get(item.instanceId)
      if (inst) {
        actions.enterSessionView(inst)
      }
    }
  }

  function handleDelete(): void {
    const item = getSelectedItem()
    if (!item) return
    
    if (item.type === 'instance' && item.instanceId) {
      actions.removeInstance(item.instanceId)
    } else if (item.type === 'group' && item.key) {
      // Delete all instances in group
      for (const inst of state.instances.values()) {
        if (getGroupKey(inst) === item.key) {
          actions.removeInstance(inst.instanceId)
        }
      }
    }
  }

  function getGroupKey(instance: { project?: string; dirName?: string; branch?: string }): string {
    const project = instance.project || instance.dirName || 'unknown'
    const branch = instance.branch || 'main'
    return `${project}:${branch}`
  }

  function getGroupedInstances(): [string, any[]][] {
    const sorted = Array.from(state.instances.values())
      .sort((a, b) => (a.instanceId || '').localeCompare(b.instanceId || ''))
    
    const groups = new Map<string, any[]>()
    for (const inst of sorted) {
      const key = getGroupKey(inst)
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(inst)
    }
    
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }

  // Render
  if (state.sessionViewActive) {
    return <SessionView />
  }
  
  if (state.detailView) {
    const inst = state.instances.get(state.detailView)
    if (inst) {
      return <DetailView instance={inst} />
    }
  }

  return (
    <Box flexDirection="column" width="100%">
      <Header />
      {state.viewMode === 'grouped' ? <GroupedView /> : <FlatView />}
      <HelpBar />
    </Box>
  )
}
