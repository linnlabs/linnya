/**
 * Linnya 工具执行上下文中与 Conversation 存储分区有关的最小投影。
 *
 * `research.instanceId` 是 Linnya Host 的 Deep Research 实例分区，不属于
 * Linnkit 通用 ToolExecutionContext 语义。
 */
export interface ToolConversationScopeContext {
  readonly conversationId?: string;
  readonly research?: {
    readonly instanceId?: string;
  } | Readonly<Record<string, unknown>>;
}

export interface ToolConversationScope {
  readonly conversationId: string;
  readonly instanceId: string;
}
