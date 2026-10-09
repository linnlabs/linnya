import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { SubmitResearchDocumentResultSchema } from '@app/schemas';
import {
  createSubRunTraceEvent, createToolCallDecisionEvent, createToolOutputEvent,
  routeRuntimeEvent, RunIdSchema, ToolCallIdSchema, runtimeEventToSSEEvent,
  type RuntimeEvent, type SSESubRunTraceEvent, type SerializableJsonRecord,
} from '@linnlabs/linnkit/contracts';
import { clearRendererPluginRegistryForTest, registerRendererPlugin } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolPresentationProjectionPort } from '@/app/plugins/orchestration/createToolPresentationProjectionPort';
import { createToolCompactStepProjectionPort } from '@/app/plugins/orchestration/createToolCompactStepProjectionPort';
import { registerToolPresentationProjectionPort } from '../../ports/toolPresentationProjectionPort';
import { registerToolCompactStepProjectionPort } from '../../ports/toolCompactStepProjectionPort';
import { commonToolConfigs } from '../../ui/tools/configs/common';
import { createInitialProjectionState, reduceEvent } from '../../services/messageProjection';
import { runtimeEventToFrontendProjectionEvent } from '../../services/messageProjection/__tests__/helpers/runtimeEventToFrontendProjectionEvent';
import { PROJECTION_TEST_SCOPE } from '../../services/messageProjection/__tests__/helpers/projectionTestScope';
import { mapUiMessageDtoToConversationMessage } from '../../message-window/functions/mapUiMessageDto';
import { createAppendOnlySubrunStepProjector } from '../subrun-trace/functions/createAppendOnlySubrunStepProjector';
import { readTail } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SqliteUiProjectionApplier } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteApplier';
import { projectResearchDocumentSubmission } from './functions/projectResearchDocumentSubmission';

const toolName = 'submit_research_document';
const conversationId = 'research-submission';
const turnId = 'research-turn';
const runId = RunIdSchema.parse('research-child');
const args = { content: '# Article\nThe body belongs only in the Workspace document.' };
const result = SubmitResearchDocumentResultSchema.parse({
  data: { stage: 'revision', subrun_id: runId, path: 'workspace:/research/revision.md',
    inode: 'revision-document', sha256: 'a'.repeat(64), citation_sha256: 'b'.repeat(64) },
  observation: 'Open the saved stage document.',
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
function failure(callId: string): RuntimeEvent {
  return route(createToolOutputEvent(`output-${callId}`, conversationId, turnId, toolName, callId, {
    status: 'error', observation: 'Correct the invalid citation and submit again.',
    error: 'Invalid citation token', error_code: 'CITATION_INVALID',
  }, { timestamp: 2 }));
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
function trace(callId: string, kind: SSESubRunTraceEvent['kind'], fields: Partial<SSESubRunTraceEvent>): SSESubRunTraceEvent {
  const input = createSubRunTraceEvent(`trace-${callId}-${kind}`, conversationId, turnId, 'parent-research', runId, kind, {
    source_event_id: `source-${callId}-${kind}`, tool_name: toolName, tool_call_id: ToolCallIdSchema.parse(callId),
    timestamp: 1, ...fields,
  });
  const event = runtimeEventToSSEEvent(input);
  if (event?.type !== 'subrun_trace') throw new Error('Expected child trace');
  return event;
}

describe('research stage submission presentation', () => {
  let unregisterFull: (() => void) | undefined;
  let unregisterCompact: (() => void) | undefined;
  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: { id: 'submission-ui', name: 'Submission UI', version: '1', description: 'Submission UI fixture', developer: 'Linnya', builtin: true, required: true },
      toolCards: { [toolName]: commonToolConfigs[toolName] },
    });
    useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
    unregisterFull = registerToolPresentationProjectionPort(createToolPresentationProjectionPort());
    unregisterCompact = registerToolCompactStepProjectionPort(createToolCompactStepProjectionPort());
  });
  afterEach(() => { unregisterFull?.(); unregisterCompact?.(); clearRendererPluginRegistryForTest(); });

  it('preserves a failed submission and its corrected successor in live and durable history', () => {
    const events = [decision('rejected'), failure('rejected'), decision('corrected'), success('corrected')];
    const live = projectLive(events);
    expect(reload(events).map(message => message.toolPresentation)).toEqual(live.map(message => message.toolPresentation));
    expect(live.map(message => message.toolPresentation?.title?.text.key)).toEqual([
      'conversation.tool.researchSubmit.failed', 'conversation.tool.researchSubmit.saved',
    ]);
    expect(live[0].toolPresentation?.data).toEqual({ kind: 'lifecycle' });
    expect(live[1].toolPresentation?.data).toEqual({ kind: 'saved', artifactPath: result.data.path });
    expect(JSON.stringify(live.map(message => message.toolPresentation))).not.toContain(args.content);
  });

  it('keeps loading/error readable without assuming successful args or a saved artifact', () => {
    for (const lifecycle of [{ status: 'loading', phase: 'start' }, { status: 'error', phase: 'error' }] as const) {
      const projected = projectResearchDocumentSubmission({ sourceToolName: toolName, uiKey: toolName, args: {}, result: {}, ...lifecycle });
      expect(projected.data).toEqual({ kind: 'lifecycle' });
      expect(projected.hideContent).toBe(true);
    }
  });

  it('rejects a malformed saved result at live and reload admission without publishing a partial card', () => {
    const malformed = { ...result, data: { ...result.data, quality_passed: true } };
    expect(() => reload([decision('bad-result'), success('bad-result', malformed)])).toThrow();
    const current = state();
    const start = runtimeEventToFrontendProjectionEvent(decision('bad-result'), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    const end = runtimeEventToFrontendProjectionEvent(success('bad-result', malformed), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    if (!start || !end) throw new Error('Expected tool events');
    expect(reduceEvent(current, start).success).toBe(true);
    const before = current.conversation.messages[0];
    expect(reduceEvent(current, end).success).toBe(false);
    expect(current.conversation.messages[0]).toEqual(before);
  });

  it('admits retry attempts as normal compact child steps and rejects invalid success atomically', () => {
    const projector = createAppendOnlySubrunStepProjector();
    projector.admit([
      { index: 0, event: trace('rejected', 'tool_process', { status: 'loading', phase: 'start', args: {} }) },
      { index: 1, event: trace('rejected', 'tool_output', { status: 'error', output: { error: 'Invalid citation token' } }) },
      { index: 2, event: trace('corrected', 'tool_process', { status: 'loading', phase: 'start', args }) },
    ]);
    expect(projector.projection.steps.map(step => step.title.key)).toEqual([
      'conversation.tool.researchSubmit.failed', 'conversation.tool.researchSubmit.pending',
    ]);
    projector.admit([{ index: 3, event: trace('corrected', 'tool_output', { status: 'success', output: result }) }]);
    expect(projector.projection.steps.map(step => ({ id: step.toolCallId, status: step.status, title: step.title.key }))).toEqual([
      { id: 'rejected', status: 'error', title: 'conversation.tool.researchSubmit.failed' },
      { id: 'corrected', status: 'success', title: 'conversation.tool.researchSubmit.saved' },
    ]);
    const before = projector.projection;
    expect(() => projector.admit([
      { index: 4, event: trace('invalid', 'tool_process', { status: 'loading', phase: 'start', args }) },
      { index: 5, event: trace('invalid', 'tool_output', { status: 'success', output: { ...result, data: { ...result.data, content: 'Unexpected body' } } }) },
    ])).toThrow();
    expect(projector.projection).toEqual(before);
  });
});
