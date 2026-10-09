import { describe, expect, it, vi } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import { createFinalAnswerEvent, createUserInputEvent } from '@linnlabs/linnkit/contracts';

vi.mock('src/app-hosts/linnya/agent-registry/agentDefinitionResolver', () => ({
  findRegisteredAgentDefinitionByPromptKey: vi.fn(() => undefined),
}));

import type { ConversationNextRequest } from './flow.schemas';
import { HistoryHandlerService, type FlowHistoryAccessPort } from './flow.history-handler.service';
import { FlowRunPreparationService } from './flow.run-preparation.service';
import { FlowIncomingEventPreparer } from './incoming-events/orchestration/prepareFlowIncomingEventBatch';
import * as hostEntry from '../../agent-registry/resolveAgentHostEntry';
import * as requestAdmission from '../../agent-registry/resolveAgentRequestAdmission';
import * as definitions from '../../agent-registry/agentDefinitionResolver';
import { admitResearchRequest } from '../../agent-registry/agents/research_v1/admission';
import { AgentInvokeRequestSchema } from '../../context/agent/schemas';

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
        const resumed = await service.prepareExecutionAfterPersistence(
          'conversation',
          result.prepared
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

describe('Flow Agent request admission', () => {
  const scope = ResearchRunArgsSchema.parse({
    question: 'Focus',
    reader: 'Reader',
    task_type: 'fixed' as const,
    materials: ['workspace:/source.md'],
    time_range: '2026',
  });
  const req: ConversationNextRequest = {
    conversation_id: 'conversation',
    new_events: [
      {
        id: 'current-user',
        type: 'user_input',
        content: 'Original constraints',
        source: 'user',
        timestamp: 3,
      },
    ],
    options: {
      promptKey: 'research_v1',
      project_metadata: { id: 'project' },
      research_scope: scope,
    },
  };
  function service() {
    return new FlowRunPreparationService(
      new HistoryHandlerService({
        truncateFromEvent: vi.fn(),
        readForegroundFrom: vi.fn(async () => ({ events: [], revision: 0 })),
      }),
      new FlowIncomingEventPreparer({ kind: 'disabled' })
    );
  }
  it('scope 经过 wire、请求构建、首次接纳及 descriptor schema 保留；持久化刷新不再接纳', async () => {
    const admission = vi
      .spyOn(requestAdmission, 'resolveAgentRequestAdmission')
      .mockImplementation(admitResearchRequest);
    try {
      const preparation = service();
      const result = await preparation.prepareForRun(req, 'conversation', 'turn', true);
      if (result.kind !== 'execute') throw new Error('Expected execution');
      expect(result.prepared.effectiveOptions?.host_tool_call).toBeUndefined();
      expect(result.prepared.agentInvokeReq.query).toContain('Original constraints');
      expect(AgentInvokeRequestSchema.parse(result.prepared.agentInvokeReq).researchScope).toEqual(
        scope
      );
      const refreshed = await preparation.prepareExecutionAfterPersistence(
        'conversation',
        result.prepared
      );
      expect(refreshed.agentInvokeReq).toBe(result.prepared.agentInvokeReq);
      expect(admission).toHaveBeenCalledOnce();
    } finally {
      admission.mockRestore();
    }
  });
  it('registry 拒绝新 Host 强制研究工具，恢复准备不重跑研究校验或替换身份', async () => {
    const definition = vi
      .spyOn(definitions, 'findRegisteredAgentDefinitionByPromptKey')
      .mockReturnValue({
        id: 'research_v1',
        promptKey: 'research_v1',
        defaultMode: 'agent',
        description: 'Research',
        requestAdmission: admitResearchRequest,
      });
    try {
      const legacy: ConversationNextRequest = {
        ...req,
        options: {
          promptKey: 'research_v1',
          host_tool_call: {
            tool_name: 'research_run',
            args: scope,
            completion_mode: 'yield_after_batch',
          },
        },
      };
      const preparation = service();
      await expect(
        preparation.prepareForRun(legacy, 'conversation', 'turn', true)
      ).rejects.toMatchObject({ code: 'RESEARCH_HOST_ENTRY_NOT_SUPPORTED' });
      const resumed = await preparation.prepareForRun(
        legacy,
        'conversation',
        'turn',
        true,
        'resume'
      );
      if (resumed.kind !== 'execute') throw new Error('Expected execution');
      expect(resumed.prepared.agentInvokeReq.promptKey).toBe('research_v1');
      expect(resumed.prepared.effectiveOptions?.host_tool_call).toEqual(
        legacy.options?.host_tool_call
      );
      expect(resumed.prepared.agentInvokeReq.researchScope).toBeUndefined();
    } finally {
      definition.mockRestore();
    }
  });
});
