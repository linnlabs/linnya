import { loadHistoryWindowTail } from '@/domains/conversation/history/orchestration/historyWindowTailLoader';
import Database from 'better-sqlite3';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import {
  createSubRunTraceEvent, createToolCallDecisionEvent, createToolOutputEvent,
  routeRuntimeEvent, RunIdSchema, ToolCallIdSchema, type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from '../../../app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import * as reader from '../../../app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { SqliteSubrunTraceHistoryProjector } from '../../../app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import { HistoryRepository } from './history.repository';
import { HistoryService } from './history.service';
import { createHistoryRouter } from './history.router';
import { apiFetch, getApiBaseUrl } from '@/shared/services/aiService/common';
import { messageWindowApi } from '@/domains/conversation/message-window/orchestration/messageWindowApi';
import { loadAround } from '@/domains/conversation/message-window/orchestration/messageWindowLoader';
import { useMessageWindowStore } from '@/domains/conversation/message-window/store/messageWindowStore';
import { fetchActiveForegroundRun, fetchForegroundRunSettlement } from '@/domains/conversation/features/interactive-run/orchestration/interactiveRunApi';
import { restoreInteractiveRun } from '@/domains/conversation/features/interactive-run/orchestration/restoreInteractiveRun';
import { observeDetachedInteractiveRun } from '@/domains/conversation/features/interactive-run/orchestration/observeDetachedInteractiveRun';
import { useInteractiveRunStore } from '@/domains/conversation/features/interactive-run/store/interactiveRunStore';
import { useSubrunTraceInvalidationStore } from '@/domains/conversation/features/subrun-trace/store/subrunTraceInvalidationStore';
import { useSubrunTraceHistoryCacheStore } from '@/domains/conversation/features/subrun-trace/store/subrunTraceHistoryCacheStore';
import { useLazySubrunTrace } from '@/domains/conversation/features/subrun-trace/orchestration/useLazySubrunTrace';
import { loadCompleteSubrunTrace } from '@/domains/conversation/features/subrun-trace/orchestration/loadSubrunTrace';
import { useConversationState } from '@/domains/conversation/store/conversationState';
import { useConversationSelectors } from '@/domains/conversation/store/selectors';
import type { ThoughtMessage } from '@/domains/conversation/types';
import { mergeWindowAndLiveMessages } from '@/domains/conversation/message-window/functions/mergeWindowAndLiveMessages';
import type { UiMessagesRefreshDto } from '@/domains/conversation/message-window/definitions/uiMessagesDto';

vi.mock('@/shared/services/aiService/common', () => ({ apiFetch: vi.fn(), getApiBaseUrl: vi.fn() }));
vi.mock('@/domains/conversation/features/interactive-run/orchestration/interactiveRunApi', () => ({
  fetchActiveForegroundRun: vi.fn(), fetchForegroundRunSettlement: vi.fn(),
}));

const conversationId = 'externally-started';
const runId = RunIdSchema.parse('external-run');
const callId = 'external-tool';
const turnId = 'external-turn';
const activeRun = { run_id: runId, turn_id: turnId, execution_id: 'cli-execution', status: 'running' as const, lane: 'foreground' as const };
const cleanups: (() => void | Promise<void>)[] = [];

async function setup(toolName = 'subagent') {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO conversations (conversation_id, created_at, last_event_at) VALUES (?, 1, 1)').run(conversationId);
  cleanups.push(() => { db.close(); });
  const eventStore = new SQLiteEventStore(db);
  const traces = new SqliteSubrunTraceHistoryProjector(db);
  const session = await eventStore.beginRunSession(conversationId, runId, { kind: 'agent' });
  const append = (event: RuntimeEvent) => eventStore.appendEventToRun(session, routeRuntimeEvent(event, {
    run_id: runId, lane: 'foreground', visibility: 'conversation',
  }));
  const startTool = (id: string) => append(createToolCallDecisionEvent(`decision-${id}`, conversationId, turnId, toolName, id, {
    timestamp: 1, payload: { args: { description: 'Actual work' } },
  }));
  // CLI 已经执行并持久化，Renderer 随后进入；测试不创建任何 Renderer transport。
  await startTool('old-tool');
  await startTool(callId);
  traces.project(createSubRunTraceEvent('initial-trace', conversationId, turnId, callId, 'child-1', 'thought_complete', {
    source_event_id: 'initial-thought', run_id: runId, timestamp: 2, content: 'First reasoning',
  }));
  const repository = new HistoryRepository(eventStore, {
    readTail: (id, limit) => reader.readTail(db, id, limit),
    readBefore: (id, cursor, limit) => reader.readBefore(db, id, cursor, limit),
    readAfter: (id, cursor, limit) => reader.readAfter(db, id, cursor, limit),
    readAround: (id, anchor, limit) => reader.readAround(db, id, anchor, limit),
    readWindowRefresh: (id, query) => reader.readWindowRefresh(db, id, query),
    readRunFinalAnswer: (id, run) => reader.readRunFinalAnswer(db, id, run),
    readTurnIndex: id => reader.readTurnIndex(db, id),
    readSubrunTrace: (id, parent, child, options) => reader.readSubrunTrace(db, id, parent, child, options),
  });
  const service = new HistoryService(repository,
    { requestDeletion: async () => { throw new Error('Unexpected deletion'); } },
    { readPendingConversationIds: async () => new Set(), retryPending: async () => { throw new Error('Unexpected cleanup'); } },
  );
  const app = express();
  app.use('/api/v1/conversation', createHistoryRouter(service));
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  vi.mocked(getApiBaseUrl).mockResolvedValue(`http://127.0.0.1:${address.port}`);
  vi.mocked(apiFetch).mockImplementation((input, init) => fetch(input, init));
  vi.mocked(fetchActiveForegroundRun).mockResolvedValue({ conversation_id: conversationId, run: activeRun });
  vi.mocked(fetchForegroundRunSettlement).mockResolvedValue({ conversation_id: conversationId, requested_run_id: runId, run: activeRun });
  await loadHistoryWindowTail(conversationId, 80);
  await restoreInteractiveRun(conversationId);
  return { db, traces, append, startTool, toolName, window: useMessageWindowStore(), runs: useInteractiveRunStore() };
}

function parentPayload() {
  const row = useMessageWindowStore().rows.find(item => item.dto.message_type === 'tool_calls' && item.dto.payload.tool_call_id === callId);
  if (row?.dto.message_type !== 'tool_calls') throw new Error('Missing parent tool row');
  return row.dto.payload;
}

function openTrace() {
  const scope = effectScope();
  cleanups.push(() => scope.stop());
  const invalidation = useSubrunTraceInvalidationStore();
  const cache = useSubrunTraceHistoryCacheStore();
  const load = vi.fn(loadCompleteSubrunTrace);
  const trace = scope.run(() => useLazySubrunTrace(() => ({
    conversationId, parentToolCallId: callId, subrunId: 'child-1',
    kinds: ['thought_complete', 'tool_output', 'final_answer'],
  }), load, () => invalidation.revisionFor(conversationId), cache));
  if (!trace) throw new Error('Missing trace scope');
  return { trace, load, invalidation, cache, dispose: () => scope.stop() };
}

describe('external run → open history → bounded durable refresh', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ['subagent', 'completed'], ['subrun_batch', 'failed'], ['research_run', 'cancelled'],
  ] as const)('%s observes new children and tool output, then settles %s without reopening', async (toolName, outcome) => {
    const fixture = await setup(toolName);
    const { trace, load, invalidation } = openTrace();
    await trace.load();
    expect(trace.buckets.value?.['child-1']?.events).toHaveLength(1);
    expect(parentPayload().subrun_summary?.subrun_ids).toEqual(['child-1']);
    const initialRows = fixture.window.rows;
    const revision = fixture.window.revision;
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.window.rows).toBe(initialRows);
    expect(load).toHaveBeenCalledTimes(1);
    expect(invalidation.revisionFor(conversationId)).toBe(1);

    fixture.traces.project(createSubRunTraceEvent('tool-trace', conversationId, turnId, callId, 'child-1', 'tool_output', {
      source_event_id: 'child-tool-result', run_id: runId, timestamp: 3,
      tool_name: 'calculate', tool_call_id: ToolCallIdSchema.parse('child-calculation'), status: 'success', output: { value: 42 },
    }));
    fixture.traces.project(createSubRunTraceEvent('final-trace', conversationId, turnId, callId, 'child-1', 'final_answer', {
      source_event_id: 'child-finished', run_id: runId, timestamp: 4,
      answer_id: 'child-answer', completion_reason: 'terminal', content: 'Completed child',
    }));
    fixture.traces.project(createSubRunTraceEvent('new-child', conversationId, turnId, callId, 'child-2', 'thought_delta', {
      source_event_id: 'new-child-first-frame', run_id: runId, timestamp: 5, content: 'Reviewing',
    }));
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.window.status).toBe('ready');
    expect(fixture.window.revision).toBeGreaterThan(revision ?? 0);
    expect(parentPayload().subrun_summary?.subrun_ids).toEqual(['child-1', 'child-2']);
    await vi.waitFor(() => expect(trace.buckets.value?.['child-1']?.events.map(event => event.kind)).toEqual([
      'thought_complete', 'tool_output', 'final_answer_chunk', 'final_answer',
    ]));
    expect(load).toHaveBeenCalledTimes(2);
    // 卸载/重挂载消费新 revision 的 ready cache；不能复活首次打开时的 1-event 快照。
    const reopened = openTrace();
    await reopened.trace.load();
    expect(reopened.load).not.toHaveBeenCalled();
    expect(reopened.trace.buckets.value?.['child-1']?.events).toEqual(trace.buckets.value?.['child-1']?.events);

    await fixture.append(createToolOutputEvent('parent-result', conversationId, turnId, toolName, callId,
      outcome === 'completed'
        ? { status: 'success', observation: 'Complete', data: { subrun_ids: ['child-1'] } }
        : { status: 'error', observation: outcome, error: outcome, error_code: outcome === 'cancelled' ? 'CANCELLED' : 'CHILD_FAILED' },
      { timestamp: 6 },
    ));
    vi.mocked(fetchForegroundRunSettlement).mockResolvedValue({ conversation_id: conversationId, requested_run_id: runId, run: { run_id: runId, status: outcome, lane: 'foreground' } });
    // 终态窗口读取失败不能关闭观察；下一次仍可收口。
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('temporary read failure'));
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.runs.snapshotFor(conversationId)?.status).toBe('reconnecting');
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.runs.snapshotFor(conversationId)?.status).toBe(outcome);
    expect(parentPayload().status).toBe(outcome === 'completed' ? 'success' : 'error');
    expect(parentPayload().subrun_summary?.subrun_ids).toContain('child-2');
    await vi.waitFor(() => expect(trace.status.value).toBe('ready'));
    const settledRows = fixture.window.rows;
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.window.rows).toBe(settledRows);
    expect(fixture.runs.hasTransport(conversationId)).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('hands detached durable tools to the visible selector without dropping live-only prose', async () => {
    const fixture = await setup();
    const conversation = useConversationState();
    conversation.createConversation({ id: conversationId, autoActivate: true });
    const entity = conversation.getActiveConversation();
    if (!entity) throw new Error('Expected visible conversation');
    const initialTool = fixture.window.rows.find(row => row.message.type === 'tool_calls' && row.message.metadata.tool_call_id === callId)?.message;
    if (initialTool?.type !== 'tool_calls') throw new Error('Expected initial parent tool');
    const liveProse: ThoughtMessage = {
      id: 'uncommitted-prose', role: 'assistant', type: 'thought', content: 'Still-visible prose', timestamp: 2,
      metadata: { run_id: runId, turn_id: turnId, is_complete: false, thought_started_at: 2 },
    };
    entity.messages = [initialTool, liveProse];
    const selectors = useConversationSelectors(conversation);
    const visibleTool = () => selectors.activeMessages.value.find(message => message.type === 'tool_calls' && message.metadata.tool_call_id === callId);
    fixture.traces.project(createSubRunTraceEvent('second', conversationId, turnId, callId, 'child-2', 'thought_delta', {
      source_event_id: 'second-first-frame', run_id: runId, timestamp: 3, content: 'Second child',
    }));
    await observeDetachedInteractiveRun(conversationId);
    // 原 loading/loading 合成能确定复现遮蔽；已同步窗口的 selector 必须走明确交接。
    const legacyMerge = mergeWindowAndLiveMessages(fixture.window.rows, [initialTool]);
    expect(legacyMerge.messages.find(message => message.id === initialTool.id)?.metadata)
      .toMatchObject({ subrun_summary: { subrun_ids: ['child-1'] } });
    expect(visibleTool()?.metadata).toMatchObject({ subrun_summary: { subrun_ids: ['child-1', 'child-2'] } });
    expect(selectors.activeMessages.value.some(message => message.id === liveProse.id && message.content === liveProse.content)).toBe(true);
    const current = fixture.runs.snapshotFor(conversationId);
    if (!current) throw new Error('Expected observed run');
    const controller = new AbortController();
    fixture.runs.beginContinuation({ ...current, status: 'paused', pause: { settled: true, updatedAt: 10 } }, controller);
    entity.messages = [{ ...initialTool, metadata: { ...initialTool.metadata,
      subrun_summary: { subrun_ids: ['child-1', 'child-2', 'child-3'], event_counts: {} },
    } }, liveProse];
    expect(visibleTool()?.metadata).toMatchObject({ subrun_summary: { subrun_ids: ['child-1', 'child-2', 'child-3'] } });
    fixture.runs.releaseTransport(conversationId, controller);
    fixture.runs.synchronizeSnapshot(conversationId, { ...current, status: 'reconnecting' });
    // 第二次断线到首个 refresh 之间，旧窗口标记不能压掉新 reader 已经提交的 live child。
    expect(visibleTool()?.metadata).toMatchObject({ subrun_summary: { subrun_ids: ['child-1', 'child-2', 'child-3'] } });
    fixture.traces.project(createSubRunTraceEvent('third', conversationId, turnId, callId, 'child-3', 'thought_delta', {
      source_event_id: 'third-first-frame', run_id: runId, timestamp: 4, content: 'Third child',
    }));
    await observeDetachedInteractiveRun(conversationId);
    expect(visibleTool()?.metadata).toMatchObject({ subrun_summary: { subrun_ids: ['child-1', 'child-2', 'child-3'] } });
    expect(selectors.activeMessages.value.some(message => message.id === liveProse.id && message.content === liveProse.content)).toBe(true);
  });

  it('reopens a now-terminal history with a fresh trace instead of the pre-navigation ready cache', async () => {
    const fixture = await setup();
    const original = openTrace();
    await original.trace.load();
    expect(original.trace.buckets.value?.['child-1']?.events).toHaveLength(1);
    original.dispose();
    fixture.window.clear();
    fixture.traces.project(createSubRunTraceEvent('finished-away', conversationId, turnId, callId, 'child-1', 'final_answer', {
      source_event_id: 'finished-away-source', run_id: runId, timestamp: 5,
      answer_id: 'completed-away-answer', completion_reason: 'terminal', content: 'Finished while away',
    }));
    vi.mocked(fetchActiveForegroundRun).mockResolvedValue({ conversation_id: conversationId, run: null });
    await loadHistoryWindowTail(conversationId, 80);
    await restoreInteractiveRun(conversationId);
    expect(fixture.runs.snapshotFor(conversationId)).toBeUndefined();
    const reopened = openTrace();
    await reopened.trace.load();
    expect(reopened.load).toHaveBeenCalledOnce();
    expect(reopened.trace.buckets.value?.['child-1']?.events.map(event => event.kind)).toEqual([
      'thought_complete', 'final_answer_chunk', 'final_answer',
    ]);
  });

  it('refreshes an older window in place through terminal settlement, preserving its anchor', async () => {
    const fixture = await setup();
    const old = fixture.window.rows[0];
    await loadAround(conversationId, old.messageId, { limit: 1 }, { readLiveMessages: () => [] });
    expect(fixture.window.hasMoreAfter).toBe(true);
    const bounds = [fixture.window.prevCursor, fixture.window.nextCursor];
    await fixture.startTool('new-tail');
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.window.rows.map(row => row.messageId)).toEqual([old.messageId]);
    expect([fixture.window.prevCursor, fixture.window.nextCursor]).toEqual(bounds);
    vi.mocked(fetchForegroundRunSettlement).mockResolvedValue({ conversation_id: conversationId, requested_run_id: runId, run: { run_id: runId, status: 'completed', lane: 'foreground' } });
    await observeDetachedInteractiveRun(conversationId);
    expect(fixture.window.rows.map(row => row.messageId)).toEqual([old.messageId]);
    expect(fixture.runs.snapshotFor(conversationId)?.status).toBe('completed');
  });

  it.each(['navigation', 'continuation'] as const)('does not overwrite %s with a late background response', async action => {
    const fixture = await setup();
    await fixture.startTool('later-tool');
    const readRefresh = messageWindowApi.readRefresh;
    let resolveRefresh!: (dto: UiMessagesRefreshDto) => void;
    const delayed = new Promise<UiMessagesRefreshDto>(resolve => { resolveRefresh = resolve; });
    const refresh = vi.spyOn(messageWindowApi, 'readRefresh').mockReturnValue(delayed);
    const observing = observeDetachedInteractiveRun(conversationId);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const query = refresh.mock.calls[0][1];
    if (action === 'navigation') {
      await loadAround(conversationId, fixture.window.rows[0].messageId, { limit: 1 }, { readLiveMessages: () => [] });
    } else {
      const current = fixture.runs.snapshotFor(conversationId);
      if (!current) throw new Error('Expected restored run');
      fixture.runs.beginContinuation({ ...current, status: 'paused', pause: { settled: true, updatedAt: 10 } }, new AbortController());
    }
    const protectedRows = fixture.window.rows;
    resolveRefresh(await readRefresh(conversationId, query));
    await observing;
    expect(fixture.window.rows).toBe(protectedRows);
    expect(useSubrunTraceInvalidationStore().revisionFor(conversationId)).toBe(1);
    if (action === 'continuation') expect(fixture.runs.snapshotFor(conversationId)?.status).toBe('continuing');
  });
});
