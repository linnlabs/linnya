import { describe, expect, it } from 'vitest';

import { defineContextPolicy } from '../../../contracts';
import {
  buildQuickstartContextTrace,
  resolveQuickstartMaxSteps,
} from '../contextTrace';

describe('quickstart context trace helpers', () => {
  it('标明 quickstart 不执行完整 contextPolicy', () => {
    const policy = defineContextPolicy({
      budget: { maxTokens: 1234 },
      contextTrace: { enabled: true },
    });

    expect(buildQuickstartContextTrace({
      agentId: 'hello',
      messageCount: 2,
      contextPolicy: policy,
    })).toMatchObject({
      kind: 'quickstart_context_trace',
      agentId: 'hello',
      messageCount: 2,
      builder: 'QuickstartContextBuilder',
      contextPolicyExecution: {
        profileId: 'agent',
        mode: 'quickstart_minimal',
        executed: false,
        declaredUnsupportedFields: expect.arrayContaining(['budget', 'contextTrace']),
      },
    });
  });

  it('maxSteps 只接受正整数，否则回到 quickstart 默认值', () => {
    expect(resolveQuickstartMaxSteps(3)).toBe(3);
    expect(resolveQuickstartMaxSteps(0)).toBe(8);
    expect(resolveQuickstartMaxSteps(1.5)).toBe(8);
    expect(resolveQuickstartMaxSteps(undefined)).toBe(8);
  });
});
