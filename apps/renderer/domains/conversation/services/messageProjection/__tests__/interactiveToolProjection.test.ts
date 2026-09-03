import { describe, expect, it } from 'vitest';
import { createInitialProjectionState, reduceEvent } from '../index';
import type { BaseMessage, Conversation, ToolCallMessage } from '../../../types';
import {
  createSSERequiresUserInteractionEvent,
  createSSEToolCallDecisionEvent,
  createSSEToolOutputEvent,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

function createConversation(): Conversation {
  return {
    id: 'conv_interactive_projection',
    title: 'interactive projection',
    titleOrigin: 'explicit',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    selectedAgentId: null,
  };
}

function readToolMessage(messages: BaseMessage[], toolCallId: string): ToolCallMessage | undefined {
  return messages.find(
    (message): message is ToolCallMessage =>
      message.type === 'tool_calls' && message.metadata.tool_call_id === toolCallId
  );
}

describe('interactive tool projection', () => {
  it('交互回复应保留单消息协议，只更新 interaction 而不依赖首条 tool_output', () => {
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt_decision_ppt',
      'conv_interactive_projection',
      'turn_interactive_projection',
      'ppt_plan',
      'call_ppt_plan_1',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: {
          title: 'Deck Plan',
        },
        payload: {
          args: {
            title: 'Deck Plan',
          },
        },
      }
    );

    const approvalResponse = {
      action: 'approve',
    };
    const waitForUser = createSSERequiresUserInteractionEvent(
      'evt_wait_ppt',
      'conv_interactive_projection',
      'turn_interactive_projection',
      {
        ...PROJECTION_TEST_SCOPE,
        interaction_id: 'interaction_ppt',
        run_id: PROJECTION_TEST_SCOPE.run_id,
        tool_call_id: ToolCallIdSchema.parse('call_ppt_plan_1'),
        checkpoint_revision: 2,
        resume_token: 'resume_ppt',
        interaction_status: 'pending',
        form: {
          data: { planId: 'plan_1' },
          observation: '等待用户审批',
        },
      }
    );

    const responseOutput = createSSEToolOutputEvent(
      'evt_output_ppt_response',
      'conv_interactive_projection',
      'turn_interactive_projection',
      'ppt_plan',
      'call_ppt_plan_1',
      { status: 'success', observation: JSON.stringify(approvalResponse), data: approvalResponse },
      {
        ...PROJECTION_TEST_SCOPE,
        metadata: {
          interaction: {
            status: 'approved',
            submittedAt: 123,
            response: approvalResponse,
          },
        },
      }
    );

    expect(reduceEvent(state, decision).success).toBe(true);
    expect(reduceEvent(state, waitForUser).success).toBe(true);

    const waitingMessage = readToolMessage(state.conversation.messages, 'call_ppt_plan_1');
    expect(waitingMessage?.metadata).toMatchObject({
      data: { planId: 'plan_1' },
      interaction: {
        status: 'active',
        interactionId: 'interaction_ppt',
        runId: PROJECTION_TEST_SCOPE.run_id,
        checkpointRevision: 2,
        resumeToken: 'resume_ppt',
      },
    });

    expect(reduceEvent(state, responseOutput).success).toBe(true);

    const message = readToolMessage(state.conversation.messages, 'call_ppt_plan_1');
    expect(message).toBeDefined();
    expect(message?.metadata.args).toEqual({
      title: 'Deck Plan',
    });
    expect(message?.metadata.data).toEqual({ planId: 'plan_1' });
    expect(message?.content).toBe('等待用户审批');
    expect(message?.metadata.interaction).toEqual({
      status: 'approved',
      submittedAt: 123,
      response: approvalResponse,
    });
  });
});
