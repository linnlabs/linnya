import { describe, expect, it } from 'vitest';
import { applySystemReminders, type SystemReminderContext } from '@linnlabs/linnkit/runtime-kernel';
import type { LlmRequestMessage } from '@linnlabs/linnkit/ports';
import { SLIDES_CONTEXT_POLICY } from './executionPolicy';

describe('Slides phase checkpoint delivered through runtime reminder policy', () => {
  it('到达阶段节点才注入实际模型输入，既不污染历史也不修改原消息', () => {
    const messages: LlmRequestMessage[] = [{ role: 'user', content: '继续制作 20 页学术稿' }];
    const ctx: SystemReminderContext = {
      request: { query: '继续', promptKey: 'slides_agent' }, history: [],
      executorLocal: { stepCount: 20, maxSteps: 800, remainingSteps: 780 },
    };
    const injected: string[] = [];
    const result = applySystemReminders({ llmMessages: messages, ctx,
      policy: SLIDES_CONTEXT_POLICY?.systemReminder,
      onInjected: ({ ruleIds }) => injected.push(...ruleIds),
    });
    expect(injected).toContain('slides_phase_checkpoint');
    expect(result[0]?.content).toContain('连续三轮无进展');
    expect(result[0]?.content).toContain('versionId');
    expect(messages[0]?.content).toBe('继续制作 20 页学术稿');
    expect(ctx.history).toEqual([]);
    expect(applySystemReminders({ llmMessages: messages,
      ctx: { ...ctx, executorLocal: { stepCount: 18, maxSteps: 800, remainingSteps: 782 } },
      policy: SLIDES_CONTEXT_POLICY?.systemReminder,
    })).toEqual(messages);
  });
});
