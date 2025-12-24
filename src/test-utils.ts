// Test utilities for oc-session-manager
//
// Provides helpers for creating mock data and simulating events
// for both unit tests and integration testing.

import type { Instance } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnouncePacket {
  type: "oc.announce";
  serverUrl: string;
  project: string;
  directory: string;
  branch: string;
  instanceId: string;
  ts: number;
}

export interface ShutdownPacket {
  type: "oc.shutdown";
  instanceId: string;
  ts: number;
}

export interface MockSession {
  id: string;
  parentID?: string;
  title: string;
  status: "idle" | "running" | "pending";
  directory: string;
  createdAt: number;
}

export interface MockServer {
  serverUrl: string;
  project: string;
  branch: string;
  instanceId: string;
  sessions: MockSession[];
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

let idCounter = 0;

export function generateId(prefix = ""): string {
  idCounter++;
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}${random}${idCounter.toString(16).padStart(4, "0")}`;
}

export function generateSessionId(): string {
  return generateId("ses_");
}

export function generateInstanceId(host = "test-host"): string {
  return `${host}-${10000 + idCounter++}`;
}

// ---------------------------------------------------------------------------
// Mock Data Factories
// ---------------------------------------------------------------------------

export function createMockAnnounce(
  overrides: Partial<AnnouncePacket> = {},
): AnnouncePacket {
  const instanceId = overrides.instanceId || generateInstanceId();
  return {
    type: "oc.announce",
    serverUrl: `http://127.0.0.1:${14096 + idCounter}`,
    project: "test-project",
    directory: "/home/user/test-project",
    branch: "main",
    instanceId,
    ts: Date.now(),
    ...overrides,
  };
}

export function createMockShutdown(instanceId: string): ShutdownPacket {
  return {
    type: "oc.shutdown",
    instanceId,
    ts: Date.now(),
  };
}

export function createMockSession(
  overrides: Partial<MockSession> = {},
): MockSession {
  return {
    id: generateSessionId(),
    title: "Test session",
    status: "idle",
    directory: "/home/user/test-project",
    createdAt: Date.now(),
    ...overrides,
  };
}

export function createMockInstance(
  overrides: Partial<Instance> = {},
): Instance {
  const instanceId = overrides.instanceId || generateInstanceId();
  return {
    instanceId,
    status: "idle",
    project: "test-project",
    directory: "/home/user/test-project",
    dirName: "test-project",
    branch: "main",
    host: "test-host",
    ts: Date.now(),
    ...overrides,
  } as Instance;
}

export function createMockServer(
  overrides: Partial<MockServer> = {},
): MockServer {
  const instanceId = overrides.instanceId || generateInstanceId();
  return {
    serverUrl: `http://127.0.0.1:${14096 + idCounter}`,
    project: "test-project",
    branch: "main",
    instanceId,
    sessions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hierarchy Builders
// ---------------------------------------------------------------------------

/**
 * Create a hierarchy of sessions with parent-child relationships
 */
export function createSessionHierarchy(
  depth: number,
  breadth: number = 2,
): MockSession[] {
  const sessions: MockSession[] = [];

  function createLevel(
    parentID: string | undefined,
    currentDepth: number,
  ): void {
    if (currentDepth > depth) return;

    for (let i = 0; i < breadth; i++) {
      const session = createMockSession({
        parentID,
        title: `Session depth=${currentDepth} index=${i}`,
      });
      sessions.push(session);
      createLevel(session.id, currentDepth + 1);
    }
  }

  // Create root session
  const root = createMockSession({ title: "Root session" });
  sessions.push(root);
  createLevel(root.id, 1);

  return sessions;
}

/**
 * Create multiple servers with sessions
 */
export function createMockServers(
  count: number,
  sessionsPerServer: number = 1,
): MockServer[] {
  const servers: MockServer[] = [];

  for (let i = 0; i < count; i++) {
    const server = createMockServer({
      project: `project-${i}`,
      branch: i % 2 === 0 ? "main" : "develop",
    });

    for (let j = 0; j < sessionsPerServer; j++) {
      server.sessions.push(
        createMockSession({
          title: `Session ${j} on ${server.project}`,
        }),
      );
    }

    servers.push(server);
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Event Simulation
// ---------------------------------------------------------------------------

export interface SSEEvent {
  type: string;
  properties: Record<string, unknown>;
}

export function createSSEEvent(
  type: string,
  properties: Record<string, unknown> = {},
): SSEEvent {
  return { type, properties };
}

export function createSessionCreatedEvent(sessionId: string): SSEEvent {
  return createSSEEvent("session.created", { sessionID: sessionId });
}

export function createSessionDeletedEvent(sessionId: string): SSEEvent {
  return createSSEEvent("session.deleted", { sessionID: sessionId });
}

export function createSessionStatusEvent(
  sessionId: string,
  status: string,
): SSEEvent {
  return createSSEEvent("session.status", { sessionID: sessionId, status });
}

export function createSessionIdleEvent(sessionId: string): SSEEvent {
  return createSSEEvent("session.idle", { sessionID: sessionId });
}

export function createPermissionUpdatedEvent(
  sessionId: string,
  permissionId: string,
  tool: string,
): SSEEvent {
  return createSSEEvent("permission.updated", {
    sessionID: sessionId,
    permissionID: permissionId,
    tool,
  });
}

export function createPermissionRepliedEvent(
  sessionId: string,
  permissionId: string,
  allowed: boolean,
): SSEEvent {
  return createSSEEvent("permission.replied", {
    sessionID: sessionId,
    permissionID: permissionId,
    allowed,
  });
}

// ---------------------------------------------------------------------------
// Timing Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a condition to be true, with timeout
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Delay execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State Assertions
// ---------------------------------------------------------------------------

export function assertSessionStatus(
  session: MockSession,
  expected: "idle" | "running" | "pending",
): void {
  if (session.status !== expected) {
    throw new Error(
      `Expected session ${session.id} to have status "${expected}", got "${session.status}"`,
    );
  }
}

export function assertSessionCount(
  sessions: MockSession[],
  expected: number,
): void {
  if (sessions.length !== expected) {
    throw new Error(`Expected ${expected} sessions, got ${sessions.length}`);
  }
}

export function assertHasParent(
  session: MockSession,
  expectedParentId: string,
): void {
  if (session.parentID !== expectedParentId) {
    throw new Error(
      `Expected session ${session.id} to have parent "${expectedParentId}", got "${session.parentID}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Reset ID counter (useful between tests)
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
