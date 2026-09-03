import { describe, expect, it } from 'vitest';

import { defaultPolicyEngine } from '../defaultPolicyEngine';
import { LLMPolicyEngine } from '../policyEngine';

describe('defaultPolicyEngine', () => {
  it('Linnkit 默认 policy engine 不应内置模型失败路由策略', () => {
    const errorDecision = defaultPolicyEngine.decideOnError(
      new Error('route rejected request'),
      {
        modelId: 'host-model',
      },
    );

    expect(errorDecision).toEqual({ action: 'none' });
  });

  it('只允许匹配策略根据错误建议切换模型', () => {
    const engine = new LLMPolicyEngine([{
      name: 'host-route-policy',
      match: context => context.modelId === 'host-model',
      onError: error => error.message === 'route unavailable'
        ? { action: 'switch_model', reason: 'route unavailable' }
        : { action: 'none' },
    }]);

    expect(engine.decideOnError(new Error('route unavailable'), {
      modelId: 'host-model',
    })).toEqual({
      action: 'switch_model',
      reason: 'route unavailable',
    });
    expect(engine.decideOnError(new Error('route unavailable'), {
      modelId: 'another-model',
    })).toEqual({ action: 'none' });
  });
});
