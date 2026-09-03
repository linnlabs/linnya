/**
 * @file src/agent/runtime-kernel/llm/policies/types.ts
 *
 * @description
 * LLM Policy 只对失败后的路由动作给出建议。
 * Provider 请求、响应和 continuation 的编解码只属于 Host 注入的 canonical inference adapter。
 */

export type LLMPolicyMatchContext = {
  /** Host 提供的逻辑模型 ID；Linnkit 不解释命名结构。 */
  modelId?: string;
};

export type LLMPolicyErrorDecision =
  | { action: 'none' }
  | { action: 'switch_model'; reason: string };

export interface LLMPolicy {
  /** 名称仅用于日志/调试 */
  name: string;

  /** 是否匹配当前请求上下文 */
  match(ctx: LLMPolicyMatchContext): boolean;

  /** 给主链路一个失败后的路由建议；不得改写 Provider wire 数据。 */
  onError?(error: Error, ctx: LLMPolicyMatchContext): LLMPolicyErrorDecision;
}
