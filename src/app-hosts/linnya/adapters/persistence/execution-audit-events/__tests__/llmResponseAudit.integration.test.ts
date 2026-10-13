import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  createAuditEnvelopeEvent,
  routeRuntimeEvent,
  RunIdSchema,
  type AuditEnvelope,
  type RoutedRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { ConversationControlAuditResponseSchema } from '@app/schemas';
import {
  createLinnyaAuditRuntime,
  recordLlmResponseSummary,
  resetLlmAuditForTest,
  runWithLlmAuditContext,
  type LlmResponseAuditSummaryInput,
} from 'src/domains/audit';
import {
  createExecutionAuditExportUseCase,
  type ExecutionAuditRunRecord,
} from 'src/app-hosts/linnya/application/execution-audit-export';
import { projectExecutionAuditResponse } from 'src/app-hosts/linnya/application/conversation-control/functions/projectExecutionAudit';
import { createEventStoreExecutionAuditEventPort, projectExecutionAuditEventFacts } from '..';
import { SQLiteEventStore } from '../../event-store';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { SQLiteRunRegistryStore } from '../../run-registry';

const conversationId = 'conversation-response-audit';
const rootRun = { runId: 'root', status: 'paused', startedAt: 1, updatedAt: 500 } as const;
const childRun = { ...rootRun, runId: 'child', parentRunId: 'root' } as const;

function summary(attemptId: string, outcome: 'succeeded' | 'failed'): LlmResponseAuditSummaryInput {
  return {
    attemptId, traceId: 'trace-shared', modelId: 'model-test', endpointId: 'private-endpoint',
    endpointModelId: 'private-endpoint-model', capabilityId: 'private-capability',
    apiSurface: 'private-surface', outcome,
    ...(outcome === 'failed'
      ? { failure: { kind: 'transport', code: 'provider_transport_error', retryable: true } }
      : { finishReason: 'private-finish-reason' }),
    usage: { provenance: 'not_reported' },
  };
}

function eventFor(envelope: AuditEnvelope): RoutedRuntimeEvent {
  return routeRuntimeEvent(createAuditEnvelopeEvent(
    `event-${envelope.envelopeId}`, conversationId, 'turn-test', envelope,
  ), {
    run_id: envelope.runId,
    ...(envelope.parentRunId ? { parent_run_id: envelope.parentRunId } : {}),
    lane: 'foreground', visibility: 'none',
  });
}

async function exportResponse(events: RoutedRuntimeEvent[], runs: readonly ExecutionAuditRunRecord[], runId = 'root') {
  // 只使用测试 SQLite；穿过正式 storage codec 和读取适配器，不具备 Flow、模型或凭据依赖。
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY);');
    for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
    db.prepare('INSERT INTO conversations(conversation_id,title,created_at,last_event_at) VALUES(?,?,?,?)')
      .run(conversationId, 'response audit test', 1, 1);
    const registry = new SQLiteRunRegistryStore(db);
    for (const run of runs) {
      await registry.save({ ...run, conversationId, agentSpecId: 'test',
        runId: RunIdSchema.parse(run.runId),
        parentRunId: run.parentRunId ? RunIdSchema.parse(run.parentRunId) : undefined });
    }
    const store = new SQLiteEventStore(db);
    for (const event of events) {
      await store.appendEventToRun(await store.openRunSession(conversationId, event.run_id), event);
    }
    const useCase = createExecutionAuditExportUseCase({
      events: createEventStoreExecutionAuditEventPort(new SQLiteEventStore(db)),
      runs: { async listByConversation(id) { return (await registry.list({ conversationId: id })).runs; } },
      telemetry: { async listByConversation() { return []; } },
      now: () => 600,
    });
    const changesBefore = db.prepare('SELECT total_changes() AS count').get();
    const audit = await useCase.export({ conversationId, runId });
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changesBefore);
    if (!audit) throw new Error('Missing audit scope');
    return ConversationControlAuditResponseSchema.parse(
      projectExecutionAuditResponse({ conversationId, requestedRunId: runId, audit }),
    );
  } finally {
    db.close();
  }
}

afterEach(resetLlmAuditForTest);

describe('LLM response evidence → EventStore query → CLI audit', () => {
  it('保留 child 安全失败与随后成功；只选真实子树，不从共享 trace 关联其它 run', async () => {
    const envelopes: AuditEnvelope[] = [];
    createLinnyaAuditRuntime({ level: 'response', sink: { emit: envelope => { envelopes.push(envelope); } } });
    await runWithLlmAuditContext({ conversationId, runId: 'root' }, async () => {
      recordLlmResponseSummary(summary('root-attempt', 'failed'));
      await runWithLlmAuditContext({ conversationId, runId: 'child', parentRunId: 'root' }, async () => {
        for (let index = 0; index < 4; index += 1) {
          recordLlmResponseSummary(summary(`child-attempt-${index}`, 'failed'));
        }
      });
    });
    // 同一 child 恢复后的事实继续保留，但不存在 execution 字段，不能猜测所属恢复轮次。
    await runWithLlmAuditContext({ conversationId, runId: 'child', parentRunId: 'root' }, async () => {
      recordLlmResponseSummary(summary('child-after-resume', 'succeeded'));
    });
    await runWithLlmAuditContext({ conversationId, runId: 'unrelated' }, async () => {
      recordLlmResponseSummary(summary('unrelated-attempt', 'failed'));
    });
    const runs = [rootRun, childRun, { ...rootRun, runId: 'unrelated' },
      { ...childRun, runId: 'historical-child' }];
    const events = envelopes.map(eventFor);
    const response = await exportResponse(events, runs);
    expect(response.runs.map(run => [run.run_id, run.status])).toEqual(expect.arrayContaining([
      ['root', 'paused'], ['child', 'paused'], ['historical-child', 'paused'],
    ]));
    expect(response.runs).toHaveLength(3);
    expect(response.llm_responses).toMatchObject({
      coverage: 'best_effort', execution_attribution: 'unavailable', missing_or_dropped_attempts: 'unknown',
      by_run: expect.arrayContaining([
        expect.objectContaining({ run_id: 'root', evidence: 'observed', observed_attempts: 1, observed_failures: 1 }),
        expect.objectContaining({ run_id: 'child', parent_run_id: 'root', observed_attempts: 5, observed_failures: 4 }),
        expect.objectContaining({ run_id: 'historical-child', evidence: 'unavailable', observed_attempts: 0, observed_failures: 0, attempts: [] }),
      ]),
    });
    expect(response.llm_responses.by_run.find(run => run.run_id === 'child')?.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempt_id: 'child-attempt-3', outcome: 'failed',
        failure: { kind: 'transport', code: 'provider_transport_error', retryable: true } }),
      expect.objectContaining({ attempt_id: 'child-after-resume', outcome: 'succeeded' }),
    ]));
    expect(response.tool_pairing.records).toEqual([]);
    expect(JSON.stringify(response)).not.toMatch(/private-|unrelated|execution_id|retry_count/);
    const childOnly = await exportResponse(events, runs, 'child');
    expect(childOnly.llm_responses.by_run.map(run => run.run_id)).toEqual(['child']);
    const first = envelopes[0];
    if (!first) throw new Error('Missing recorded envelope');
    expect(() => projectExecutionAuditEventFacts(eventFor({
      ...first, runId: RunIdSchema.parse(childRun.runId),
    }))).toThrow();
    expect(ConversationControlAuditResponseSchema.safeParse({ ...response,
      llm_responses: { ...response.llm_responses, raw_error: 'private-secret' },
    }).success).toBe(false);
  });

  it('实际记录端封顶后明确覆盖未知，不能把缺失的第65次失败补成无失败', async () => {
    const events: RoutedRuntimeEvent[] = [];
    createLinnyaAuditRuntime({ level: 'response', sink: { emit: envelope => { events.push(eventFor(envelope)); } } });
    await runWithLlmAuditContext({ conversationId, runId: 'root' }, async () => {
      for (let index = 0; index < 64; index += 1) recordLlmResponseSummary(summary(`attempt-${index}`, 'succeeded'));
      recordLlmResponseSummary(summary('dropped-failure', 'failed'));
    });
    const response = await exportResponse(events, [rootRun]);
    expect(response.llm_responses).toMatchObject({
      coverage: 'best_effort', missing_or_dropped_attempts: 'unknown',
      capture_limits: { attempts_per_run_execution: 64, bytes_per_run_execution: 1048576 },
      by_run: [{ observed_attempts: 64, observed_failures: 0 }],
    });
    expect(response.llm_responses.by_run[0]?.attempts).toHaveLength(64);
    expect(JSON.stringify(response)).not.toContain('dropped-failure');
  });

  it('审计 off 与旧运行没有 response 事实时保留不可用语义，不调用模型补齐', async () => {
    const events: RoutedRuntimeEvent[] = [];
    createLinnyaAuditRuntime({ level: 'off', sink: { emit: envelope => { events.push(eventFor(envelope)); } } });
    await runWithLlmAuditContext({ conversationId, runId: 'root' }, async () => {
      recordLlmResponseSummary(summary('not-recorded', 'failed'));
    });
    const response = await exportResponse(events, [rootRun, childRun]);
    expect(events).toEqual([]);
    expect(response.llm_responses.by_run.every(run => run.evidence === 'unavailable')).toBe(true);
    expect(response.llm_responses.missing_or_dropped_attempts).toBe('unknown');
    expect(response.runs.every(run => run.status === 'paused')).toBe(true);
  });

  it('字节上限先于条数上限时仍报告覆盖未知，并排除有体积的 route 字段', async () => {
    const events: RoutedRuntimeEvent[] = [];
    createLinnyaAuditRuntime({ level: 'response', sink: { emit: envelope => { events.push(eventFor(envelope)); } } });
    await runWithLlmAuditContext({ conversationId, runId: 'root' }, async () => {
      for (let index = 0; index < 3; index += 1) {
        recordLlmResponseSummary({ ...summary(`large-attempt-${index}`, index === 2 ? 'failed' : 'succeeded'),
          endpointId: `private-${'x'.repeat(400_000)}` });
      }
    });
    const response = await exportResponse(events, [rootRun]);
    expect(response.llm_responses.by_run[0]?.observed_attempts).toBe(2);
    expect(response.llm_responses.missing_or_dropped_attempts).toBe('unknown');
    expect(JSON.stringify(response)).not.toContain('private-');
  });

  it('不从 stream 或原始错误补造摘要，损坏的 response 不能静默变成零失败', async () => {
    const envelopes: AuditEnvelope[] = [];
    createLinnyaAuditRuntime({ level: 'response', sink: { emit: envelope => { envelopes.push(envelope); } } });
    await runWithLlmAuditContext({ conversationId, runId: 'root' }, async () => {
      recordLlmResponseSummary({ ...summary('protocol-failure', 'failed'),
        failure: { kind: 'protocol', code: 'provider_attempt_threw', retryable: false } });
    });
    const envelope = envelopes[0];
    if (!envelope) throw new Error('Missing recorded envelope');
    const response = await exportResponse([eventFor(envelope)], [rootRun]);
    expect(response.llm_responses.by_run[0]?.attempts[0]).toMatchObject({
      outcome: 'failed', failure: { kind: 'protocol', code: 'provider_attempt_threw', retryable: false },
    });
    expect(projectExecutionAuditEventFacts(eventFor({ ...envelope, action: 'llm.stream.failure' }))).toEqual([]);
    expect(() => projectExecutionAuditEventFacts(eventFor({ ...envelope, evidence: [] }))).toThrow();
    expect(() => projectExecutionAuditEventFacts(eventFor({ ...envelope,
      evidence: [{ kind: 'llm_response_summary', metadata: {
        ...summary('unsafe-failure', 'failed'), rawError: 'private-provider-message',
      } }],
    }))).toThrow();
  });
});
