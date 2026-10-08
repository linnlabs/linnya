import { describe, expect, it } from 'vitest';
import { systemReminder } from '@linnlabs/linnkit/runtime-kernel';
import type { LlmRequestMessage } from '@linnlabs/linnkit/ports';
import { GenericAgentTask } from '../../GenericAgentTask';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from '../index';
import { LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY } from '../systemReminder';
import definition, { RESEARCH_SYSTEM_REMINDER_POLICY } from './index';
import investigationReview from '../deep_research_investigation_review';
import argumentReview from '../deep_research_argument_review';
import sourceReview from '../deep_research_source_review';

describe('research definitions through the standard task and reminder runtime', () => {
  it.each([definition, investigationReview, argumentReview, sourceReview])(
    '$id: builds the registered task and retains the admitted prompt on continuation',
    selected => {
      const registered = ALL_AGENT_DEFINITIONS_FOR_TESTS.find(item => item.id === selected.id);
      if (!registered) throw new Error(`Research definition was not registered: ${selected.id}`);
      const task = new GenericAgentTask(registered);
      const request = { query: 'Investigate the supplied question', promptKey: registered.promptKey };
      const original = task.buildMessages(request, []).find(message => message.role === 'system');
      expect(typeof original?.content).toBe('string');
      if (typeof original?.content !== 'string') throw new Error('Missing textual system prompt');
      // 核对definition输入是否冻结；框架另加的通用安全尾注不属于场景prompt。
      const resumedRequest: AgentInvokeRequest = { ...request, frozenSystemPrompt: original.content };
      expect(task.getSystemPromptForRequest(resumedRequest)).toBe(original.content);
    },
  );

  it('injects the research reminder only at its cadence without mutating history or Default policy', () => {
    const messages: LlmRequestMessage[] = [
      { role: 'user', content: 'Continue the investigation.' },
    ];
    const injected: string[][] = [];
    const apply = (stepCount: number, policy = RESEARCH_SYSTEM_REMINDER_POLICY) =>
      systemReminder.applySystemReminders({
        llmMessages: messages,
        ctx: {
          request: { query: 'research', promptKey: definition.promptKey },
          history: [],
          executorLocal: { stepCount, maxSteps: 800, remainingSteps: 800 - stepCount },
        },
        policy,
        onInjected: info => injected.push(info.ruleIds),
      });
    expect(apply(29)).toEqual(messages);
    const prepared = apply(30);
    expect(injected.flat()).toContain('linnya_periodic_research_reflection');
    expect(prepared[0]?.role).toBe('user');
    expect(prepared[0]?.content).not.toBe(messages[0]?.content);
    expect(messages).toEqual([{ role: 'user', content: 'Continue the investigation.' }]);
    injected.length = 0;
    apply(30, LINNYA_DEFAULT_AGENT_SYSTEM_REMINDER_POLICY);
    expect(injected.flat()).not.toContain('linnya_periodic_research_reflection');
  });
});
