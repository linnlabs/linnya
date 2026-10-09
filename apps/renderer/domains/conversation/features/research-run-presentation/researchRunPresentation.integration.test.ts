import Database from 'better-sqlite3';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ResearchRunStructuredResultSchema,
  type ResearchStage,
} from '@app/schemas';
import {
  createSubRunTraceEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
  type RuntimeEvent,
  type SerializableJsonRecord,
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
import { SqliteSubrunTraceHistoryProjector } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import type { ToolCallMessage } from '../../types';
import { projectResearchRunCompactStep, projectResearchRunPresentation } from './functions/projectResearchRunPresentation';

const conversationId = 'research-presentation';
const turnId = 'research-turn';
const callId = 'research-parent-call';
const runId = RunIdSchema.parse('research-parent-run');
const args = { question: 'What explains the supplied change?', reader: 'General reader', task_type: 'fixed', materials: ['workspace:/input.md'] };
const stages: readonly ResearchStage[] = ['investigation', 'investigation_review', 'draft', 'argument_review', 'source_review', 'revision'];

function output() {
  return ResearchRunStructuredResultSchema.parse({
    data: {
      status: 'delivered', model_id: 'chosen-model',
      subrun_ids: stages.map((_, index) => `explicit-child-${index}`),
      artifacts: stages.map((stage, index) => ({
        stage, subrun_id: `explicit-child-${index}`, path: `workspace:/research/${stage}.md`,
        inode: `workspace:document-${index}`, sha256: 'a'.repeat(64), citation_sha256: 'b'.repeat(64),
      })),
    },
    observation: 'Research documents saved.',
  });
}

function route(event: RuntimeEvent): RuntimeEvent {
  return routeRuntimeEvent(event, { run_id: runId, lane: 'foreground', visibility: 'conversation' });
}

function decision(): RuntimeEvent {
  return route(createToolCallDecisionEvent('research-decision', conversationId, turnId, 'research_run', callId, {
    timestamp: 1, payload: { args },
  }));
}

function trace(subrunId: string, index: number): RuntimeEvent {
  return route(createSubRunTraceEvent(`trace-${index}`, conversationId, turnId, callId, subrunId, 'tool_output', {
    source_event_id: `child-source-${index}`, timestamp: index + 2,
    tool_name: 'skill', tool_call_id: ToolCallIdSchema.parse(`child-tool-${index}`), status: 'success',
    output: {
      data: { skill_name: 'deep-research', source: 'builtin', activated: true, resource_count: 3 },
      observation: 'Loaded research method.',
    },
  }));
}

function terminal(result: { data: SerializableJsonRecord; observation: string }): RuntimeEvent {
  return route(createToolOutputEvent('research-output', conversationId, turnId, 'research_run', callId, {
    status: 'success', ...result,
  }, { timestamp: 20 }));
}

function live(events: readonly RuntimeEvent[]): ToolCallMessage {
  const state = createInitialProjectionState({
    id: conversationId, title: 'Research', titleOrigin: 'explicit', createdAt: 1, updatedAt: 1,
    selectedAgentId: null, messages: [],
  });
  for (const event of events) {
    const projected = runtimeEventToFrontendProjectionEvent(event, { ...PROJECTION_TEST_SCOPE, run_id: runId });
    if (projected) expect(reduceEvent(state, projected).success).toBe(true);
  }
  const message = state.conversation.messages[0];
  if (message?.type !== 'tool_calls') throw new Error('Expected a research parent tool message');
  return message;
}

function reloaded(events: readonly RuntimeEvent[]): ToolCallMessage {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO conversations (conversation_id, created_at, last_event_at) VALUES (?, 1, 1)').run(conversationId);
  const parentProjection = new SqliteUiProjectionApplier(db);
  const traceProjection = new SqliteSubrunTraceHistoryProjector(db);
  try {
    events.forEach((event, index) => {
      if (event.type === 'subrun_trace') traceProjection.project(event);
      else parentProjection.projectAppendedEvent(conversationId, runId, event, index);
    });
    const window = readTail(db, conversationId, 10);
    if (window.status !== 'ready' || !window.messages[0]) throw new Error('Expected a durable parent tool row');
    const message = mapUiMessageDtoToConversationMessage(window.messages[0]);
    if (message.type !== 'tool_calls') throw new Error('Expected a reloaded research parent tool message');
    return message;
  } finally {
    db.close();
  }
}

describe('research run live and reload presentation', () => {
  let unregister: (() => void) | undefined;
  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: { id: 'research-ui-fixture', name: 'Research UI', version: '1', description: 'Research UI fixture', developer: 'Linnya', builtin: true, required: true },
      toolCards: { research_run: commonToolConfigs.research_run },
    });
    useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
    unregister = registerToolPresentationProjectionPort(createToolPresentationProjectionPort());
  });
  afterEach(() => {
    unregister?.();
    clearRendererPluginRegistryForTest();
  });

  it('shows only actually started children while running and preserves arrival identity after reload', () => {
    const events = [decision(), trace('child-source-review', 1), trace('child-argument-review', 2)];
    const current = live(events);
    expect(reloaded(events).toolPresentation).toEqual(current.toolPresentation);
    expect(current.toolPresentation?.data).toMatchObject({
      kind: 'lifecycle',
      items: [
        { subrunId: 'child-source-review', label: { key: 'conversation.tool.researchRun.process' } },
        { subrunId: 'child-argument-review', label: { key: 'conversation.tool.researchRun.process' } },
      ],
    });
  });

  it('adopts saved artifact identities, labels and order without claiming the article passed', () => {
    const result = output();
    const events = [decision(), trace('explicit-child-4', 1), trace('explicit-child-3', 2), terminal(result)];
    const current = live(events);
    expect(reloaded(events).toolPresentation).toEqual(current.toolPresentation);
    const expected = projectResearchRunPresentation({
      sourceToolName: 'research_run', uiKey: 'research_run', args, result,
      status: 'success', phase: 'complete',
    });
    expect(current.toolPresentation).toMatchObject(expected);
    expect(expected.data.items.map(item => item.subrunId)).toEqual(result.data.artifacts.map(item => item.subrun_id));
    expect(expected.data.items[5]).toMatchObject({
      label: { key: 'conversation.tool.researchRun.revision' }, artifactPath: 'workspace:/research/revision.md',
    });
    expect(projectResearchRunCompactStep({
      sourceToolName: 'research_run', uiKey: 'research_run', toolCallId: callId,
      args, result, status: 'success', phase: 'complete',
    }).title.key).toBe('conversation.tool.researchRun.delivered');
  });

  it('retains saved originals and unsaved child trace when materials change', () => {
    const result = ResearchRunStructuredResultSchema.parse({
      data: {
        status: 'inputs_changed', model_id: 'chosen-model',
        subrun_ids: ['explicit-child-0', 'explicit-child-1'],
        artifacts: output().data.artifacts.slice(0, 2), changed_paths: ['workspace:/input.md'],
      }, observation: 'Input changed; no successor admitted.',
    });
    const events = [decision(), trace('unsaved-child', 1), terminal(result)];
    const current = live(events);
    expect(reloaded(events).toolPresentation).toEqual(current.toolPresentation);
    expect(current.toolPresentation).toMatchObject({
      title: { text: { key: 'conversation.tool.researchRun.inputsChanged' } },
      data: {
        outcome: 'inputs_changed', changedPaths: ['workspace:/input.md'],
        items: [
          { subrunId: 'explicit-child-0', artifactPath: 'workspace:/research/investigation.md' },
          { subrunId: 'explicit-child-1', artifactPath: 'workspace:/research/investigation_review.md' },
          { subrunId: 'unsaved-child', label: { key: 'conversation.tool.researchRun.process' } },
        ],
      },
    });
  });

  it('rejects malformed successful output at both admissions while error lifecycle remains visible', () => {
    const malformed = { ...output(), data: { ...output().data, artifacts: [] } };
    expect(() => reloaded([decision(), terminal(malformed)])).toThrow();
    const state = createInitialProjectionState({
      id: conversationId, title: 'Research', titleOrigin: 'explicit', createdAt: 1, updatedAt: 1,
      selectedAgentId: null, messages: [],
    });
    const start = runtimeEventToFrontendProjectionEvent(decision(), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    const end = runtimeEventToFrontendProjectionEvent(terminal(malformed), { ...PROJECTION_TEST_SCOPE, run_id: runId });
    if (!start || !end) throw new Error('Expected visible lifecycle events');
    expect(reduceEvent(state, start).success).toBe(true);
    const before = state.conversation.messages[0];
    expect(reduceEvent(state, end).success).toBe(false);
    expect(state.conversation.messages[0]).toEqual(before);
    expect(projectResearchRunPresentation({
      sourceToolName: 'research_run', uiKey: 'research_run', args: {}, result: {}, status: 'error', phase: 'error',
    }).title?.text.key).toBe('conversation.tool.researchRun.failed');
  });
});
