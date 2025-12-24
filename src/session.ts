// Session viewer functionality

import type { Instance, Message, MessagePart, RenderedLine } from "./types.js";
import { ANSI } from "./config.js";
import {
  instances,
  sessionViewActive,
  sessionViewClient,
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
  sessionViewEventAbort,
  termWidth,
  termHeight,
  setSessionViewActive,
  setSessionViewClient,
  setSessionViewInstance,
  setSessionViewSessionID,
  setSessionViewMessages,
  setSessionViewScrollOffset,
  setSessionViewRenderedLines,
  setSessionViewInputMode,
  setSessionViewInputBuffer,
  setSessionViewConfirmAbort,
  setSessionViewError,
  setSessionViewConnecting,
  setSessionViewStatus,
  setSessionViewSessions,
  setSessionViewSessionIndex,
  setSessionViewSessionTitle,
  setSessionViewEventAbort,
  resetSessionViewState,
} from "./state.js";
import {
  isSdkAvailable as isSessionViewerAvailable,
  getOpencodeClient,
} from "./sdk.js";
import { render } from "./render.js";
import { formatToolArgs, truncate, wrapText } from "./utils.js";

// ---------------------------------------------------------------------------
// Session View Entry/Exit
// ---------------------------------------------------------------------------

export async function enterSessionView(instance: Instance): Promise<void> {
  if (!isSessionViewerAvailable()) {
    setSessionViewError("SDK not installed. Run: npm install @opencode-ai/sdk");
    return;
  }

  if (!instance.sessionID) {
    setSessionViewError("No session ID available for this instance");
    return;
  }

  // Check for server URL
  let serverUrl = instance.serverUrl;
  if (!serverUrl) {
    // Fallback: try localhost:4096
    serverUrl = "http://127.0.0.1:4096";
  }

  setSessionViewActive(true);
  setSessionViewConnecting(true);
  setSessionViewInstance(instance);
  setSessionViewSessionID(instance.sessionID);
  setSessionViewMessages([]);
  setSessionViewScrollOffset(0);
  setSessionViewRenderedLines([]);
  sessionViewPendingPermissions.clear();
  setSessionViewInputMode(false);
  setSessionViewInputBuffer("");
  setSessionViewConfirmAbort(false);
  setSessionViewError(null);
  setSessionViewStatus(String(instance.status || "idle"));
  setSessionViewSessions([]);
  setSessionViewSessionIndex(0);
  setSessionViewSessionTitle("");

  render();

  try {
    // Create SDK client using the server URL from the instance
    const client = getOpencodeClient(serverUrl);
    setSessionViewClient(client);

    // First, get the current session info
    const sessionResp = await client.session.get({
      path: { id: instance.sessionID },
    });
    const currentSession = sessionResp.data;
    setSessionViewStatus(String(currentSession?.status || "idle"));
    setSessionViewSessionTitle(currentSession?.title || "");

    // Find the root session (follow parentID up)
    let rootSessionID = instance.sessionID;
    let rootSession = currentSession;
    while (rootSession?.parentID) {
      try {
        const parentResp = await client.session.get({
          path: { id: rootSession.parentID },
        });
        rootSession = parentResp.data;
        rootSessionID = rootSession.id;
      } catch {
        break;
      }
    }

    // Build session tree from root
    await buildSessionTree(rootSessionID);

    // Find our session in the tree
    const idx = sessionViewSessions.findIndex(
      (s: any) => s.id === instance.sessionID,
    );
    if (idx >= 0) {
      setSessionViewSessionIndex(idx);
    }

    // Load messages for current session
    await loadCurrentSessionMessages();

    setSessionViewConnecting(false);
    render();

    // Subscribe to events
    subscribeToSessionEvents();
  } catch (err: any) {
    setSessionViewError(`Failed to connect: ${err.message}`);
    setSessionViewConnecting(false);
    render();
  }
}

export async function buildSessionTree(rootSessionID: string): Promise<void> {
  if (!sessionViewClient) return;

  const sessions: any[] = [];

  async function addSessionAndChildren(
    sessionID: string,
    depth: number,
  ): Promise<void> {
    try {
      const sessionResp = await sessionViewClient.session.get({
        path: { id: sessionID },
      });
      const session = sessionResp.data;
      if (!session) return;

      sessions.push({
        id: session.id,
        title: session.title || "Session",
        status: session.status || "idle",
        parentID: session.parentID,
        depth,
      });

      // Fetch children
      try {
        const childrenResp = await sessionViewClient.session.children({
          path: { id: sessionID },
        });
        const children = childrenResp.data || [];

        // Sort children by creation time
        children.sort(
          (a: any, b: any) => (a.time?.created || 0) - (b.time?.created || 0),
        );

        for (const child of children) {
          await addSessionAndChildren(child.id, depth + 1);
        }
      } catch {
        // No children or error fetching
      }
    } catch {
      // Session not found
    }
  }

  await addSessionAndChildren(rootSessionID, 0);
  setSessionViewSessions(sessions);
}

export async function loadCurrentSessionMessages(): Promise<void> {
  if (!sessionViewClient || sessionViewSessions.length === 0) return;

  const currentSession = sessionViewSessions[sessionViewSessionIndex];
  if (!currentSession) return;

  setSessionViewSessionID(currentSession.id);
  setSessionViewSessionTitle(currentSession.title || "");
  setSessionViewStatus(String(currentSession.status || "idle"));

  try {
    const messagesResp = await sessionViewClient.session.messages({
      path: { id: currentSession.id },
    });
    setSessionViewMessages(messagesResp.data || []);
    renderSessionViewLines();
    setSessionViewScrollOffset(0);
  } catch (err: any) {
    setSessionViewError(`Failed to load messages: ${err.message}`);
  }
}

export async function switchSession(direction: "next" | "prev"): Promise<void> {
  if (sessionViewSessions.length <= 1) return;

  let newIndex = sessionViewSessionIndex;
  if (direction === "next") {
    newIndex = (sessionViewSessionIndex + 1) % sessionViewSessions.length;
  } else if (direction === "prev") {
    newIndex =
      (sessionViewSessionIndex - 1 + sessionViewSessions.length) %
      sessionViewSessions.length;
  }

  setSessionViewSessionIndex(newIndex);
  await loadCurrentSessionMessages();
  render();
}

export function exitSessionView(): void {
  // Abort SSE stream if active
  if (sessionViewEventAbort) {
    sessionViewEventAbort.abort();
    setSessionViewEventAbort(null);
  }

  resetSessionViewState();
  render();
}

// ---------------------------------------------------------------------------
// SSE Event Subscription
// ---------------------------------------------------------------------------

export async function subscribeToSessionEvents(): Promise<void> {
  if (!sessionViewClient || !sessionViewSessionID) return;

  const abortController = new AbortController();
  setSessionViewEventAbort(abortController);

  try {
    const events = await sessionViewClient.event.subscribe({
      signal: abortController.signal,
    });

    for await (const event of events.stream) {
      if (!sessionViewActive) break;

      // Filter to our session
      const eventSessionID = event.properties?.sessionID;
      if (eventSessionID && eventSessionID !== sessionViewSessionID) continue;

      handleSessionEvent(event);
    }
  } catch (err: any) {
    // Ignore abort errors
    if (err.name !== "AbortError" && sessionViewActive) {
      setSessionViewError(`Event stream error: ${err.message}`);
      render();
    }
  }
}

function handleSessionEvent(event: any): void {
  const props = event.properties || {};

  switch (event.type) {
    case "message.part.updated":
    case "message.updated":
      // Refresh messages
      refreshMessages();
      break;

    case "session.status":
      setSessionViewStatus(String(props.status || sessionViewStatus || "idle"));
      render();
      break;

    case "session.idle":
      setSessionViewStatus("idle");
      render();
      break;

    case "permission.updated":
      sessionViewPendingPermissions.set(props.id, {
        id: props.id,
        tool: props.tool,
        args: props.args,
        message: props.message,
      });
      render();
      break;

    case "permission.replied":
      sessionViewPendingPermissions.delete(props.id);
      render();
      break;

    case "file.edited":
      // Could show a notification, but messages will update anyway
      break;

    case "tool.execute.before":
    case "tool.execute.after":
      // Messages will be updated via message events
      break;
  }
}

export async function refreshMessages(): Promise<void> {
  if (!sessionViewClient || !sessionViewSessionID) return;

  try {
    const messagesResp = await sessionViewClient.session.messages({
      path: { id: sessionViewSessionID },
    });
    setSessionViewMessages(messagesResp.data || []);

    // Check if we were at the bottom before
    const wasAtBottom = sessionViewScrollOffset === 0;

    renderSessionViewLines();

    // Auto-scroll if we were at the bottom
    if (wasAtBottom) {
      setSessionViewScrollOffset(0);
    }

    render();
  } catch {
    // Ignore errors during refresh
  }
}

// ---------------------------------------------------------------------------
// Session Actions
// ---------------------------------------------------------------------------

export async function abortSession(): Promise<void> {
  if (!sessionViewClient || !sessionViewSessionID) return;

  try {
    await sessionViewClient.session.abort({
      path: { id: sessionViewSessionID },
    });
    setSessionViewConfirmAbort(false);
    setSessionViewStatus("idle");
    render();
  } catch (err: any) {
    setSessionViewError(`Abort failed: ${err.message}`);
    setSessionViewConfirmAbort(false);
    render();
  }
}

export async function abortInstanceSession(instance: Instance): Promise<void> {
  if (!instance.serverUrl || !instance.sessionID) return;
  if (!isSessionViewerAvailable()) return;

  try {
    const client = getOpencodeClient(instance.serverUrl);
    await client.session.abort({
      path: { id: instance.sessionID },
    });
    // Update the instance status locally
    instance.status = "idle";
    render();
  } catch {
    // Silently fail - instance may have already stopped
  }
}

export async function respondToPermission(
  permissionId: string,
  response: string,
  remember: boolean = false,
): Promise<void> {
  if (!sessionViewClient || !sessionViewSessionID) return;

  try {
    await sessionViewClient.postSessionByIdPermissionsByPermissionId({
      path: { id: sessionViewSessionID, permissionId },
      body: { response, remember },
    });
    sessionViewPendingPermissions.delete(permissionId);
    render();
  } catch (err: any) {
    setSessionViewError(`Permission response failed: ${err.message}`);
    render();
  }
}

export async function sendMessage(text: string): Promise<void> {
  if (!sessionViewClient || !sessionViewSessionID || !text.trim()) return;

  setSessionViewInputMode(false);
  setSessionViewInputBuffer("");
  setSessionViewStatus("busy");
  render();

  try {
    await sessionViewClient.session.prompt({
      path: { id: sessionViewSessionID },
      body: {
        parts: [{ type: "text", text: text.trim() }],
      },
    });
    // Messages will be updated via events
  } catch (err: any) {
    setSessionViewError(`Send failed: ${err.message}`);
    render();
  }
}

// ---------------------------------------------------------------------------
// Message Rendering
// ---------------------------------------------------------------------------

export function renderSessionViewLines(): void {
  const lines: RenderedLine[] = [];

  for (const msg of sessionViewMessages) {
    const info = msg.info;
    const parts = msg.parts || [];
    const role = info.role;

    // Role header
    const roleColor = role === "user" ? ANSI.cyan : ANSI.green;
    const roleLabel = role === "user" ? "User" : "Assistant";
    const costInfo = info.cost
      ? ` ${ANSI.dim}$${info.cost.toFixed(4)}${ANSI.reset}`
      : "";

    lines.push({
      type: "header",
      text: `${roleColor}┌─ ${roleLabel}${ANSI.reset}${costInfo}`,
      plain: `┌─ ${roleLabel}${costInfo ? ` $${info.cost!.toFixed(4)}` : ""}`,
    });

    // Render each part
    for (const part of parts) {
      renderPart(part, lines);
    }

    // Role footer
    lines.push({
      type: "footer",
      text: `${roleColor}└${"─".repeat(40)}${ANSI.reset}`,
      plain: `└${"─".repeat(40)}`,
    });

    // Empty line between messages
    lines.push({ type: "spacer", text: "", plain: "" });
  }

  setSessionViewRenderedLines(lines);
}

function renderPart(part: MessagePart, lines: RenderedLine[]): void {
  switch (part.type) {
    case "text":
      renderTextPart(part, lines);
      break;
    case "tool":
      renderToolPart(part, lines);
      break;
    case "step-start":
    case "step-finish":
      // Skip step markers - they're internal
      break;
    case "reasoning":
      renderReasoningPart(part, lines);
      break;
    default:
      lines.push({
        type: "text",
        text: `${ANSI.dim}│ [${part.type}]${ANSI.reset}`,
        plain: `│ [${part.type}]`,
      });
  }
}

function renderTextPart(part: MessagePart, lines: RenderedLine[]): void {
  const text = part.text || "";
  const textLines = text.split("\n");

  for (const line of textLines) {
    // Wrap long lines
    const wrapped = wrapText(line, termWidth - 4);
    for (const wline of wrapped) {
      lines.push({
        type: "text",
        text: `│ ${wline}`,
        plain: `│ ${wline}`,
      });
    }
  }
}

function renderToolPart(part: MessagePart, lines: RenderedLine[]): void {
  const name = part.tool || "unknown";
  const state = part.state || { status: "pending" as const };
  const status = state.status || "pending";
  const input = state.input || {};
  const output = state.output;
  const title = state.title;

  // Status indicator
  let statusIcon = "○";
  let statusColor = ANSI.yellow;
  if (status === "completed") {
    statusIcon = "✓";
    statusColor = ANSI.green;
  } else if (status === "running") {
    statusIcon = "⠋";
    statusColor = ANSI.yellow;
  } else if (status === "error") {
    statusIcon = "✗";
    statusColor = ANSI.red;
  }

  // Tool header with name and status
  const displayName = title || name;
  lines.push({
    type: "tool-start",
    text: `│ ${statusColor}┌─ ${statusIcon} ${displayName}${ANSI.reset}`,
    plain: `│ ┌─ ${statusIcon} ${displayName}`,
  });

  // Show abbreviated args/input
  const argsStr = formatToolArgs(input);
  if (argsStr) {
    const wrapped = wrapText(argsStr, termWidth - 8);
    for (const line of wrapped) {
      lines.push({
        type: "tool-args",
        text: `│ ${statusColor}│${ANSI.reset} ${ANSI.dim}${line}${ANSI.reset}`,
        plain: `│ │ ${line}`,
      });
    }
  }

  // Show output if completed
  if (status === "completed" && output) {
    // Truncate very long results
    const outputLines = output.split("\n");
    const maxLines = 10;
    const truncated = outputLines.length > maxLines;
    const displayLines = truncated
      ? outputLines.slice(0, maxLines)
      : outputLines;

    for (const line of displayLines) {
      const wrapped = wrapText(line, termWidth - 8);
      for (const wline of wrapped) {
        lines.push({
          type: "tool-result",
          text: `│ ${statusColor}│${ANSI.reset} ${ANSI.gray}${wline}${ANSI.reset}`,
          plain: `│ │ ${wline}`,
        });
      }
    }

    if (truncated) {
      lines.push({
        type: "tool-result",
        text: `│ ${statusColor}│${ANSI.reset} ${ANSI.dim}... (${outputLines.length - maxLines} more lines)${ANSI.reset}`,
        plain: `│ │ ... (${outputLines.length - maxLines} more lines)`,
      });
    }
  }

  lines.push({
    type: "tool-end",
    text: `│ ${statusColor}└${"─".repeat(30)}${ANSI.reset}`,
    plain: `│ └${"─".repeat(30)}`,
  });
}

function renderReasoningPart(part: MessagePart, lines: RenderedLine[]): void {
  const text = part.reasoning || part.text || "";
  if (!text) return;

  lines.push({
    type: "reasoning-start",
    text: `│ ${ANSI.magenta}┌─ Thinking...${ANSI.reset}`,
    plain: `│ ┌─ Thinking...`,
  });

  const textLines = text.split("\n");
  for (const line of textLines) {
    const wrapped = wrapText(line, termWidth - 8);
    for (const wline of wrapped) {
      lines.push({
        type: "reasoning",
        text: `│ ${ANSI.magenta}│${ANSI.reset} ${ANSI.dim}${wline}${ANSI.reset}`,
        plain: `│ │ ${wline}`,
      });
    }
  }

  lines.push({
    type: "reasoning-end",
    text: `│ ${ANSI.magenta}└${"─".repeat(30)}${ANSI.reset}`,
    plain: `│ └${"─".repeat(30)}`,
  });
}

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

export function scrollSessionView(
  direction: "up" | "down" | "pageup" | "pagedown" | "home" | "end",
): void {
  const contentHeight = termHeight - 6;
  const maxScroll = Math.max(
    0,
    sessionViewRenderedLines.length - contentHeight,
  );

  let newOffset = sessionViewScrollOffset;

  switch (direction) {
    case "up":
      newOffset = Math.min(maxScroll, sessionViewScrollOffset + 1);
      break;
    case "down":
      newOffset = Math.max(0, sessionViewScrollOffset - 1);
      break;
    case "pageup":
      newOffset = Math.min(maxScroll, sessionViewScrollOffset + contentHeight);
      break;
    case "pagedown":
      newOffset = Math.max(0, sessionViewScrollOffset - contentHeight);
      break;
    case "home":
      newOffset = maxScroll;
      break;
    case "end":
      newOffset = 0;
      break;
  }

  setSessionViewScrollOffset(newOffset);
  render();
}
