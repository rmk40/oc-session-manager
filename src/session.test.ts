/**
 * Unit tests for session.ts
 *
 * Coverage approach:
 * - Test all exported functions: enterSessionView, buildSessionTree, loadCurrentSessionMessages,
 *   switchSession, exitSessionView, subscribeToSessionEvents, refreshMessages, abortSession,
 *   abortInstanceSession, respondToPermission, sendMessage, renderSessionViewLines, scrollSessionView
 * - Mock SDK client and its methods
 * - Mock state module
 * - Test success and error paths
 * - Test SSE event handling
 *
 * Target: High coverage for business logic functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Instance, Message, MessagePart, RenderedLine } from "./types.js";

// ---------------------------------------------------------------------------
// Mock Setup - Use vi.hoisted to ensure variables are available to mock factories
// ---------------------------------------------------------------------------

const {
  mockState,
  mockClient,
  mockRender,
  mockSessionGet,
  mockSessionChildren,
  mockSessionMessages,
  mockSessionAbort,
  mockSessionPrompt,
  mockEventSubscribe,
  mockPostPermission,
} = vi.hoisted(() => {
  const mockSessionGet = vi.fn();
  const mockSessionChildren = vi.fn();
  const mockSessionMessages = vi.fn();
  const mockSessionAbort = vi.fn();
  const mockSessionPrompt = vi.fn();
  const mockEventSubscribe = vi.fn();
  const mockPostPermission = vi.fn();

  const mockClient = {
    session: {
      get: mockSessionGet,
      children: mockSessionChildren,
      messages: mockSessionMessages,
      abort: mockSessionAbort,
      prompt: mockSessionPrompt,
    },
    event: {
      subscribe: mockEventSubscribe,
    },
    postSessionByIdPermissionsByPermissionId: mockPostPermission,
  };

  const mockState = {
    sessionViewActive: false,
    sessionViewClient: null as any,
    sessionViewInstance: null as Instance | null,
    sessionViewSessionID: null as string | null,
    sessionViewMessages: [] as Message[],
    sessionViewScrollOffset: 0,
    sessionViewRenderedLines: [] as RenderedLine[],
    sessionViewPendingPermissions: new Map(),
    sessionViewInputMode: false,
    sessionViewInputBuffer: "",
    sessionViewConfirmAbort: false,
    sessionViewError: null as string | null,
    sessionViewConnecting: false,
    sessionViewStatus: "idle",
    sessionViewSessions: [] as any[],
    sessionViewSessionIndex: 0,
    sessionViewSessionTitle: "",
    sessionViewEventAbort: null as AbortController | null,
    termWidth: 80,
    termHeight: 24,
    sdkAvailable: true,
  };

  const mockRender = vi.fn();

  return {
    mockState,
    mockClient,
    mockRender,
    mockSessionGet,
    mockSessionChildren,
    mockSessionMessages,
    mockSessionAbort,
    mockSessionPrompt,
    mockEventSubscribe,
    mockPostPermission,
  };
});

// Mock state.js module
vi.mock("./state.js", () => ({
  instances: new Map(),
  get sessionViewActive() {
    return mockState.sessionViewActive;
  },
  get sessionViewClient() {
    return mockState.sessionViewClient;
  },
  get sessionViewInstance() {
    return mockState.sessionViewInstance;
  },
  get sessionViewSessionID() {
    return mockState.sessionViewSessionID;
  },
  get sessionViewMessages() {
    return mockState.sessionViewMessages;
  },
  get sessionViewScrollOffset() {
    return mockState.sessionViewScrollOffset;
  },
  get sessionViewRenderedLines() {
    return mockState.sessionViewRenderedLines;
  },
  get sessionViewPendingPermissions() {
    return mockState.sessionViewPendingPermissions;
  },
  get sessionViewInputMode() {
    return mockState.sessionViewInputMode;
  },
  get sessionViewInputBuffer() {
    return mockState.sessionViewInputBuffer;
  },
  get sessionViewConfirmAbort() {
    return mockState.sessionViewConfirmAbort;
  },
  get sessionViewError() {
    return mockState.sessionViewError;
  },
  get sessionViewConnecting() {
    return mockState.sessionViewConnecting;
  },
  get sessionViewStatus() {
    return mockState.sessionViewStatus;
  },
  get sessionViewSessions() {
    return mockState.sessionViewSessions;
  },
  get sessionViewSessionIndex() {
    return mockState.sessionViewSessionIndex;
  },
  get sessionViewSessionTitle() {
    return mockState.sessionViewSessionTitle;
  },
  get sessionViewEventAbort() {
    return mockState.sessionViewEventAbort;
  },
  get termWidth() {
    return mockState.termWidth;
  },
  get termHeight() {
    return mockState.termHeight;
  },
  setSessionViewActive: vi.fn((val: boolean) => {
    mockState.sessionViewActive = val;
  }),
  setSessionViewClient: vi.fn((val: any) => {
    mockState.sessionViewClient = val;
  }),
  setSessionViewInstance: vi.fn((val: Instance | null) => {
    mockState.sessionViewInstance = val;
  }),
  setSessionViewSessionID: vi.fn((val: string | null) => {
    mockState.sessionViewSessionID = val;
  }),
  setSessionViewMessages: vi.fn((val: Message[]) => {
    mockState.sessionViewMessages = val;
  }),
  setSessionViewScrollOffset: vi.fn((val: number) => {
    mockState.sessionViewScrollOffset = val;
  }),
  setSessionViewRenderedLines: vi.fn((val: RenderedLine[]) => {
    mockState.sessionViewRenderedLines = val;
  }),
  setSessionViewInputMode: vi.fn((val: boolean) => {
    mockState.sessionViewInputMode = val;
  }),
  setSessionViewInputBuffer: vi.fn((val: string) => {
    mockState.sessionViewInputBuffer = val;
  }),
  setSessionViewConfirmAbort: vi.fn((val: boolean) => {
    mockState.sessionViewConfirmAbort = val;
  }),
  setSessionViewError: vi.fn((val: string | null) => {
    mockState.sessionViewError = val;
  }),
  setSessionViewConnecting: vi.fn((val: boolean) => {
    mockState.sessionViewConnecting = val;
  }),
  setSessionViewStatus: vi.fn((val: string) => {
    mockState.sessionViewStatus = val;
  }),
  setSessionViewSessions: vi.fn((val: any[]) => {
    mockState.sessionViewSessions = val;
  }),
  setSessionViewSessionIndex: vi.fn((val: number) => {
    mockState.sessionViewSessionIndex = val;
  }),
  setSessionViewSessionTitle: vi.fn((val: string) => {
    mockState.sessionViewSessionTitle = val;
  }),
  setSessionViewEventAbort: vi.fn((val: AbortController | null) => {
    mockState.sessionViewEventAbort = val;
  }),
  resetSessionViewState: vi.fn(() => {
    mockState.sessionViewActive = false;
    mockState.sessionViewClient = null;
    mockState.sessionViewInstance = null;
    mockState.sessionViewSessionID = null;
    mockState.sessionViewMessages = [];
    mockState.sessionViewScrollOffset = 0;
    mockState.sessionViewRenderedLines = [];
    mockState.sessionViewPendingPermissions.clear();
    mockState.sessionViewInputMode = false;
    mockState.sessionViewInputBuffer = "";
    mockState.sessionViewConfirmAbort = false;
    mockState.sessionViewError = null;
    mockState.sessionViewConnecting = false;
    mockState.sessionViewStatus = "idle";
    mockState.sessionViewSessions = [];
    mockState.sessionViewSessionIndex = 0;
    mockState.sessionViewSessionTitle = "";
    mockState.sessionViewEventAbort = null;
  }),
}));

// Mock sdk.js (session.ts now imports from here)
vi.mock("./sdk.js", () => ({
  isSdkAvailable: vi.fn(() => mockState.sdkAvailable),
  getOpencodeClient: vi.fn(() => mockClient),
}));

// Mock render.js
vi.mock("./render.js", () => ({
  render: mockRender,
}));

// Mock config.js
vi.mock("./config.js", () => ({
  ANSI: {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
  },
}));

// Mock utils.js
vi.mock("./utils.js", () => ({
  formatToolArgs: vi.fn((args: Record<string, unknown>) => {
    if (!args || Object.keys(args).length === 0) return "";
    return Object.entries(args)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }),
  truncate: vi.fn((str: string, max: number) => {
    if (!str) return "";
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + "...";
  }),
  wrapText: vi.fn((text: string, maxWidth: number) => {
    if (!text) return [""];
    if (maxWidth <= 0) return [text];
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > maxWidth) {
      let breakPoint = remaining.lastIndexOf(" ", maxWidth);
      if (breakPoint <= 0) breakPoint = maxWidth;
      lines.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) lines.push(remaining);
    return lines.length > 0 ? lines : [""];
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  enterSessionView,
  buildSessionTree,
  loadCurrentSessionMessages,
  switchSession,
  exitSessionView,
  subscribeToSessionEvents,
  refreshMessages,
  abortSession,
  abortInstanceSession,
  respondToPermission,
  sendMessage,
  renderSessionViewLines,
  scrollSessionView,
} from "./session.js";

import {
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
  sessionViewPendingPermissions,
} from "./state.js";

import {
  isSdkAvailable as isSessionViewerAvailable,
  getOpencodeClient,
} from "./sdk.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    instanceId: "test-instance-1",
    status: "idle",
    ts: Date.now(),
    sessionID: "session-123",
    serverUrl: "http://localhost:4096",
    ...overrides,
  };
}

function createMessage(
  role: "user" | "assistant",
  parts: MessagePart[] = [],
): Message {
  return {
    info: { role },
    parts,
  };
}

function resetMockState() {
  mockState.sessionViewActive = false;
  mockState.sessionViewClient = null;
  mockState.sessionViewInstance = null;
  mockState.sessionViewSessionID = null;
  mockState.sessionViewMessages = [];
  mockState.sessionViewScrollOffset = 0;
  mockState.sessionViewRenderedLines = [];
  mockState.sessionViewPendingPermissions.clear();
  mockState.sessionViewInputMode = false;
  mockState.sessionViewInputBuffer = "";
  mockState.sessionViewConfirmAbort = false;
  mockState.sessionViewError = null;
  mockState.sessionViewConnecting = false;
  mockState.sessionViewStatus = "idle";
  mockState.sessionViewSessions = [];
  mockState.sessionViewSessionIndex = 0;
  mockState.sessionViewSessionTitle = "";
  mockState.sessionViewEventAbort = null;
  mockState.termWidth = 80;
  mockState.termHeight = 24;
  mockState.sdkAvailable = true;
}

function resetMocks() {
  resetMockState();
  vi.clearAllMocks();
  mockSessionGet.mockReset();
  mockSessionChildren.mockReset();
  mockSessionMessages.mockReset();
  mockSessionAbort.mockReset();
  mockSessionPrompt.mockReset();
  mockEventSubscribe.mockReset();
  mockPostPermission.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // enterSessionView
  // =========================================================================

  describe("enterSessionView", () => {
    it("sets error when SDK is not available", async () => {
      mockState.sdkAvailable = false;
      const instance = createInstance();

      await enterSessionView(instance);

      expect(setSessionViewError).toHaveBeenCalledWith(
        "SDK not installed. Run: npm install @opencode-ai/sdk",
      );
    });

    it("sets error when instance has no sessionID", async () => {
      const instance = createInstance({ sessionID: undefined });

      await enterSessionView(instance);

      expect(setSessionViewError).toHaveBeenCalledWith(
        "No session ID available for this instance",
      );
    });

    it("uses localhost fallback when serverUrl is not set", async () => {
      const instance = createInstance({ serverUrl: undefined });

      mockSessionGet.mockResolvedValue({
        data: { id: "session-123", status: "idle" },
      });
      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      expect(getOpencodeClient).toHaveBeenCalledWith("http://127.0.0.1:4096");
    });

    it("initializes session view state correctly", async () => {
      const instance = createInstance({
        sessionID: "session-123",
        serverUrl: "http://localhost:4096",
        status: "busy",
      });

      mockSessionGet.mockResolvedValue({
        data: { id: "session-123", status: "running", title: "Test Session" },
      });
      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      expect(setSessionViewActive).toHaveBeenCalledWith(true);
      expect(setSessionViewConnecting).toHaveBeenCalledWith(true);
      expect(setSessionViewInstance).toHaveBeenCalledWith(instance);
      expect(setSessionViewSessionID).toHaveBeenCalledWith("session-123");
      expect(setSessionViewMessages).toHaveBeenCalledWith([]);
      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("fetches session info and updates state", async () => {
      const instance = createInstance();

      mockSessionGet.mockResolvedValue({
        data: {
          id: "session-123",
          status: "running",
          title: "Working on feature",
        },
      });
      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      expect(mockSessionGet).toHaveBeenCalledWith({
        path: { id: "session-123" },
      });
      expect(setSessionViewStatus).toHaveBeenCalledWith("running");
      expect(setSessionViewSessionTitle).toHaveBeenCalledWith(
        "Working on feature",
      );
    });

    it("follows parentID to find root session", async () => {
      const instance = createInstance({ sessionID: "child-session" });

      // First call: child session with parentID
      mockSessionGet
        .mockResolvedValueOnce({
          data: {
            id: "child-session",
            status: "running",
            parentID: "root-session",
          },
        })
        // Second call: root session without parentID
        .mockResolvedValueOnce({
          data: { id: "root-session", status: "idle" },
        })
        // Third call during buildSessionTree
        .mockResolvedValue({
          data: { id: "root-session", status: "idle" },
        });

      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      // Should have fetched both child and root sessions
      expect(mockSessionGet).toHaveBeenCalledWith({
        path: { id: "child-session" },
      });
      expect(mockSessionGet).toHaveBeenCalledWith({
        path: { id: "root-session" },
      });
    });

    it("handles parent session fetch error gracefully", async () => {
      const instance = createInstance({ sessionID: "child-session" });

      mockSessionGet
        .mockResolvedValueOnce({
          data: {
            id: "child-session",
            status: "running",
            parentID: "root-session",
          },
        })
        .mockRejectedValueOnce(new Error("Parent not found"))
        .mockResolvedValue({
          data: { id: "child-session", status: "running" },
        });

      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      // Should not throw, just break out of the loop
      expect(setSessionViewError).not.toHaveBeenCalledWith(
        expect.stringContaining("Parent"),
      );
    });

    it("handles connection error", async () => {
      const instance = createInstance();

      mockSessionGet.mockRejectedValue(new Error("Connection refused"));

      await enterSessionView(instance);

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Failed to connect: Connection refused",
      );
      expect(setSessionViewConnecting).toHaveBeenCalledWith(false);
    });

    it("calls render after successful initialization", async () => {
      const instance = createInstance();

      mockSessionGet.mockResolvedValue({
        data: { id: "session-123", status: "idle" },
      });
      mockSessionChildren.mockResolvedValue({ data: [] });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await enterSessionView(instance);

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // buildSessionTree
  // =========================================================================

  describe("buildSessionTree", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;

      await buildSessionTree("root-session");

      expect(mockSessionGet).not.toHaveBeenCalled();
    });

    it("builds single-node tree when no children", async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet.mockResolvedValue({
        data: { id: "root-session", title: "Root", status: "idle" },
      });
      mockSessionChildren.mockResolvedValue({ data: [] });

      await buildSessionTree("root-session");

      expect(setSessionViewSessions).toHaveBeenCalledWith([
        {
          id: "root-session",
          title: "Root",
          status: "idle",
          parentID: undefined,
          depth: 0,
        },
      ]);
    });

    it("builds tree with children", async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet
        .mockResolvedValueOnce({
          data: { id: "root", title: "Root", status: "idle" },
        })
        .mockResolvedValueOnce({
          data: {
            id: "child-1",
            title: "Child 1",
            status: "busy",
            parentID: "root",
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "child-2",
            title: "Child 2",
            status: "idle",
            parentID: "root",
          },
        });

      mockSessionChildren
        .mockResolvedValueOnce({
          data: [
            { id: "child-1", time: { created: 1000 } },
            { id: "child-2", time: { created: 2000 } },
          ],
        })
        .mockResolvedValue({ data: [] });

      await buildSessionTree("root");

      expect(setSessionViewSessions).toHaveBeenCalledWith([
        {
          id: "root",
          title: "Root",
          status: "idle",
          parentID: undefined,
          depth: 0,
        },
        {
          id: "child-1",
          title: "Child 1",
          status: "busy",
          parentID: "root",
          depth: 1,
        },
        {
          id: "child-2",
          title: "Child 2",
          status: "idle",
          parentID: "root",
          depth: 1,
        },
      ]);
    });

    it("handles session fetch error gracefully", async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet.mockRejectedValue(new Error("Session not found"));

      await buildSessionTree("missing-session");

      // Should not throw, just set empty sessions
      expect(setSessionViewSessions).toHaveBeenCalledWith([]);
    });

    it("handles children fetch error gracefully", async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet.mockResolvedValue({
        data: { id: "root", title: "Root", status: "idle" },
      });
      mockSessionChildren.mockRejectedValue(
        new Error("Failed to fetch children"),
      );

      await buildSessionTree("root");

      // Should still add root session
      expect(setSessionViewSessions).toHaveBeenCalledWith([
        {
          id: "root",
          title: "Root",
          status: "idle",
          parentID: undefined,
          depth: 0,
        },
      ]);
    });

    it('uses "Session" as default title when not provided', async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet.mockResolvedValue({
        data: { id: "root", status: "idle" }, // No title
      });
      mockSessionChildren.mockResolvedValue({ data: [] });

      await buildSessionTree("root");

      expect(setSessionViewSessions).toHaveBeenCalledWith([
        expect.objectContaining({ title: "Session" }),
      ]);
    });

    it('uses "idle" as default status when not provided', async () => {
      mockState.sessionViewClient = mockClient;

      mockSessionGet.mockResolvedValue({
        data: { id: "root", title: "Test" }, // No status
      });
      mockSessionChildren.mockResolvedValue({ data: [] });

      await buildSessionTree("root");

      expect(setSessionViewSessions).toHaveBeenCalledWith([
        expect.objectContaining({ status: "idle" }),
      ]);
    });

    it("sorts children by creation time", async () => {
      mockState.sessionViewClient = mockClient;

      // Note: After sorting, child-earlier (created: 1000) comes before child-later (created: 2000)
      // So we set up the mocks in the expected processing order
      mockSessionGet
        .mockResolvedValueOnce({
          data: { id: "root", title: "Root", status: "idle" },
        })
        // After sorting, child-earlier will be fetched first
        .mockResolvedValueOnce({
          data: {
            id: "child-earlier",
            title: "Earlier",
            status: "idle",
            parentID: "root",
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "child-later",
            title: "Later",
            status: "idle",
            parentID: "root",
          },
        });

      mockSessionChildren
        .mockResolvedValueOnce({
          data: [
            // Unsorted order - code should sort by time.created
            { id: "child-later", time: { created: 2000 } },
            { id: "child-earlier", time: { created: 1000 } },
          ],
        })
        .mockResolvedValue({ data: [] });

      await buildSessionTree("root");

      const sessions = vi.mocked(setSessionViewSessions).mock.calls[0][0];
      expect(sessions[1].id).toBe("child-earlier"); // Should be sorted first (created: 1000)
      expect(sessions[2].id).toBe("child-later"); // Should be second (created: 2000)
    });
  });

  // =========================================================================
  // loadCurrentSessionMessages
  // =========================================================================

  describe("loadCurrentSessionMessages", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessions = [{ id: "session-1" }];

      await loadCurrentSessionMessages();

      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("returns early when sessions array is empty", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [];

      await loadCurrentSessionMessages();

      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("returns early when current session is undefined", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "session-0" }];
      mockState.sessionViewSessionIndex = 5; // Out of bounds

      await loadCurrentSessionMessages();

      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("loads messages for current session", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [
        { id: "session-1", title: "Session 1", status: "busy" },
      ];
      mockState.sessionViewSessionIndex = 0;

      const messages = [
        createMessage("user", [{ type: "text", text: "Hello" }]),
        createMessage("assistant", [{ type: "text", text: "Hi!" }]),
      ];
      mockSessionMessages.mockResolvedValue({ data: messages });

      await loadCurrentSessionMessages();

      expect(setSessionViewSessionID).toHaveBeenCalledWith("session-1");
      expect(setSessionViewSessionTitle).toHaveBeenCalledWith("Session 1");
      expect(setSessionViewStatus).toHaveBeenCalledWith("busy");
      expect(setSessionViewMessages).toHaveBeenCalledWith(messages);
      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("handles messages fetch error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "session-1", title: "Test" }];
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockRejectedValue(new Error("Failed to load"));

      await loadCurrentSessionMessages();

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Failed to load messages: Failed to load",
      );
    });

    it("uses empty string as default title", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "session-1" }]; // No title
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await loadCurrentSessionMessages();

      expect(setSessionViewSessionTitle).toHaveBeenCalledWith("");
    });

    it('uses "idle" as default status', async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "session-1" }]; // No status
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await loadCurrentSessionMessages();

      expect(setSessionViewStatus).toHaveBeenCalledWith("idle");
    });

    it("handles null data from messages response", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "session-1", title: "Test" }];
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: null });

      await loadCurrentSessionMessages();

      expect(setSessionViewMessages).toHaveBeenCalledWith([]);
    });
  });

  // =========================================================================
  // switchSession
  // =========================================================================

  describe("switchSession", () => {
    it("does nothing when only one session exists", async () => {
      mockState.sessionViewSessions = [{ id: "single" }];
      mockState.sessionViewSessionIndex = 0;

      await switchSession("next");

      expect(setSessionViewSessionIndex).not.toHaveBeenCalled();
    });

    it("does nothing when no sessions exist", async () => {
      mockState.sessionViewSessions = [];

      await switchSession("next");

      expect(setSessionViewSessionIndex).not.toHaveBeenCalled();
    });

    it("switches to next session with wrap-around", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [
        { id: "session-0" },
        { id: "session-1" },
        { id: "session-2" },
      ];
      mockState.sessionViewSessionIndex = 2;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await switchSession("next");

      expect(setSessionViewSessionIndex).toHaveBeenCalledWith(0); // Wraps to 0
    });

    it("switches to previous session with wrap-around", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [
        { id: "session-0" },
        { id: "session-1" },
        { id: "session-2" },
      ];
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await switchSession("prev");

      expect(setSessionViewSessionIndex).toHaveBeenCalledWith(2); // Wraps to 2
    });

    it("switches forward correctly", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [
        { id: "session-0" },
        { id: "session-1" },
        { id: "session-2" },
      ];
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await switchSession("next");

      expect(setSessionViewSessionIndex).toHaveBeenCalledWith(1);
    });

    it("switches backward correctly", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [
        { id: "session-0" },
        { id: "session-1" },
        { id: "session-2" },
      ];
      mockState.sessionViewSessionIndex = 2;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await switchSession("prev");

      expect(setSessionViewSessionIndex).toHaveBeenCalledWith(1);
    });

    it("calls render after switching", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessions = [{ id: "a" }, { id: "b" }];
      mockState.sessionViewSessionIndex = 0;

      mockSessionMessages.mockResolvedValue({ data: [] });

      await switchSession("next");

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // exitSessionView
  // =========================================================================

  describe("exitSessionView", () => {
    it("aborts SSE stream if active", () => {
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, "abort");
      mockState.sessionViewEventAbort = abortController;

      exitSessionView();

      expect(abortSpy).toHaveBeenCalled();
      expect(setSessionViewEventAbort).toHaveBeenCalledWith(null);
    });

    it("does not throw when no abort controller exists", () => {
      mockState.sessionViewEventAbort = null;

      expect(() => exitSessionView()).not.toThrow();
    });

    it("calls resetSessionViewState", () => {
      exitSessionView();

      expect(resetSessionViewState).toHaveBeenCalled();
    });

    it("calls render", () => {
      exitSessionView();

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // subscribeToSessionEvents
  // =========================================================================

  describe("subscribeToSessionEvents", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessionID = "session-123";

      await subscribeToSessionEvents();

      expect(mockEventSubscribe).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = null;

      await subscribeToSessionEvents();

      expect(mockEventSubscribe).not.toHaveBeenCalled();
    });

    it("creates abort controller and sets it in state", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      // Create an async iterator that immediately completes
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          // Empty stream
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      expect(setSessionViewEventAbort).toHaveBeenCalledWith(
        expect.any(AbortController),
      );
    });

    it("handles event stream error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      mockEventSubscribe.mockRejectedValue(new Error("Stream failed"));

      await subscribeToSessionEvents();

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Event stream error: Stream failed",
      );
    });

    it("ignores abort errors", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockEventSubscribe.mockRejectedValue(abortError);

      await subscribeToSessionEvents();

      expect(setSessionViewError).not.toHaveBeenCalled();
    });

    it("does not set error when sessionViewActive is false", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = false;

      mockEventSubscribe.mockRejectedValue(new Error("Stream failed"));

      await subscribeToSessionEvents();

      expect(setSessionViewError).not.toHaveBeenCalled();
    });

    it("filters events by sessionID", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        { type: "message.updated", properties: { sessionID: "other-session" } },
        { type: "session.idle", properties: { sessionID: "session-123" } },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length && mockState.sessionViewActive) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false; // Stop after yielding
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      // The first event should be filtered out (different sessionID)
      // The second event should trigger setSessionViewStatus
      expect(setSessionViewStatus).toHaveBeenCalledWith("idle");
    });

    it("handles message.updated event", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        { type: "message.updated", properties: { sessionID: "session-123" } },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });
      mockSessionMessages.mockResolvedValue({ data: [] });

      await subscribeToSessionEvents();

      // message.updated triggers refreshMessages which calls session.messages
      expect(mockSessionMessages).toHaveBeenCalled();
    });

    it("handles session.status event", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        {
          type: "session.status",
          properties: { sessionID: "session-123", status: "running" },
        },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      expect(setSessionViewStatus).toHaveBeenCalledWith("running");
    });

    it("handles session.idle event", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        { type: "session.idle", properties: { sessionID: "session-123" } },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      expect(setSessionViewStatus).toHaveBeenCalledWith("idle");
    });

    it("handles permission.updated event", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        {
          type: "permission.updated",
          properties: {
            sessionID: "session-123",
            id: "perm-1",
            tool: "bash",
            args: { command: "ls" },
            message: "Allow?",
          },
        },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      expect(sessionViewPendingPermissions.has("perm-1")).toBe(true);
      expect(sessionViewPendingPermissions.get("perm-1")).toEqual({
        id: "perm-1",
        tool: "bash",
        args: { command: "ls" },
        message: "Allow?",
      });
    });

    it("handles permission.replied event", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      sessionViewPendingPermissions.set("perm-1", {
        id: "perm-1",
        tool: "bash",
      });

      const events = [
        {
          type: "permission.replied",
          properties: { sessionID: "session-123", id: "perm-1" },
        },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      expect(sessionViewPendingPermissions.has("perm-1")).toBe(false);
    });

    it("breaks loop when sessionViewActive becomes false", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      let yieldCount = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            yieldCount++;
            if (yieldCount > 1) {
              mockState.sessionViewActive = false;
            }
            yield {
              type: "session.idle",
              properties: { sessionID: "session-123" },
            };
          }
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      // Should have exited after sessionViewActive became false
      expect(yieldCount).toBeLessThanOrEqual(3);
    });

    it("handles file.edited event (no-op)", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        { type: "file.edited", properties: { sessionID: "session-123" } },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      // Should not trigger any side effects
      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("handles tool.execute.before event (no-op)", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        {
          type: "tool.execute.before",
          properties: { sessionID: "session-123" },
        },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      // Should not trigger any side effects
      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("handles tool.execute.after event (no-op)", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewActive = true;

      const events = [
        {
          type: "tool.execute.after",
          properties: { sessionID: "session-123" },
        },
      ];

      let eventIndex = 0;
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          while (eventIndex < events.length) {
            yield events[eventIndex++];
          }
          mockState.sessionViewActive = false;
        },
      };
      mockEventSubscribe.mockResolvedValue({ stream: mockStream });

      await subscribeToSessionEvents();

      // Should not trigger any side effects
      expect(mockSessionMessages).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // refreshMessages
  // =========================================================================

  describe("refreshMessages", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessionID = "session-123";

      await refreshMessages();

      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = null;

      await refreshMessages();

      expect(mockSessionMessages).not.toHaveBeenCalled();
    });

    it("fetches and sets messages", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewScrollOffset = 0;

      const messages = [
        createMessage("user", [{ type: "text", text: "Hello" }]),
      ];
      mockSessionMessages.mockResolvedValue({ data: messages });

      await refreshMessages();

      expect(mockSessionMessages).toHaveBeenCalledWith({
        path: { id: "session-123" },
      });
      expect(setSessionViewMessages).toHaveBeenCalledWith(messages);
    });

    it("preserves scroll position at bottom", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      mockState.sessionViewScrollOffset = 0; // At bottom

      mockSessionMessages.mockResolvedValue({ data: [] });

      await refreshMessages();

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("handles null data gracefully", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionMessages.mockResolvedValue({ data: null });

      await refreshMessages();

      expect(setSessionViewMessages).toHaveBeenCalledWith([]);
    });

    it("ignores fetch errors silently", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionMessages.mockRejectedValue(new Error("Network error"));

      await expect(refreshMessages()).resolves.not.toThrow();
      expect(setSessionViewError).not.toHaveBeenCalled();
    });

    it("calls render after successful refresh", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionMessages.mockResolvedValue({ data: [] });

      await refreshMessages();

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // abortSession
  // =========================================================================

  describe("abortSession", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessionID = "session-123";

      await abortSession();

      expect(mockSessionAbort).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = null;

      await abortSession();

      expect(mockSessionAbort).not.toHaveBeenCalled();
    });

    it("calls session.abort with correct session ID", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionAbort.mockResolvedValue({});

      await abortSession();

      expect(mockSessionAbort).toHaveBeenCalledWith({
        path: { id: "session-123" },
      });
    });

    it("updates state after successful abort", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionAbort.mockResolvedValue({});

      await abortSession();

      expect(setSessionViewConfirmAbort).toHaveBeenCalledWith(false);
      expect(setSessionViewStatus).toHaveBeenCalledWith("idle");
    });

    it("handles abort error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionAbort.mockRejectedValue(new Error("Abort failed"));

      await abortSession();

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Abort failed: Abort failed",
      );
      expect(setSessionViewConfirmAbort).toHaveBeenCalledWith(false);
    });

    it("calls render after abort", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionAbort.mockResolvedValue({});

      await abortSession();

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // abortInstanceSession
  // =========================================================================

  describe("abortInstanceSession", () => {
    it("returns early when serverUrl is not set", async () => {
      const instance = createInstance({ serverUrl: undefined });

      await abortInstanceSession(instance);

      expect(mockSessionAbort).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      const instance = createInstance({ sessionID: undefined });

      await abortInstanceSession(instance);

      expect(mockSessionAbort).not.toHaveBeenCalled();
    });

    it("returns early when SDK is not available", async () => {
      mockState.sdkAvailable = false;
      const instance = createInstance();

      await abortInstanceSession(instance);

      expect(mockSessionAbort).not.toHaveBeenCalled();
    });

    it("calls abort with correct session ID", async () => {
      const instance = createInstance({
        serverUrl: "http://localhost:4096",
        sessionID: "session-to-abort",
      });

      mockSessionAbort.mockResolvedValue({});

      await abortInstanceSession(instance);

      expect(getOpencodeClient).toHaveBeenCalledWith("http://localhost:4096");
      expect(mockSessionAbort).toHaveBeenCalledWith({
        path: { id: "session-to-abort" },
      });
    });

    it("updates instance status on success", async () => {
      const instance = createInstance({ status: "busy" });

      mockSessionAbort.mockResolvedValue({});

      await abortInstanceSession(instance);

      expect(instance.status).toBe("idle");
    });

    it("handles abort error silently", async () => {
      const instance = createInstance();

      mockSessionAbort.mockRejectedValue(new Error("Abort failed"));

      await expect(abortInstanceSession(instance)).resolves.not.toThrow();
    });

    it("calls render on success", async () => {
      const instance = createInstance();

      mockSessionAbort.mockResolvedValue({});

      await abortInstanceSession(instance);

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // respondToPermission
  // =========================================================================

  describe("respondToPermission", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessionID = "session-123";

      await respondToPermission("perm-1", "allow");

      expect(mockPostPermission).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = null;

      await respondToPermission("perm-1", "allow");

      expect(mockPostPermission).not.toHaveBeenCalled();
    });

    it("calls API with correct parameters", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockPostPermission.mockResolvedValue({});

      await respondToPermission("perm-1", "allow", false);

      expect(mockPostPermission).toHaveBeenCalledWith({
        path: { id: "session-123", permissionId: "perm-1" },
        body: { response: "allow", remember: false },
      });
    });

    it("sends remember=true when specified", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockPostPermission.mockResolvedValue({});

      await respondToPermission("perm-1", "allow", true);

      expect(mockPostPermission).toHaveBeenCalledWith({
        path: { id: "session-123", permissionId: "perm-1" },
        body: { response: "allow", remember: true },
      });
    });

    it("removes permission from pending after success", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";
      sessionViewPendingPermissions.set("perm-1", {
        id: "perm-1",
        tool: "bash",
      });

      mockPostPermission.mockResolvedValue({});

      await respondToPermission("perm-1", "allow");

      expect(sessionViewPendingPermissions.has("perm-1")).toBe(false);
    });

    it("handles permission response error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockPostPermission.mockRejectedValue(new Error("Permission denied"));

      await respondToPermission("perm-1", "allow");

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Permission response failed: Permission denied",
      );
    });

    it("calls render after response", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockPostPermission.mockResolvedValue({});

      await respondToPermission("perm-1", "allow");

      expect(mockRender).toHaveBeenCalled();
    });

    it("defaults remember to false", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockPostPermission.mockResolvedValue({});

      await respondToPermission("perm-1", "deny");

      expect(mockPostPermission).toHaveBeenCalledWith({
        path: { id: "session-123", permissionId: "perm-1" },
        body: { response: "deny", remember: false },
      });
    });
  });

  // =========================================================================
  // sendMessage
  // =========================================================================

  describe("sendMessage", () => {
    it("returns early when client is not set", async () => {
      mockState.sessionViewClient = null;
      mockState.sessionViewSessionID = "session-123";

      await sendMessage("Hello");

      expect(mockSessionPrompt).not.toHaveBeenCalled();
    });

    it("returns early when sessionID is not set", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = null;

      await sendMessage("Hello");

      expect(mockSessionPrompt).not.toHaveBeenCalled();
    });

    it("returns early when text is empty", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      await sendMessage("");

      expect(mockSessionPrompt).not.toHaveBeenCalled();
    });

    it("returns early when text is only whitespace", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      await sendMessage("   \n\t  ");

      expect(mockSessionPrompt).not.toHaveBeenCalled();
    });

    it("updates state before sending", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionPrompt.mockResolvedValue({});

      await sendMessage("Hello");

      expect(setSessionViewInputMode).toHaveBeenCalledWith(false);
      expect(setSessionViewInputBuffer).toHaveBeenCalledWith("");
      expect(setSessionViewStatus).toHaveBeenCalledWith("busy");
    });

    it("sends message with correct format", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionPrompt.mockResolvedValue({});

      await sendMessage("Hello world");

      expect(mockSessionPrompt).toHaveBeenCalledWith({
        path: { id: "session-123" },
        body: {
          parts: [{ type: "text", text: "Hello world" }],
        },
      });
    });

    it("trims whitespace from message", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionPrompt.mockResolvedValue({});

      await sendMessage("  Hello world  ");

      expect(mockSessionPrompt).toHaveBeenCalledWith({
        path: { id: "session-123" },
        body: {
          parts: [{ type: "text", text: "Hello world" }],
        },
      });
    });

    it("handles send error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionPrompt.mockRejectedValue(new Error("Send failed"));

      await sendMessage("Hello");

      expect(setSessionViewError).toHaveBeenCalledWith(
        "Send failed: Send failed",
      );
    });

    it("calls render before sending and on error", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionPrompt.mockRejectedValue(new Error("Send failed"));

      await sendMessage("Hello");

      expect(mockRender).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // renderSessionViewLines
  // =========================================================================

  describe("renderSessionViewLines", () => {
    it("renders empty array when no messages", () => {
      mockState.sessionViewMessages = [];

      renderSessionViewLines();

      expect(setSessionViewRenderedLines).toHaveBeenCalledWith([]);
    });

    it("renders user message with header and footer", () => {
      mockState.sessionViewMessages = [
        createMessage("user", [{ type: "text", text: "Hello" }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];

      // Should have header, text line(s), footer, spacer
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].type).toBe("header");
      expect(lines[0].plain).toContain("User");
    });

    it("renders assistant message with header and footer", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [{ type: "text", text: "Hi there!" }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];

      expect(lines[0].type).toBe("header");
      expect(lines[0].plain).toContain("Assistant");
    });

    it("renders cost info when available", () => {
      mockState.sessionViewMessages = [
        {
          info: { role: "assistant", cost: 0.1234 },
          parts: [{ type: "text", text: "Response" }],
        },
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      expect(lines[0].plain).toContain("$0.1234");
    });

    it("renders text parts", () => {
      mockState.sessionViewMessages = [
        createMessage("user", [{ type: "text", text: "Line 1\nLine 2" }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const textLines = lines.filter((l: RenderedLine) => l.type === "text");
      expect(textLines.length).toBeGreaterThan(0);
    });

    it("renders tool parts with status indicators", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              output: "file.txt",
            },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart).toBeDefined();
      expect(toolStart!.plain).toContain("✓"); // Completed status
      expect(toolStart!.plain).toContain("bash");
    });

    it("renders pending tool with circle indicator", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("○");
    });

    it("renders running tool with spinner indicator", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "running", input: {} },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("⠋");
    });

    it("renders error tool with X indicator", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "error", input: {} },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("✗");
    });

    it("renders tool with title instead of tool name when available", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: {}, title: "Running tests" },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("Running tests");
    });

    it("renders tool output when completed", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: {}, output: "result" },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const resultLines = lines.filter(
        (l: RenderedLine) => l.type === "tool-result",
      );
      expect(resultLines.length).toBeGreaterThan(0);
    });

    it("truncates long tool output", () => {
      const longOutput = Array(20).fill("line").join("\n");
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: {}, output: longOutput },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const truncatedLine = lines.find((l: RenderedLine) =>
        l.plain.includes("more lines"),
      );
      expect(truncatedLine).toBeDefined();
    });

    it("renders reasoning parts", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          { type: "reasoning", reasoning: "Let me think about this..." },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const reasoningStart = lines.find(
        (l: RenderedLine) => l.type === "reasoning-start",
      );
      expect(reasoningStart).toBeDefined();
      expect(reasoningStart!.plain).toContain("Thinking...");
    });

    it("renders reasoning with text fallback", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          { type: "reasoning", text: "Fallback thinking text" },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const reasoningLines = lines.filter(
        (l: RenderedLine) => l.type === "reasoning",
      );
      expect(reasoningLines.length).toBeGreaterThan(0);
    });

    it("skips empty reasoning parts", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [{ type: "reasoning", text: "" }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const reasoningStart = lines.find(
        (l: RenderedLine) => l.type === "reasoning-start",
      );
      expect(reasoningStart).toBeUndefined();
    });

    it("skips step-start and step-finish parts", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          { type: "step-start" },
          { type: "text", text: "Content" },
          { type: "step-finish" },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const stepLines = lines.filter(
        (l: RenderedLine) =>
          l.type === "step-start" || l.type === "step-finish",
      );
      expect(stepLines.length).toBe(0);
    });

    it("renders unknown part types with type label", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [{ type: "unknown-type" as any }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const unknownLine = lines.find((l: RenderedLine) =>
        l.plain.includes("[unknown-type]"),
      );
      expect(unknownLine).toBeDefined();
    });

    it("adds spacer between messages", () => {
      mockState.sessionViewMessages = [
        createMessage("user", [{ type: "text", text: "Hello" }]),
        createMessage("assistant", [{ type: "text", text: "Hi!" }]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const spacers = lines.filter((l: RenderedLine) => l.type === "spacer");
      expect(spacers.length).toBe(2); // One after each message
    });

    it("handles tool without state", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          { type: "tool", tool: "bash" }, // No state
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("○"); // Default pending status
    });

    it("handles tool without tool name", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          { type: "tool", state: { status: "completed" as const, input: {} } },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const toolStart = lines.find(
        (l: RenderedLine) => l.type === "tool-start",
      );
      expect(toolStart!.plain).toContain("unknown");
    });
  });

  // =========================================================================
  // scrollSessionView
  // =========================================================================

  describe("scrollSessionView", () => {
    beforeEach(() => {
      mockState.termHeight = 30; // contentHeight = 30 - 6 = 24
      mockState.sessionViewRenderedLines = Array(50).fill({
        type: "text",
        text: "",
        plain: "",
      });
      mockState.sessionViewScrollOffset = 10;
    });

    it("scrolls up by one line", () => {
      // maxScroll = 50 - 24 = 26
      scrollSessionView("up");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(11);
    });

    it("scrolls down by one line", () => {
      scrollSessionView("down");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(9);
    });

    it("scrolls up by page", () => {
      // contentHeight = 24, current = 10, maxScroll = 26
      scrollSessionView("pageup");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(26); // min(26, 10+24)
    });

    it("scrolls down by page", () => {
      mockState.sessionViewScrollOffset = 25;
      scrollSessionView("pagedown");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(1); // max(0, 25-24)
    });

    it("scrolls to home (oldest/top)", () => {
      scrollSessionView("home");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(26); // maxScroll
    });

    it("scrolls to end (newest/bottom)", () => {
      scrollSessionView("end");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("does not scroll past maxScroll when scrolling up", () => {
      mockState.sessionViewScrollOffset = 25;
      scrollSessionView("up");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(26); // capped at maxScroll
    });

    it("does not scroll below 0 when scrolling down", () => {
      mockState.sessionViewScrollOffset = 0;
      scrollSessionView("down");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("handles content smaller than viewport", () => {
      mockState.sessionViewRenderedLines = Array(10).fill({
        type: "text",
        text: "",
        plain: "",
      });
      // contentHeight = 24, lines = 10, maxScroll = max(0, 10-24) = 0
      mockState.sessionViewScrollOffset = 0;

      scrollSessionView("up");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("handles empty content", () => {
      mockState.sessionViewRenderedLines = [];
      mockState.sessionViewScrollOffset = 0;

      scrollSessionView("up");

      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(0);
    });

    it("calls render after scrolling", () => {
      scrollSessionView("up");

      expect(mockRender).toHaveBeenCalled();
    });

    it("calculates contentHeight correctly", () => {
      mockState.termHeight = 20; // contentHeight = 20 - 6 = 14
      mockState.sessionViewRenderedLines = Array(30).fill({});
      // maxScroll = 30 - 14 = 16
      mockState.sessionViewScrollOffset = 10;

      scrollSessionView("pageup");

      // 10 + 14 = 24, but maxScroll is 16
      expect(setSessionViewScrollOffset).toHaveBeenCalledWith(16);
    });
  });

  // =========================================================================
  // Edge Cases and Integration
  // =========================================================================

  describe("edge cases", () => {
    it("handles message with null parts", () => {
      mockState.sessionViewMessages = [
        { info: { role: "user" }, parts: null as any },
      ];

      expect(() => renderSessionViewLines()).not.toThrow();
    });

    it("handles message with undefined parts", () => {
      mockState.sessionViewMessages = [
        { info: { role: "user" }, parts: undefined as any },
      ];

      expect(() => renderSessionViewLines()).not.toThrow();
    });

    it("handles text part with null text", () => {
      mockState.sessionViewMessages = [
        createMessage("user", [{ type: "text", text: null as any }]),
      ];

      expect(() => renderSessionViewLines()).not.toThrow();
    });

    it("handles tool args formatting", () => {
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: {
              status: "completed" as const,
              input: { command: "ls -la", path: "/home" },
              output: "files",
            },
          },
        ]),
      ];

      renderSessionViewLines();

      const lines = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const argsLines = lines.filter(
        (l: RenderedLine) => l.type === "tool-args",
      );
      expect(argsLines.length).toBeGreaterThan(0);
    });

    it("handles very long tool output truncation correctly", () => {
      const lines = Array(100).fill("output line").join("\n");
      mockState.sessionViewMessages = [
        createMessage("assistant", [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed" as const, input: {}, output: lines },
          },
        ]),
      ];

      renderSessionViewLines();

      const rendered = vi.mocked(setSessionViewRenderedLines).mock.calls[0][0];
      const truncationLine = rendered.find((l: RenderedLine) =>
        l.plain.includes("more lines"),
      );
      expect(truncationLine).toBeDefined();
      expect(truncationLine!.plain).toContain("90 more lines"); // 100 - 10
    });

    it("handles concurrent state updates", async () => {
      mockState.sessionViewClient = mockClient;
      mockState.sessionViewSessionID = "session-123";

      mockSessionAbort.mockResolvedValue({});
      mockSessionPrompt.mockResolvedValue({});

      // Trigger multiple operations
      const abort = abortSession();
      const send = sendMessage("test");

      await Promise.all([abort, send]);

      // Both should complete without error
      expect(mockSessionAbort).toHaveBeenCalled();
      expect(mockSessionPrompt).toHaveBeenCalled();
    });
  });
});
