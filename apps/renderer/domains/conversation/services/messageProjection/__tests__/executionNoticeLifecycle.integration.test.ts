import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  RuntimeEvent,
  routeRuntimeEvent,
  runtimeEventToSSEEvent,
  validateSSEEvent,
  createSubRunTraceEvent,
  createToolCallDecisionEvent,
  type RoutedRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { ConversationUiMessageSchema } from '@app/schemas';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { serializeStoredRuntimeEvent } from 'src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec';
import { SqliteUiProjectionApplier } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteApplier';
import {
  rebuildConversationUiProjection,
  readTail,
  readSubrunTrace,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { SqliteSubrunTraceHistoryProjector } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import {
  projectSubrunTraceEvent,
  createSubrunMessageProjectionState,
} from '../../../features/subrun-card/functions/projectSubrunTraceEvent';
import { reduceInteractiveRunEvent } from '../../../features/interactive-run/functions/interactiveRunTransitions';
import type { BaseMessage } from '../../../types';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import { createInitialProjectionState, reduceEvent } from '..';
import {
  projectExecutionNoticePresentation,
  isExecutionNoticeExecuting,
} from '../../../features/error-surface/functions/projectExecutionNoticePresentation';
import { resolveCurrentConversationMessage } from '../../../functions/resolveCurrentConversationMessage';
import { RunLifecycleCoordinator } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runLifecycleCoordinator';
import { resolveRunExecutionActivity } from '../../../shared/execution-presentation';
import type { Conversation } from '../../../types';

const conversationId = 'conversation-retry';
const runId = 'run-retry';
const conversation: Conversation = {
  id: conversationId,
  title: 'Retry',
  titleOrigin: 'explicit',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  selectedAgentId: null,
};
function event(
  id: string,
  status: string,
  timestamp: number,
  retryId = 'retry-one'
): RoutedRuntimeEvent {
  return routeRuntimeEvent(
    RuntimeEvent.parse({
      type: 'llm_retry',
      id,
      version: 1,
      timestamp,
      conversation_id: conversationId,
      turn_id: 'turn-retry',
      retry_id: retryId,
      status,
      category: 'transport',
      attempt: status === 'exhausted' ? 6 : 1,
      max_retries: 6,
      total_attempts: status === 'exhausted' ? 7 : 2,
      started_at: 1000,
      delay_ms: status === 'waiting' ? 1500 : 0,
      ...(status === 'waiting' ? { next_retry_at: 2500 } : {}),
      error: 'Connection unavailable',
      error_code: 'llm.network_error',
    }),
    { run_id: runId, lane: 'foreground', visibility: 'conversation' }
  );
}
function setup() {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE assets (id TEXT PRIMARY KEY);'
  );
  for (const sql of CONVERSATION_SCHEMAS) db.exec(sql);
  db.prepare(
    'INSERT INTO conversations(conversation_id,created_at,last_event_at) VALUES (?,1,1)'
  ).run(conversationId);
  db.prepare(
    "INSERT INTO runs(id,conversation_id,kind,status,start_ts) VALUES (?,?,'agent','running',1)"
  ).run(runId, conversationId);
  const projector = new SqliteUiProjectionApplier(db);
  const lifecycle = new RunLifecycleCoordinator({
    conversationId,
    turnId: 'turn-retry',
    executionId: 'execution-retry',
    options: {},
  });
  let count = 0;
  function append(original: RoutedRuntimeEvent) {
    const item = routeRuntimeEvent(lifecycle.enrichRuntimeEvent(original), {
      run_id: runId,
      lane: 'foreground',
      visibility: 'conversation',
    });
    db.prepare('INSERT INTO events(id,run_id,type,payload,ts) VALUES (?,?,?,?,?)').run(
      item.id,
      runId,
      item.type,
      serializeStoredRuntimeEvent(item),
      item.timestamp
    );
    projector.projectAppendedEvent(conversationId, runId, item, count++);
    db.prepare('UPDATE conversations SET total_events=? WHERE conversation_id=?').run(
      count,
      conversationId
    );
  }
  function read() {
    const result = readTail(db, conversationId, 50);
    if (result.status !== 'ready') throw new Error('Expected ready timeline');
    return result.messages.map(item =>
      mapUiMessageDtoToConversationMessage(ConversationUiMessageSchema.parse(item))
    );
  }
  return { db, append, read };
}
function live(item: RoutedRuntimeEvent) {
  const parsed = validateSSEEvent({
    ...runtimeEventToSSEEvent(item),
    execution_id: 'execution-retry',
  });
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

describe('durable retry notices, live/reload/control boundaries', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  it('other400重试保留请求拒绝文案，历史重放不把它诊断成网络故障', () => {
    const h = setup();
    h.append(routeRuntimeEvent(RuntimeEvent.parse({
      type: 'llm_retry', id: 'other400-wait', version: 1, timestamp: 1000,
      conversation_id: conversationId, turn_id: 'turn-retry', retry_id: 'retry-other400',
      status: 'waiting', category: 'other', attempt: 1, max_retries: 3, total_attempts: 2,
      started_at: 1000, delay_ms: 1500, next_retry_at: 2500,
      error: 'PRIVATE PROVIDER BODY', error_code: 'llm.provider_http_400',
    }), { run_id: runId, lane: 'foreground', visibility: 'conversation' }));
    const notice = h.read()[0];
    if (notice?.type !== 'execution_notice') throw new Error('Expected notice');
    const display = projectExecutionNoticePresentation(notice.metadata, 2000, key => key, true);
    expect(display).toMatchObject({ active: true, failed: false, remainingSeconds: 1 });
    expect(display.text).not.toContain('conversation.retry.network');
    expect(display.text).toContain('(1/3)');
    expect(JSON.stringify(notice)).not.toContain('PRIVATE PROVIDER BODY');
    rebuildConversationUiProjection(h.db, conversationId, { force: true });
    expect(h.read()).toEqual([notice]);
    h.db.close();
  });
  it('waiting is already readable; success preserves its position and rebuild exactly matches live', () => {
    const h = setup();
    const state = createInitialProjectionState(conversation);
    const waiting = event('retry-wait', 'waiting', 1000);
    h.append(waiting);
    expect(reduceEvent(state, live(waiting)).success).toBe(true);
    const pending = h.read()[0];
    if (pending?.type !== 'execution_notice') throw new Error('Expected notice');
    expect(pending.metadata.execution_id).toBe('execution-retry');
    const activity = resolveRunExecutionActivity({
      conversationId,
      runId,
      executionId: 'execution-retry',
      status: 'running',
    });
    expect(isExecutionNoticeExecuting(pending.metadata, activity)).toBe(true);
    expect(
      isExecutionNoticeExecuting(pending.metadata, { ...activity, executionId: 'new-execution' })
    ).toBe(false);
    expect(
      projectExecutionNoticePresentation(
        pending.metadata,
        2000,
        resolveCurrentConversationMessage,
        true
      )
    ).toMatchObject({ active: true, elapsedSeconds: 1, remainingSeconds: 1 });
    const success = event('retry-ok', 'succeeded', 5000);
    h.append(success);
    reduceEvent(state, live(success));
    const saved = h.read()[0];
    if (saved?.type !== 'execution_notice') throw new Error('Expected notice');
    expect(saved.timestamp).toBe(1000);
    expect(saved.metadata.retry?.status).toBe('succeeded');
    expect(
      projectExecutionNoticePresentation(saved.metadata, 500000, resolveCurrentConversationMessage)
    ).toMatchObject({ active: false, failed: false, elapsedSeconds: 4 });
    rebuildConversationUiProjection(h.db, conversationId, { force: true });
    expect(h.read()).toEqual([saved]);
    expect(state.conversation.messages[0]?.metadata).toMatchObject(saved.metadata);
    h.db.close();
  });
  it('exhausted plus terminal error produces one red row; resume and cancellation produce a new preserved episode', () => {
    const h = setup();
    const exhausted = event('retry-exhausted', 'exhausted', 96000);
    h.append(exhausted);
    h.append(
      routeRuntimeEvent(
        RuntimeEvent.parse({
          type: 'error',
          id: 'final-error',
          version: 1,
          timestamp: 96001,
          conversation_id: conversationId,
          turn_id: 'turn-retry',
          retry_id: 'retry-one',
          error: 'SECRET PROVIDER BODY',
          details: { stack: 'SECRET STACK' },
          error_code: 'llm.network_error',
          retryable: true,
        }),
        { run_id: runId, lane: 'foreground', visibility: 'conversation' }
      )
    );
    h.append(event('new-wait', 'waiting', 100000, 'retry-resume'));
    h.append(event('new-cancel', 'cancelled', 101000, 'retry-resume'));
    const messages = h.read();
    expect(messages).toHaveLength(2);
    const first = messages[0];
    const second = messages[1];
    if (first?.type !== 'execution_notice' || second?.type !== 'execution_notice')
      throw new Error('Expected notices');
    expect(
      projectExecutionNoticePresentation(first.metadata, 200000, resolveCurrentConversationMessage)
    ).toMatchObject({ active: false, failed: true });
    expect(first.metadata.retry?.attempt).toBe(6);
    expect(
      projectExecutionNoticePresentation(second.metadata, 200000, resolveCurrentConversationMessage)
    ).toMatchObject({ active: false, failed: false });
    expect(JSON.stringify(messages)).not.toContain('SECRET');
    rebuildConversationUiProjection(h.db, conversationId, { force: true });
    expect(h.read()).toEqual(messages);
    h.db.close();
  });
});

describe('child retry history and control isolation', () => {
  it('compact trace preserves retry + error while parent timeline stays empty, reload uses the same child reducer', () => {
    const h = setup();
    h.append(
      routeRuntimeEvent(
        createToolCallDecisionEvent(
          'parent-decision',
          conversationId,
          'parent-turn',
          'subagent',
          'parent-tool',
          {
            timestamp: 1,
            payload: { args: {} },
          }
        ),
        { run_id: runId, lane: 'foreground', visibility: 'conversation' }
      )
    );
    const projector = new SqliteSubrunTraceHistoryProjector(h.db);
    const waiting = event('child-wait', 'waiting', 1000);
    const exhausted = event('child-exhausted', 'exhausted', 96000);
    if (waiting.type !== 'llm_retry' || exhausted.type !== 'llm_retry')
      throw new Error('Expected retries');
    const retryState = (value: typeof waiting) => ({
      retry_id: value.retry_id,
      status: value.status,
      category: value.category,
      attempt: value.attempt,
      max_retries: value.max_retries,
      total_attempts: value.total_attempts,
      started_at: value.started_at,
      delay_ms: value.delay_ms,
      next_retry_at: value.next_retry_at,
      error: value.error,
      error_code: value.error_code,
    });
    for (const value of [waiting, exhausted])
      projector.project(
        createSubRunTraceEvent(
          `trace-${value.id}`,
          conversationId,
          'parent-turn',
          'parent-tool',
          'child-run',
          'llm_retry',
          {
            metadata: { notice_execution_id: 'parent-execution' },
            source_event_id: value.id,
            timestamp: value.timestamp,
            retry: retryState(value),
          }
        )
      );
    projector.project(
      createSubRunTraceEvent(
        'trace-failure',
        conversationId,
        'parent-turn',
        'parent-tool',
        'child-run',
        'error',
        {
          source_event_id: 'failure',
          timestamp: 96001,
          failure: {
            error: 'Connection unavailable',
            error_code: 'llm.network_error',
            retry_id: waiting.retry_id,
            retryable: true,
          },
        }
      )
    );
    const trace = readSubrunTrace(h.db, conversationId, 'parent-tool', 'child-run');
    if (trace.status !== 'ready') throw new Error('Expected ready trace');
    expect(trace.events).toHaveLength(3);
    expect(trace.events[0]?.metadata?.notice_execution_id).toBe('parent-execution');
    const messages: BaseMessage[] = [];
    const state = createSubrunMessageProjectionState();
    for (const item of trace.events) {
      const parsed = validateSSEEvent({ ...item, execution_id: 'parent-execution' });
      if (!parsed.success || parsed.data.type !== 'subrun_trace') throw new Error('Invalid trace');
      projectSubrunTraceEvent(state, messages, parsed.data);
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'execution_notice',
      metadata: { run_id: 'child-run', retry: { status: 'exhausted', attempt: 6 } },
    });
    expect(h.db.prepare('SELECT message_type FROM conversation_ui_messages').all()).toEqual([
      { message_type: 'tool_calls' },
    ]);
    h.db.close();
  });
  it('retry progress or terminal facts never resume a paused or finished run', () => {
    for (const status of ['paused', 'cancelled', 'completed'] as const) {
      const current = { conversationId, runId, executionId: 'execution-retry', status };
      for (const retryStatus of ['waiting', 'succeeded', 'exhausted', 'cancelled']) {
        expect(
          reduceInteractiveRunEvent(
            current,
            live(event(`notice-${retryStatus}`, retryStatus, 2000))
          )
        ).toBe(current);
      }
    }
  });
});
