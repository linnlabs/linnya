import type { ExecutorLlmInvocationKind } from '../types';

export interface LlmInvocationStatePatch {
  llmInvocationKind: ExecutorLlmInvocationKind;
  llmInvocationCount: number;
}

function normalizeInvocationCount(value: unknown): number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : 0;
}

/**
 * 决定当前节点执行前要注入的 LLM 调用语义。
 *
 * 中文备注：
 * - 判断依据是“已经发生过几次 LLM 调用”，而不是 graph stepCount；
 * - stepCount 会被 checkpoint reset、child-run 起点、startNode=llm 干扰，不能表达业务语义。
 */
export function decideLlmInvocationState(params: {
  nodeId: string;
  previousInvocationCount: unknown;
}): LlmInvocationStatePatch | undefined {
  if (params.nodeId !== 'llm') {
    return undefined;
  }

  const previousInvocationCount = normalizeInvocationCount(params.previousInvocationCount);
  return {
    llmInvocationKind: previousInvocationCount === 0 ? 'user_initiated' : 'continuation',
    llmInvocationCount: previousInvocationCount + 1,
  };
}
