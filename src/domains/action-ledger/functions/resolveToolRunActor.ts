import type { ActionRunActor } from '../definitions/actionLedger';

/** 工具执行时由 Host 注入的运行身份；模型参数和 owner 都不能提供这些值。 */
export interface ToolRunIdentity {
  readonly runId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly conversationId?: string;
  readonly parentToolCallId?: string;
}

/**
 * 从工具上下文得出执行者。没有运行编号的上下文不是 Agent 运行（只出现在测试装配里），不入账。
 * 子运行必须带根运行：嵌套子运行只知道直接父运行，缺根时无法归到用户的这次请求。
 */
export function resolveToolRunActor(identity: ToolRunIdentity): ActionRunActor | undefined {
  const { runId, rootRunId, parentRunId } = identity;
  if (!runId) return undefined;
  const conversationId = identity.conversationId ?? null;
  const toolCallId = identity.parentToolCallId ?? null;
  if (!parentRunId) {
    if (rootRunId !== undefined && rootRunId !== runId) {
      throw new Error(`运行 ${runId} 没有父运行，却带着另一个根运行 ${rootRunId}`);
    }
    return { kind: 'run', runId, rootRunId: runId, parentRunId: null, conversationId, toolCallId };
  }
  if (!rootRunId) throw new Error(`子运行 ${runId} 缺少根运行身份，不能记入行动账本`);
  if (rootRunId === runId) throw new Error(`子运行 ${runId} 不能以自己为根运行`);
  return { kind: 'subrun', runId, rootRunId, parentRunId, conversationId, toolCallId };
}
