// Session connection and event handling

import React, { useEffect, useRef } from 'react'
import { useAppState, useAppActions, useViewState } from './AppContext.js'
import { getOpencodeClient, isSdkAvailable } from '../sdk.js'
import { formatToolArgs, wrapText } from '../utils.js'
import type { Message, MessagePart, RenderedLine } from '../types.js'

export const SessionWatcher = React.memo((): null => {
  const { sessionViewInstance, sessionViewSessionID, sessionViewActive, terminalSize } = useViewState()
  const actions = useAppActions()
  
  const termWidth = terminalSize.columns
  const lastRefreshRef = useRef<number>(0)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!sessionViewActive || !sessionViewInstance || !sessionViewSessionID) return

    let eventAbort: AbortController | null = null
    let isActive = true

    async function connect() {
      if (!isSdkAvailable()) {
        actions.setSessionViewError('SDK not installed.')
        actions.setSessionViewConnecting(false)
        return
      }

      const serverUrl = sessionViewInstance?.serverUrl || 'http://127.0.0.1:4096'
      
      try {
        const client = getOpencodeClient(serverUrl)
        
        // 1. Get session info
        const sessionResp = await client.session.get({ path: { id: sessionViewSessionID! } })
        if (!isActive) return
        
        const currentSession = sessionResp.data
        actions.setSessionViewStatus(String(currentSession?.status || 'idle'))
        actions.setSessionViewSessionTitle(currentSession?.title || '')

        // 2. Build tree and load messages
        await refreshSessionsAndMessages(client)
        if (!isActive) return

        actions.setSessionViewConnecting(false)

        // 3. Subscribe to events
        eventAbort = new AbortController()
        const events = await client.event.subscribe({ signal: eventAbort.signal })
        
        for await (const event of events.stream) {
          if (!isActive) break
          const eventSessionID = event.properties?.sessionID
          if (eventSessionID && eventSessionID !== sessionViewSessionID) continue
          
          handleEvent(event, client)
        }
      } catch (err: any) {
        if (isActive && err.name !== 'AbortError') {
          actions.setSessionViewError(`Connection failed: ${err.message}`)
          actions.setSessionViewConnecting(false)
        }
      }
    }

    async function refreshSessionsAndMessages(client: any) {
        // Build session list
        const sessions: any[] = []
        try {
            const rootId = await findRootId(client, sessionViewSessionID!)
            await buildTree(client, rootId, 0, sessions)
            if (!isActive) return
            actions.setSessionViewSessions(sessions)
            
            const idx = sessions.findIndex(s => s.id === sessionViewSessionID)
            if (idx >= 0) actions.setSessionViewSessionIndex(idx)

            // Load messages
            await refreshMessages(client)
        } catch (e) {}
    }

    async function findRootId(client: any, id: string): Promise<string> {
        try {
            const resp = await client.session.get({ path: { id } })
            if (resp.data?.parentID) return findRootId(client, resp.data.parentID)
        } catch (e) {}
        return id
    }

    async function buildTree(client: any, id: string, depth: number, acc: any[]) {
        if (!isActive) return
        try {
            const resp = await client.session.get({ path: { id } })
            if (!resp.data) return
            acc.push({
                id: resp.data.id,
                title: resp.data.title || 'Session',
                status: resp.data.status || 'idle',
                depth
            })
            const children = await client.session.children({ path: { id } })
            const sorted = (children.data || []).sort((a: any, b: any) => (a.time?.created || 0) - (b.time?.created || 0))
            for (const child of sorted) {
                await buildTree(client, child.id, depth + 1, acc)
            }
        } catch (e) {}
    }

    function handleEvent(event: any, client: any) {
        const props = event.properties || {}
        switch (event.type) {
            case 'message.part.updated':
            case 'message.updated':
                throttledRefreshMessages(client)
                break
            case 'session.status':
                actions.setSessionViewStatus(String(props.status || 'idle'))
                break
            case 'session.idle':
                actions.setSessionViewStatus('idle')
                break
            case 'permission.updated':
                actions.addPermission({ id: props.id, tool: props.tool, args: props.args, message: props.message })
                break
            case 'permission.replied':
                actions.removePermission(props.id)
                break
        }
    }

    function throttledRefreshMessages(client: any) {
        const now = Date.now()
        if (now - lastRefreshRef.current < 250) {
            if (refreshTimerRef.current) return
            refreshTimerRef.current = setTimeout(() => {
                refreshTimerRef.current = null
                refreshMessages(client)
            }, 250)
            return
        }
        refreshMessages(client)
    }

    async function refreshMessages(client: any) {
        lastRefreshRef.current = Date.now()
        try {
            const msgResp = await client.session.messages({ path: { id: sessionViewSessionID! } })
            if (isActive) {
                const msgs = msgResp.data || []
                actions.setSessionViewMessages(msgs)
                renderLines(msgs)
            }
        } catch (e) {}
    }

    function renderLines(messages: Message[]) {
        const lines: RenderedLine[] = []
        // Only render last 50 messages to prevent Ink overhead
        const displayMessages = messages.length > 50 ? messages.slice(-50) : messages
        
        for (const msg of displayMessages) {
            const role = msg.info.role
            const roleLabel = role === 'user' ? 'User' : 'Assistant'
            const cost = msg.info.cost ? ` $${msg.info.cost.toFixed(4)}` : ''
            
            lines.push({ type: 'header', plain: `┌─ ${roleLabel}${cost}`, text: `┌─ ${roleLabel}${cost}` })
            for (const part of (msg.parts || [])) {
                renderPart(part, lines)
            }
            lines.push({ type: 'footer', plain: `└${'─'.repeat(40)}`, text: `└${'─'.repeat(40)}` })
            lines.push({ type: 'spacer', plain: '', text: '' })
        }
        actions.setSessionViewRenderedLines(lines)
    }

    function renderPart(part: MessagePart, lines: RenderedLine[]) {
        if (part.type === 'text') {
            const text = part.text || ''
            for (const line of text.split('\n')) {
                const wrapped = wrapText(line, termWidth - 10)
                for (const w of wrapped) lines.push({ type: 'text', plain: `│ ${w}`, text: `│ ${w}` })
            }
        } else if (part.type === 'tool') {
            const name = part.tool || 'unknown'
            const state = part.state || { status: 'pending' }
            const status = state.status || 'pending'
            const icon = status === 'completed' ? '✓' : status === 'error' ? '✗' : '○'
            lines.push({ type: 'tool-start', plain: `│ ┌─ ${icon} ${state.title || name}`, text: `│ ┌─ ${icon} ${state.title || name}` })
            const args = formatToolArgs(state.input || {})
            if (args) {
                for (const w of wrapText(args, termWidth - 14)) lines.push({ type: 'tool-args', plain: `│ │ ${w}`, text: `│ │ ${w}` })
            }
            if (status === 'completed' && state.output) {
                const outLines = state.output.split('\n')
                for (const line of outLines.slice(0, 5)) {
                    for (const w of wrapText(line, termWidth - 14)) lines.push({ type: 'tool-result', plain: `│ │ ${w}`, text: `│ │ ${w}` })
                }
                if (outLines.length > 5) lines.push({ type: 'tool-result', plain: `│ │ ...`, text: `│ │ ...` })
            }
            lines.push({ type: 'tool-end', plain: `│ └${'─'.repeat(30)}`, text: `│ └${'─'.repeat(30)}` })
        } else if (part.type === 'reasoning') {
            lines.push({ type: 'reasoning-start', plain: `│ ┌─ Thinking...`, text: `│ ┌─ Thinking...` })
            const text = part.reasoning || part.text || ''
            for (const line of text.split('\n')) {
                for (const w of wrapText(line, termWidth - 14)) lines.push({ type: 'reasoning', plain: `│ │ ${w}`, text: `│ │ ${w}` })
            }
            lines.push({ type: 'reasoning-end', plain: `│ └${'─'.repeat(30)}`, text: `│ └${'─'.repeat(30)}` })
        }
    }

    connect()

    return () => {
      isActive = false
      if (eventAbort) eventAbort.abort()
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [sessionViewActive, sessionViewInstance, sessionViewSessionID, termWidth])

  return null
})
