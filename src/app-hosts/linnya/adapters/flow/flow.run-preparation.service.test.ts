import { describe, expect, it, vi } from 'vitest';
import { createFinalAnswerEvent, createUserInputEvent } from '@linnlabs/linnkit/contracts';

vi.mock('src/app-hosts/linnya/agent-registry/agentDefinitionResolver', () => ({
  findRegisteredAgentDefinitionByPromptKey: vi.fn(() => undefined),
}));

import type { ConversationNextRequest } from './flow.schemas';
import {
  HistoryHandlerService,
  type FlowHistoryAccessPort,
} from './flow.history-handler.service';
import { FlowRunPreparationService } from './flow.run-preparation.service';
import { FlowIncomingEventPreparer } from './incoming-events/orchestration/prepareFlowIncomingEventBatch';

describe('FlowRunPreparationService history isolation', () => {
  it('不把已有历史交给 Agent，同时保持持久化配置不变', async () => {
    const conversationId = 'conversation-history-isolated';
    const historicalEvents = [
      createUserInputEvent('old-user', conversationId, 'old-turn', '旧问题'),
      createFinalAnswerEvent('old-answer', conversationId, 'old-turn', '旧回答', {
        completion_reason: 'terminal',
      }),
    ];
    const historyAccessPort: FlowHistoryAccessPort = {
      truncateFromEvent: vi.fn(async () => ({
        found: false,
        deletedEventCount: 0,
        deletedRunCount: 0,
      })),
      readForegroundFrom: vi.fn(async () => ({
        events: historicalEvents,
        revision: historicalEvents.length,
      })),
    };
    const service = new FlowRunPreparationService(
      new HistoryHandlerService(historyAccessPort),
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
    );
    const request: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [{
        type: 'user_input',
        id: 'new-user',
        timestamp: 3,
        content: '新问题',
        source: 'user',
      }],
      options: {
        promptKey: 'default',
        persist: true,
        history_mode: 'isolated',
      },
    };

    const result = await service.prepareForRun(request, conversationId, 'new-turn', true);

    if (result.kind !== 'execute') {
      throw new Error('expected history-isolated request to execute');
    }
    expect(result.prepared.contextHistoryEvents).toEqual([]);
    expect(result.prepared.effectiveOptions).toMatchObject({
      persist: true,
      history_mode: 'isolated',
      conversationHistory: [],
    });
    expect(result.prepared.agentInvokeReq.conversationHistory).toEqual([]);
  });
});
