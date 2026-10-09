import { describe, expect, it, vi } from 'vitest';
import { createFinalAnswerEvent, createUserInputEvent } from '@linnlabs/linnkit/contracts';

vi.mock('src/app-hosts/linnya/agent-registry/agentDefinitionResolver', () => ({
  findRegisteredAgentDefinitionByPromptKey: vi.fn(() => undefined),
}));

import type { ConversationNextRequest } from './flow.schemas';
import { HistoryHandlerService, type FlowHistoryAccessPort } from './flow.history-handler.service';
import { FlowRunPreparationService } from './flow.run-preparation.service';
import { FlowIncomingEventPreparer } from './incoming-events/orchestration/prepareFlowIncomingEventBatch';
import * as hostEntry from '../../agent-registry/resolveAgentHostEntry';

describe('FlowRunPreparationService history isolation', () => {
  it.each(['normal', 'isolated', 'replace'] as const)(
    'Host 入口冻结 %s 处理后的历史，持久化后不重新接纳',
    async mode => {
      const previous = createUserInputEvent(
        'previous',
        'conversation',
        'old-turn',
        'Earlier source constraints'
      );
      const replaced = createUserInputEvent(
        'replaced',
        'conversation',
        'old-turn',
        'Discard after replacement'
      );
      const history = [previous, replaced];
      const port: FlowHistoryAccessPort = {
        truncateFromEvent: vi.fn(),
        readForegroundFrom: vi.fn(async () => ({ events: history, revision: history.length })),
      };
      const entry = vi.spyOn(hostEntry, 'resolveAgentHostEntry').mockReturnValue({
        tool_name: 'research_run',
        args: { question: 'Frozen question' },
        completion_mode: 'yield_after_batch',
      });
      try {
        const service = new FlowRunPreparationService(
          new HistoryHandlerService(port),
          new FlowIncomingEventPreparer({ kind: 'disabled' })
        );
        const req: ConversationNextRequest = {
          conversation_id: 'conversation',
          new_events: [
            {
              id: 'current-user',
              type: 'user_input',
              content: 'Current question',
              source: 'user',
              timestamp: 3,
            },
          ],
          options: {
            promptKey: 'research_v1',
            ...(mode === 'isolated' ? { history_mode: 'isolated' as const } : {}),
            ...(mode === 'replace' ? { truncateFromMessageId: replaced.id } : {}),
          },
        };
        const result = await service.prepareForRun(req, 'conversation', 'new-turn', true);
        if (result.kind !== 'execute') throw new Error('Expected execution');
        expect(entry.mock.calls[0]?.[2]).toEqual(
          mode === 'isolated' ? [] : mode === 'replace' ? [previous] : history
        );
        const frozenRequest = { ...req, options: result.prepared.effectiveOptions };
        const resumed = await service.prepareExecutionAfterPersistence(
          frozenRequest,
          'conversation',
          result.prepared.incomingBatch
        );
        expect(entry).toHaveBeenCalledTimes(1);
        expect(resumed.effectiveOptions?.host_tool_call).toEqual(
          result.prepared.effectiveOptions?.host_tool_call
        );
      } finally {
        entry.mockRestore();
      }
    }
  );
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
      new FlowIncomingEventPreparer({ kind: 'disabled' })
    );
    const request: ConversationNextRequest = {
      conversation_id: conversationId,
      new_events: [
        {
          type: 'user_input',
          id: 'new-user',
          timestamp: 3,
          content: '新问题',
          source: 'user',
        },
      ],
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
