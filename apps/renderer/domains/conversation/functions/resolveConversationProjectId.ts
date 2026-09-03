/**
 * @file apps/renderer/domains/conversation/functions/resolveConversationProjectId.ts
 * @description
 * 解析「会话所属项目 projectId」的统一工具函数。
 *
 * 背景（根因说明）：
 * - 历史会话列表请求会携带 `projectId` 作为后端过滤条件；
 * - 如果外部任务链路在调用 `invokeAssistant` 时没有传 `projectId`，
 *   后端会把该会话落为 `project_id = null`（或缺失），从而在“当前项目作用域”的历史列表中不可见。
 *
 * 设计原则：
 * - 优先使用 workspaceScope 的 currentProjectId（单一事实来源）；
 * - 仅在 scope 不可用时，才从会话 metadata 中回退读取 `projectId` / `project_id`；
 * - 严格类型：不使用 any 类型断言。
 */

function readStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!(key in obj)) return undefined;
  const record = obj as Record<string, unknown>;
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function resolveConversationProjectId(
  scopeProjectId: string | null,
  conversationMetadata: unknown
): string | undefined {
  // 1) scope 优先：它代表“当前用户正在看的项目”
  if (typeof scopeProjectId === 'string' && scopeProjectId.length > 0) {
    return scopeProjectId;
  }

  // 2) 回退：某些场景会把项目归属写在会话 metadata 中（历史加载/兼容字段）
  return (
    readStringField(conversationMetadata, 'projectId') ??
    readStringField(conversationMetadata, 'project_id')
  );
}
