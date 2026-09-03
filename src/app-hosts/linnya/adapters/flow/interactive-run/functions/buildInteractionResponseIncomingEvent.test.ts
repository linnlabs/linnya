import { describe, expect, it } from 'vitest';
import type { ConversationInteractionResponseRequest } from '@app/schemas';
import { buildInteractionResponseIncomingEvent } from './buildInteractionResponseIncomingEvent';

function response(
  overrides: Partial<ConversationInteractionResponseRequest> = {},
): ConversationInteractionResponseRequest {
  return {
    conversation_id: 'conversation-1',
    run_id: 'run-1',
    interaction_id: 'interaction-1',
    resume_token: 'resume-1',
    checkpoint_revision: 2,
    tool_call_id: 'call-ppt-plan-1',
    tool_name: 'ppt_plan',
    observation: '{"action":"approve"}',
    data: { action: 'approve' },
    interaction_status: 'approved',
    interaction_submitted_at: 123,
    interaction_response: { action: 'approve' },
    ...overrides,
  };
}

describe('buildInteractionResponseIncomingEvent', () => {
  it('把批准事实投影成已满足等待条件的明确语义，同时保留结构化结果', () => {
    const event = buildInteractionResponseIncomingEvent({
      response: response(),
      turnId: 'turn-1',
      eventId: 'event-1',
      timestamp: 456,
    });

    expect(event).toMatchObject({
      type: 'tool_output',
      tool_call_id: 'call-ppt-plan-1',
      tool_name: 'ppt_plan',
      status: 'success',
      data: { action: 'approve' },
      metadata: {
        interaction: {
          status: 'approved',
          submittedAt: 123,
          response: { action: 'approve' },
        },
      },
    });
    expect(event.observation).toContain('用户已批准本次 ppt_plan 交互');
    expect(event.observation).toContain('等待的用户确认已经完成');
    expect(event.observation).toContain('不要再次请求同一项确认');
    expect(event.observation).not.toBe('{"action":"approve"}');
  });

  it.each(['submitted', 'modified', 'skipped'] as const)(
    '保留 %s 响应中由交互工具组织的领域 observation',
    interactionStatus => {
      const observation = `工具 owner 生成的 ${interactionStatus} 内容`;
      const event = buildInteractionResponseIncomingEvent({
        response: response({
          interaction_status: interactionStatus,
          observation,
        }),
        turnId: 'turn-1',
        eventId: 'event-1',
        timestamp: 456,
      });

      expect(event.observation).toBe(observation);
    },
  );
});
