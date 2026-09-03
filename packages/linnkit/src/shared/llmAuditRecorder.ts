/**
 * @file src/agent/shared/llmAuditRecorder.ts
 *
 * @description
 * Agent runtime 对 LLM 审计的最小记录协议。
 *
 * 说明：
 * - runtime-kernel 只需要“记录”审计片段；
 * - AsyncLocalStorage、落盘、Documents 路径等都属于宿主实现，不应反向依赖到 agent package。
 */

export interface ContextManagerAuditRecordInput {
  payload?: unknown;
  contextMessages?: unknown[];
  llmMessages?: unknown[];
  toolNames?: string[];
  systemReminder?: {
    ruleIds?: string[];
  };
  contextTrace?: unknown;
}

export interface ToolProtocolErrorAuditInput {
  toolName: string;
  toolCallId?: string;
  rawArguments?: string;
  parsedArguments?: Record<string, unknown>;
  error: string;
}

export interface RunTranscriptAuditInput {
  transcriptMessages: unknown[];
  toolset?: {
    availableTools?: string[];
  };
}

export interface LlmAuditRecorder {
  recordBeforeContextManager?(params: ContextManagerAuditRecordInput): void;
  recordAfterContextManager?(params: ContextManagerAuditRecordInput): void;
  recordAfterContextManagerOnSystemReminderHit?(params: ContextManagerAuditRecordInput): void;
  recordToolProtocolError?(params: ToolProtocolErrorAuditInput): void;
  recordRunTranscript?(params: RunTranscriptAuditInput): void;
}

let recorder: LlmAuditRecorder | null = null;

export function setLlmAuditRecorder(next: LlmAuditRecorder | null): void {
  recorder = next;
}

export function recordBeforeContextManager(params: ContextManagerAuditRecordInput): void {
  recorder?.recordBeforeContextManager?.(params);
}

export function recordAfterContextManager(params: ContextManagerAuditRecordInput): void {
  recorder?.recordAfterContextManager?.(params);
}

export function recordAfterContextManagerOnSystemReminderHit(params: ContextManagerAuditRecordInput): void {
  recorder?.recordAfterContextManagerOnSystemReminderHit?.(params);
}

export function recordToolProtocolError(params: ToolProtocolErrorAuditInput): void {
  recorder?.recordToolProtocolError?.(params);
}

export function recordRunTranscript(params: RunTranscriptAuditInput): void {
  recorder?.recordRunTranscript?.(params);
}
