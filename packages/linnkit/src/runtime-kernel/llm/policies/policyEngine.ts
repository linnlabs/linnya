/**
 * @file src/agent/runtime-kernel/llm/policies/policyEngine.ts
 *
 * @description
 * 失败后的 LLM 路由建议引擎：按 match 条件筛选 policies，再依次询问 onError。
 * 它不能观察或改写 Provider request/response wire 数据。
 */

import type {
  LLMPolicy,
  LLMPolicyMatchContext,
  LLMPolicyErrorDecision
} from './types';

export class LLMPolicyEngine {
  private readonly policies: LLMPolicy[];

  constructor(policies: LLMPolicy[]) {
    this.policies = Array.isArray(policies) ? policies : [];
  }

  private matched(ctx: LLMPolicyMatchContext): LLMPolicy[] {
    return this.policies.filter(p => {
      try {
        return p.match(ctx);
      } catch {
        return false;
      }
    });
  }

  decideOnError(error: Error, ctx: LLMPolicyMatchContext): LLMPolicyErrorDecision {
    const matched = this.matched(ctx);
    for (const p of matched) {
      if (!p.onError) continue;
      try {
        const decision = p.onError(error, ctx);
        if (decision && decision.action !== 'none') return decision;
      } catch {
        // ignore
      }
    }
    return { action: 'none' };
  }
}
