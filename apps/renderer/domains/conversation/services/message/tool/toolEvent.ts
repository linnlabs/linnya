/*
 * @file apps/renderer/domains/conversation/services/message/tool/toolEvent.ts
 * @description 工具事件相关的纯函数：状态推导与展示选项提取
 */

export type ToolCallPhase = 'start' | 'update' | 'complete' | 'error';
export type ToolStatus = 'loading' | 'success' | 'error';

export interface ToolCallUpsertPatchLite {
  type: 'tool_call_decision' | 'tool_process' | 'tool_output';
  phase: ToolCallPhase;
  status: ToolStatus;
  toolName: string;
  payload?: Record<string, unknown> | null;
}

export function deriveToolCallStatus(
  patch: ToolCallUpsertPatchLite,
): ToolStatus {
  return patch.status;
}
