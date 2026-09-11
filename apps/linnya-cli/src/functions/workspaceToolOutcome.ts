import type { ConversationUiMessage } from '@app/schemas';

type ToolMessage = Extract<ConversationUiMessage, { message_type: 'tool_calls' }>;

/** 保存源码成功不等于文档构建成功；通用文档诊断保留工具 owner 的失败事实。 */
export function workspaceToolSucceeded(message: ToolMessage): boolean {
  if (message.payload.status !== 'success') return false;
  const data = message.payload.data;
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return true;
  const diagnostics = data.diagnostics;
  return !Array.isArray(diagnostics) || !diagnostics.some(diagnostic => (
    diagnostic != null && typeof diagnostic === 'object' && !Array.isArray(diagnostic)
    && diagnostic.severity === 'error'
  ));
}
