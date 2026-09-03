import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  projectEventsWithMemoryApplier,
  type UiMessageRow,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { uiProjectionFixtures } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/__fixtures__/uiProjectionFixtures';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { BaseMessage, Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '..';
import { runtimeEventToFrontendProjectionEvent } from './helpers/runtimeEventToFrontendProjectionEvent';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';
import {
  ConversationHistorySummaryPayloadSchema,
  conversationMessageIdFromToolIdentity,
} from '@app/schemas';

interface EssentialMessage {
  readonly id: string;
  readonly role: BaseMessage['role'];
  readonly type: BaseMessage['type'];
  readonly content: string;
  readonly answerId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly status?: string;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly resultPresentation?: unknown;
  readonly interaction?: unknown;
  readonly agentWork?: unknown;
  readonly contextUsage?: unknown;
  readonly replacesMessageIds?: unknown;
  readonly userQuote?: unknown;
  readonly ui?: unknown;
  readonly activity?: unknown;
  readonly attachments?: BaseMessage['attachments'];
}

interface FrontendProjectionResult {
  readonly messages: readonly BaseMessage[];
  readonly surfaceErrors: ReadonlyArray<{
    readonly eventId: string;
    readonly error: string;
    readonly errorDetails: unknown;
  }>;
}

function createConversation(): Conversation {
  return {
    id: 'conv_ui_projection_fixture',
    title: 'projection parity',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function replayOnFrontend(events: readonly RuntimeEvent[]): FrontendProjectionResult {
  let state = createInitialProjectionState(createConversation());
  const surfaceErrors: Array<FrontendProjectionResult['surfaceErrors'][number]> = [];
  for (const event of events) {
    const projectionEvent = runtimeEventToFrontendProjectionEvent(event, {
      ...PROJECTION_TEST_SCOPE,
      run_id: event.run_id ?? PROJECTION_TEST_SCOPE.run_id,
    });
    if (!projectionEvent) {
      continue;
    }
    const result = reduceEvent(state, projectionEvent);
    if (result.error) {
      surfaceErrors.push({
        eventId: event.id,
        error: result.error,
        errorDetails: result.errorDetails,
      });
    }
    if (result.success && result.newState) {
      state = result.newState;
    }
  }
  return {
    messages: state.conversation.messages,
    surfaceErrors,
  };
}

function normalizeFrontendMessage(message: BaseMessage): EssentialMessage {
  const common = {
    id: message.id,
    role: message.role,
    type: message.type,
    content: message.content,
    attachments: message.attachments,
  };
  switch (message.type) {
    case 'user_input':
      return {
        ...common,
        agentWork: message.metadata?.agent_work,
        contextUsage: message.metadata?.context_usage,
        userQuote: message.metadata?.user_quote,
        activity: message.metadata?.activity,
      };
    case 'thought':
      return { ...common, activity: message.metadata.activity };
    case 'tool_calls':
      return {
        ...common,
        toolCallId: message.metadata.tool_call_id,
        toolName: message.metadata.tool_name,
        status: message.metadata.status,
        data: message.metadata.data,
        error: message.metadata.error,
        resultPresentation: message.metadata.presentation,
        interaction: message.metadata.interaction,
        activity: message.metadata.activity,
      };
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return {
        ...common,
        answerId: message.metadata.answer_id,
        activity: message.metadata.activity,
      };
    case 'history_summary':
      return {
        ...common,
        replacesMessageIds: ConversationHistorySummaryPayloadSchema.parse({
          summary: message.metadata.summary,
        }).summary.replacedMessageIds,
      };
    case 'summarization_progress':
      return common;
  }
}

function normalizeBackendRow(row: UiMessageRow): EssentialMessage {
  const common = {
    id: row.messageId,
    role: row.role,
    type: row.messageType,
    content: row.content ?? '',
    attachments: row.attachments ?? undefined,
  };
  switch (row.messageType) {
    case 'user_input':
      return {
        ...common,
        agentWork: row.payload?.agent_work,
        contextUsage: row.payload?.context_usage,
        userQuote: row.payload?.user_quote,
        activity: row.payload?.activity,
      };
    case 'thought':
      return { ...common, activity: row.payload.activity };
    case 'tool_calls':
      return {
        ...common,
        toolCallId: row.payload.tool_call_id,
        toolName: row.payload.tool_name,
        status: row.payload.status,
        data: row.payload.data,
        error: row.payload.error,
        resultPresentation: row.payload.presentation,
        interaction: row.payload.interaction,
        activity: row.payload.activity,
      };
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return { ...common, answerId: row.payload.answer_id, activity: row.payload.activity };
    case 'history_summary':
      return {
        ...common,
        replacesMessageIds: ConversationHistorySummaryPayloadSchema.parse(row.payload).summary.replacedMessageIds,
      };
  }
}

describe('frontend replay and backend UI read model projection parity', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  for (const fixture of uiProjectionFixtures) {
    it(`keeps essential timeline fields aligned: ${fixture.name}`, () => {
      const frontend = replayOnFrontend(fixture.events).messages.map(normalizeFrontendMessage);
      const backend = projectEventsWithMemoryApplier(fixture.events).rows.map(normalizeBackendRow);

      expect(backend).toEqual(expect.arrayContaining(frontend));
      expect(backend.map(message => message.type)).toEqual(frontend.map(message => message.type));
      expect(backend.map(message => message.role)).toEqual(frontend.map(message => message.role));
      expect(backend.map(message => message.content)).toEqual(frontend.map(message => message.content));
      expect(backend.map(message => message.id)).toEqual(frontend.map(message => message.id));
      expect(backend.map(message => message.answerId)).toEqual(frontend.map(message => message.answerId));
    });
  }

  it('keeps deliberate divergence explicit for summary hiding and subrun compaction', () => {
    const summaryBackend = projectEventsWithMemoryApplier(
      uiProjectionFixtures.find(fixture => fixture.name === 'summary-chain')?.events ?? [],
    );
    expect(summaryBackend.rows.find(row => row.messageId === 'evt_user_old')?.presentation).toBe('hidden');
    expect(summaryBackend.rows.find(row => row.messageId === 'answer_old')?.presentation).toBe('hidden');

    const subrunBackend = projectEventsWithMemoryApplier(
      uiProjectionFixtures.find(fixture => fixture.name === 'subrun-summary-attaches-to-parent-tool')?.events ?? [],
    );
    const subrunTool = subrunBackend.rows.find(row => (
      row.mergeKey === conversationMessageIdFromToolIdentity('run_subrun', 'call_deep')
    ));
    if (subrunTool?.messageType !== 'tool_calls') throw new Error('Missing backend subrun parent tool');
    expect(subrunTool.payload.subrun_summary).toEqual({
      subrun_ids: ['subrun_b', 'subrun_a', 'subrun_c'],
      // durable 工具事实只保留 subrun 身份；历史 trace 项由独立紧凑 read model 合并。
      event_counts: { subrun_b: 0, subrun_a: 0, subrun_c: 0 },
    });

    const subrunFrontend = replayOnFrontend(
      uiProjectionFixtures.find(fixture => fixture.name === 'subrun-summary-attaches-to-parent-tool')?.events ?? [],
    ).messages;
    const frontendTool = subrunFrontend.find(
      message => message.type === 'tool_calls' && message.metadata.tool_call_id === 'call_deep',
    );
    expect(frontendTool?.type).toBe('tool_calls');
    if (frontendTool?.type !== 'tool_calls') throw new Error('Missing projected subrun parent tool');
    expect(frontendTool.metadata.subrunTrace).toBeDefined();
    expect(frontendTool.metadata.subrun_summary).toEqual({
      subrun_ids: ['subrun_b', 'subrun_a', 'subrun_c'],
      event_counts: { subrun_b: 0, subrun_a: 2, subrun_c: 0 },
    });
  });

  it('projects wait-user onto its tool entity and keeps run errors out of the timeline', () => {
    const fixture = uiProjectionFixtures.find(
      item => item.name === 'interactive-tool-wait-and-run-error',
    );
    if (!fixture) {
      throw new Error('Missing interactive-tool-wait-and-run-error fixture');
    }

    const frontend = replayOnFrontend(fixture.events);
    const backend = projectEventsWithMemoryApplier(fixture.events);

    expect(frontend.messages.map(message => message.type)).toEqual(['tool_calls']);
    expect(backend.rows.map(row => row.messageType)).toEqual(['tool_calls']);
    expect(normalizeBackendRow(backend.rows[0]!)).toMatchObject({
      interaction: normalizeFrontendMessage(frontend.messages[0]!).interaction,
    });
    expect(backend.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'evt_error_interactive',
        reason: 'error-event-is-surface-state-not-timeline-row',
      }),
    ]));
    expect(frontend.surfaceErrors).toEqual([
      expect.objectContaining({
        eventId: 'evt_error_interactive',
        errorDetails: expect.objectContaining({
          errorCode: 'llm.request_failed',
          retryable: true,
        }),
      }),
    ]);
  });
});
