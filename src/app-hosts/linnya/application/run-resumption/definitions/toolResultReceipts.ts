/** 每个执行 attempt 绑定的原调用结果；prepare 仅允许支持同事务结果提交的 owner 使用。 */
export interface ToolResultReceiptPort {
  prepare(toolCallId: string, toolName: string): void;
  commit(toolCallId: string, toolName: string, result: string): void;
  returned(toolCallId: string, toolName: string, result: string): void;
}

/** 领域在自己的同步事务内调用，不传递数据库或整个 ToolContext。 */
export interface ToolOwnerResultCommit<T> {
  prepare(): void;
  commit(result: T): void;
}
