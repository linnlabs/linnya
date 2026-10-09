import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { CompleteResearchResultSchema } from '@app/schemas';
import {
  createToolCallDecisionEvent, createToolOutputEvent, routeRuntimeEvent, RunIdSchema,
  type RuntimeEvent, type SerializableJsonRecord,
} from '@linnlabs/linnkit/contracts';
import { clearRendererPluginRegistryForTest, registerRendererPlugin } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolPresentationProjectionPort } from '@/app/plugins/orchestration/createToolPresentationProjectionPort';
import { registerToolPresentationProjectionPort } from '../../ports/toolPresentationProjectionPort';
import { commonToolConfigs } from '../../ui/tools/configs/common';
import { createInitialProjectionState, reduceEvent } from '../../services/messageProjection';
import { runtimeEventToFrontendProjectionEvent } from '../../services/messageProjection/__tests__/helpers/runtimeEventToFrontendProjectionEvent';
import { PROJECTION_TEST_SCOPE } from '../../services/messageProjection/__tests__/helpers/projectionTestScope';
import { mapUiMessageDtoToConversationMessage } from '../../message-window/functions/mapUiMessageDto';
import { readTail } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SqliteUiProjectionApplier } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteApplier';
import { projectResearchCompletionCompactStep } from './functions/projectResearchCompletion';

const toolName = 'complete_research';
const conversationId = 'research-completion';
const turnId = 'research-turn';
const runId = RunIdSchema.parse('research-main');
const args = { document: 'workspace:/research/revision.md' };
const result = CompleteResearchResultSchema.parse({
  data: {
    artifact: { stage: 'revision', subrun_id: 'revision-child', path: args.document,
      inode: 'revision-document', sha256: 'a'.repeat(64), citation_sha256: 'b'.repeat(64) },
    review_artifacts: ['source_review', 'argument_review'].map(stage => ({
      stage, subrun_id: `${stage}-child`, path: `workspace:/research/${stage}.md`,
      inode: `${stage}-document`, sha256: 'c'.repeat(64), citation_sha256: 'd'.repeat(64),
    })),
  },
  observation: 'The saved article and its original reviews are available.',
});

function route(event: RuntimeEvent): RuntimeEvent {
  return routeRuntimeEvent(event, { run_id: runId, lane: 'foreground', visibility: 'conversation' });
}
function decision(callId: string): RuntimeEvent {
  return route(createToolCallDecisionEvent(`decision-${callId}`, conversationId, turnId, toolName, callId, {
    timestamp: 1, payload: { args },
  }));
}
function success(callId: string, output: { data: SerializableJsonRecord; observation: string } = result): RuntimeEvent {
  return route(createToolOutputEvent(`output-${callId}`, conversationId, turnId, toolName, callId, {
    status: 'success', ...output,
  }, { timestamp: 3 }));
}
function state() {
  return createInitialProjectionState({
    id: conversationId, title: 'Research', titleOrigin: 'explicit', createdAt: 1, updatedAt: 1,
    selectedAgentId: null, messages: [],
  });
}
function projectLive(events: readonly RuntimeEvent[]) {
  const current = state();
  for (const event of events) {
    const input = runtimeEventToFrontendProjectionEvent(event, { ...PROJECTION_TEST_SCOPE, run_id: runId });
    if (input) expect(reduceEvent(current, input).success).toBe(true);
  }
  return current.conversation.messages.map(message => {
    if (message.type !== 'tool_calls') throw new Error('Expected a tool message');
    return message;
  });
}
function reload(events: readonly RuntimeEvent[]) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO conversations (conversation_id, created_at, last_event_at) VALUES (?, 1, 1)').run(conversationId);
  const projector = new SqliteUiProjectionApplier(db);
  try {
    events.forEach((event, index) => projector.projectAppendedEvent(conversationId, runId, event, index));
    const window = readTail(db, conversationId, 10);
    if (window.status !== 'ready') throw new Error('Expected durable window');
    return window.messages.map(message => {
      const projected = mapUiMessageDtoToConversationMessage(message);
      if (projected.type !== 'tool_calls') throw new Error('Expected a tool message');
      return projected;
    });
  } finally { db.close(); }
}

describe('research completion through live and durable admission', () => {
  let unregister: (() => void) | undefined;
  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: { id: 'completion-ui', name: 'Completion UI', version: '1', description: 'Completion fixture', developer: 'Linnya', builtin: true, required: true },
      toolCards: { [toolName]: commonToolConfigs[toolName] },
    });
    useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
    unregister = registerToolPresentationProjectionPort(createToolPresentationProjectionPort());
  });
  afterEach(() => { unregister?.(); clearRendererPluginRegistryForTest(); });

  it('keeps an unsuccessful delivery distinct from a later verified document handoff', () => {
    const failure = route(createToolOutputEvent('output-rejected', conversationId, turnId, toolName, 'rejected', {
      status: 'error', error: 'The source review input changed', observation: 'Read the changed document before proceeding.',
    }, { timestamp: 2 }));
    const events = [decision('rejected'), failure, decision('delivered'), success('delivered')];
    const live = projectLive(events);
    expect(reload(events).map(message => message.toolPresentation)).toEqual(live.map(message => message.toolPresentation));
    expect(live[0].toolPresentation?.data).toEqual({ kind: 'lifecycle' });
    expect(live[1].toolPresentation?.data).toEqual({
      kind: 'delivered', articlePath: args.document,
      reviewLinks: [
        { path: 'workspace:/research/source_review.md', label: {
          key: 'conversation.tool.researchComplete.sourceReview', fallback: '来源与数字复核',
        } },
        { path: 'workspace:/research/argument_review.md', label: {
          key: 'conversation.tool.researchComplete.argumentReview', fallback: '论证复核',
        } },
      ],
    });
    expect(projectResearchCompletionCompactStep({
      sourceToolName: toolName, uiKey: toolName, toolCallId: 'delivered', args, result, status: 'success', phase: 'complete',
    }).title).toEqual(live[1].toolPresentation?.title?.text);
  });

  it('rejects malformed delivery facts atomically in live, replay and compact presentation', () => {
    const malformed = { ...result, data: { ...result.data, quality_passed: true } };
    expect(() => reload([decision('invalid'), success('invalid', malformed)])).toThrow();
    const current = state();
    const start = runtimeEventToFrontendProjectionEvent(decision('invalid'), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    const end = runtimeEventToFrontendProjectionEvent(success('invalid', malformed), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    if (!start || !end) throw new Error('Expected tool events');
    expect(reduceEvent(current, start).success).toBe(true);
    const before = current.conversation.messages[0];
    expect(reduceEvent(current, end).success).toBe(false);
    expect(current.conversation.messages[0]).toEqual(before);
    expect(() => projectResearchCompletionCompactStep({
      sourceToolName: toolName, uiKey: toolName, toolCallId: 'invalid', args, result: malformed, status: 'success', phase: 'complete',
    })).toThrow();
  });
});
