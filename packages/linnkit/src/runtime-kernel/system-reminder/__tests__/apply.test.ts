import { describe, expect, it } from 'vitest';
import type { AgentInvocationRequest } from '../../../ports';
import type { RuntimeEvent } from '../../../contracts';
import { applySystemReminders } from '../apply';
import { SystemReminderRegistry } from '../registry';
import { ToolCallIdSchema } from '../../../contracts';

const request: AgentInvocationRequest = {
  query: 'hello',
  promptKey: 'default',
  availableTools: ['search'],
};

function baseEvent(
  type: RuntimeEvent['type'],
  id: string
): Pick<RuntimeEvent, 'id' | 'conversation_id' | 'timestamp' | 'turn_id' | 'version'> & {
  type: RuntimeEvent['type'];
} {
  return {
    id,
    type,
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    timestamp: Date.now(),
    version: 1,
  };
}

function userInput(id: string): RuntimeEvent {
  return {
    ...baseEvent('user_input', id),
    type: 'user_input',
    content: 'question',
    source: 'user',
  };
}

function toolDecision(id: string): RuntimeEvent {
  return {
    ...baseEvent('tool_call_decision', id),
    type: 'tool_call_decision',
    tool_name: 'search',
    tool_call_id: ToolCallIdSchema.parse(id),
    phase: 'complete',
    status: 'success',
  };
}

describe('applySystemReminders', () => {
  it('普通 Reminder 只追加到最后一条消息，并保留工具协议字段', () => {
    const messages = [
      { role: 'system' as const, content: 'root' },
      {
        role: 'tool' as const,
        tool_call_id: 'call-1',
        content: 'result',
      },
    ];

    const result = applySystemReminders({
      llmMessages: messages,
      ctx: { request, history: [] },
      rules: [{ id: 'ordinary', when: () => true, build: () => 'ordinary reminder' }],
    });

    expect(result).toEqual([
      { role: 'system', content: 'root' },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'result\n\n<system-reminder>\n- ordinary reminder\n</system-reminder>',
      },
    ]);
    expect(messages[1]?.content).toBe('result');
  });

  it('按 systemReminder.enabledRuleIds 只启用指定规则', () => {
    const injected: string[][] = [];
    const result = applySystemReminders({
      llmMessages: [{ role: 'user', content: '请继续' }],
      ctx: {
        request,
        history: [],
        executorLocal: {
          stepCount: 10,
          maxSteps: 10,
          remainingSteps: 0,
          phase: 'force_final_answer',
          systemReminderPolicy: {
            enabledRuleIds: ['last_steps_hint'],
            thresholds: { lastStepsHintThreshold: 2 },
          },
        },
      },
      onInjected: ({ ruleIds }) => injected.push(ruleIds),
    });

    expect(JSON.stringify(result)).not.toContain('步数预算收尾阶段');
    expect(JSON.stringify(result)).not.toContain('<system-reminder>');
    expect(injected).toEqual([]);
  });

  it('按 systemReminder.thresholds 覆盖工具调用连续提醒阈值', () => {
    const result = applySystemReminders({
      llmMessages: [{ role: 'user', content: '继续' }],
      ctx: {
        request,
        history: [userInput('u1'), toolDecision('t1'), toolDecision('t2')],
        executorLocal: {
          stepCount: 2,
          maxSteps: 20,
          remainingSteps: 18,
          systemReminderPolicy: {
            enabledRuleIds: ['tool_call_streak_every_ten'],
            thresholds: { toolCallStreak: 2 },
          },
        },
      },
    });

    expect(JSON.stringify(result)).toContain('你已连续执行了 2 次工具调用');
  });

  it('支持通过注册表解释 host extraRules', () => {
    const registry = new SystemReminderRegistry();
    registry.registerTriggerKind('always', () => true);
    registry.registerContentTemplate(
      'customTemplate',
      (_ctx, args) => `自定义提醒：${String(args?.name ?? '')}`
    );

    const result = applySystemReminders({
      llmMessages: [{ role: 'user', content: '继续' }],
      registry,
      ctx: {
        request,
        history: [],
        executorLocal: {
          stepCount: 1,
          systemReminderPolicy: {
            enabledRuleIds: [],
            extraRules: [
              {
                id: 'custom_rule',
                trigger: { kind: 'always' },
                contentTemplate: 'customTemplate',
                contentArgs: { name: 'memory' },
              },
            ],
          },
        },
      },
    });

    expect(JSON.stringify(result)).toContain('自定义提醒：memory');
  });
});
