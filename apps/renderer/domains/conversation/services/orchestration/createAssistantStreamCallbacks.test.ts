import { describe, expect, it, vi } from 'vitest';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import {
  createSSETransportEndEvent,
  RunIdSchema,
  type SSEContextUsageSnapshotEvent,
} from 'linnkit/contracts';
import { createAssistantStreamCallbacks } from './createAssistantStreamCallbacks';

describe('createAssistantStreamCallbacks', () => {
  it('将提交确认直接交给调用方，不送入 RuntimeEvent 投影路由', async () => {
    const routeEvent = vi.fn(async () => true);
    const onUserInputCommitted = vi.fn();
    const callbacks = createAssistantStreamCallbacks({
      callbacks: { onUserInputCommitted },
      routeEvent,
      projectsConversationEvents: true,
      signal: new AbortController().signal,
      resolveExecutionFailureMessage: () => 'failed',
    });
    const event: ConversationUserInputCommittedEvent = {
      id: 'message-1',
      type: 'user_input_committed',
      timestamp: 10,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      operation: 'append',
      content: '',
      raw_content: '',
      attachments: [{
        id: 'attachment-1',
        kind: 'image',
        assetId: 'asset-1',
        mediaType: 'image/png',
        byteLength: 4,
        width: 2,
        height: 2,
        sha256: 'a'.repeat(64),
      }],
    };

    await callbacks.onUserInputCommitted?.(event);

    expect(onUserInputCommitted).toHaveBeenCalledOnce();
    expect(onUserInputCommitted).toHaveBeenCalledWith(event);
    expect(routeEvent).not.toHaveBeenCalled();
  });

  it('auxiliary transport_end 即使不进入会话投影，也必须收尾当前请求', async () => {
    const routeEvent = vi.fn(async () => false);
    const onTransportEnd = vi.fn();
    const callbacks = createAssistantStreamCallbacks({
      callbacks: { onTransportEnd },
      routeEvent,
      projectsConversationEvents: true,
      signal: new AbortController().signal,
      resolveExecutionFailureMessage: () => 'failed',
    });
    const event = createSSETransportEndEvent(
      'transport-end-auxiliary',
      'conversation-1',
      'turn-1',
      {
        execution_id: 'execution-auxiliary',
        lane: 'auxiliary',
        visibility: 'none',
        reason: 'complete',
      },
    );

    await callbacks.onTransportEnd?.(event);

    expect(routeEvent).toHaveBeenCalledWith(event);
    expect(onTransportEnd).toHaveBeenCalledWith(event);
  });

  it('将运行中的上下文占用快照交给请求级投影路由', async () => {
    const routeEvent = vi.fn(async () => true);
    const callbacks = createAssistantStreamCallbacks({
      callbacks: {},
      routeEvent,
      projectsConversationEvents: true,
      signal: new AbortController().signal,
      resolveExecutionFailureMessage: () => 'failed',
    });
    const event: SSEContextUsageSnapshotEvent = {
      type: 'context_usage_snapshot',
      id: 'context-usage-1',
      timestamp: 11,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      run_id: RunIdSchema.parse('run-1'),
      execution_id: 'execution-1',
      user_message_id: 'message-1',
      context_usage: {
        basis: 'last_completed_llm_prompt',
        budget_model_id: 'primary-model',
        used_tokens: 900,
        components: {
          system_prompt_tokens: 200,
          conversation_tokens: 600,
          tool_definition_tokens: 100,
        },
        component_attribution: 'normalized_local_estimate',
        input_budget_tokens: 1_000,
        remaining_tokens: 100,
        output_limit_tokens: 200,
        source: 'test-fixture',
        confidence: 'estimate',
        measured_at: 10,
      },
    };

    await callbacks.onContextUsageSnapshot?.(event);

    expect(routeEvent).toHaveBeenCalledOnce();
    expect(routeEvent).toHaveBeenCalledWith(event);
  });
});
