// Type definitions for oc-session-manager

// Re-export SDK-driven types from connections module
export type {
  Server,
  Session as SDKSession,
  AnnouncePacket,
  ShutdownPacket,
  ConnectionStatus,
} from "./connections.js";

export interface Instance {
  instanceId: string;
  sessionID?: string;
  parentID?: string;
  status: string;
  project?: string;
  directory?: string;
  dirName?: string;
  branch?: string;
  host?: string;
  title?: string;
  serverUrl?: string;
  ts: number;
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  model?: string;
  busyTime?: number;
  _isChildSession?: boolean;
  _fromServer?: boolean;
  children?: Instance[];
}

export interface Session {
  id: string;
  title?: string;
  status?: string;
  parentID?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

export interface ToolState {
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
}

export interface MessagePart {
  type: "text" | "tool" | "reasoning" | "step-start" | "step-finish";
  id?: string;
  text?: string;
  tool?: string;
  state?: ToolState;
  reasoning?: string;
}

export interface MessageInfo {
  role: "user" | "assistant";
  cost?: number;
  tokens?: { input?: number; output?: number };
  providerID?: string;
  modelID?: string;
}

export interface Message {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface Permission {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  message?: string;
}

export interface GroupStats {
  idle: number;
  busy: number;
  stale: number;
  cost: number;
  tokens: number;
}

export type ViewMode = "grouped" | "flat";
export type EffectiveStatus = "idle" | "busy" | "stale";

export interface SelectableItem {
  type: "group" | "instance";
  key?: string;
  instanceId?: string;
  index: number;
}

export interface RenderedLine {
  type: string;
  text: string;
  plain: string;
}

export interface ServerConnection {
  client: any; // OpencodeClient from SDK
  sessions: Session[];
  lastFetch: number;
  error: string | null;
}

export interface KeyEvent {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  sequence?: string;
}
