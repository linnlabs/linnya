import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import {
  createLinnyaAuditRuntime,
  flushLinnyaAudit,
  recordAfterContextManager,
  recordLlmResponseSummary,
  resetLlmAuditForTest,
  resolveAuditLevel,
  runWithLlmAuditContext,
} from '..';

const baseEnvelope = (action: string) =>
  AuditEnvelope.parse({
    envelopeId: `audit-test-${action.replace(/\./g, '-')}`,
    runId: 'run-audit-runtime-test',
    ts: 1,
    actor: { kind: 'host', name: 'audit-test' },
    action,
    scope: {
      conversationId: 'conversation-audit-runtime-test',
      runId: 'run-audit-runtime-test',
    },
  });

afterEach(() => {
  resetLlmAuditForTest();
});

describe('unified audit runtime', () => {
  it('defaults to off and only enables audit from a development environment', () => {
    expect(resolveAuditLevel({})).toBe('off');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'behavior' })).toBe('off');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'unknown', LINNYA_DEV_MODE: 'true' })).toBe(
      'off'
    );
    expect(
      resolveAuditLevel({
        LINNYA_AUDIT_LEVEL: 'stream',
        LINNYA_DEV_MODE: 'true',
      })
    ).toBe('stream');
    expect(
      resolveAuditLevel(
        { LINNYA_AUDIT_LEVEL: 'stream', LINNYA_DEV_MODE: 'true' },
        { packaged: true }
      )
    ).toBe('off');
    expect(
      resolveAuditLevel({
        NODE_ENV: 'production',
        LINNYA_AUDIT_LEVEL: 'stream',
        LINNYA_DEV_MODE: 'true',
      })
    ).toBe('off');
  });

  it('filters behavior actions before they reach the only sink', () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    const runtime = createLinnyaAuditRuntime({ sink, level: 'behavior' });

    runtime.auditPort.emit(baseEnvelope('model.select'));
    runtime.auditPort.emit(baseEnvelope('run.cancel'));
    runtime.auditPort.emit(baseEnvelope('command.execution.started'));

    expect(envelopes.map(envelope => envelope.action)).toEqual([
      'model.select',
      'run.cancel',
      'command.execution.started',
    ]);
  });

  it('keeps response summaries separate from stream evidence', () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    const runtime = createLinnyaAuditRuntime({ sink, level: 'response' });

    runtime.auditPort.emit(baseEnvelope('llm.response.summary'));
    runtime.auditPort.emit(baseEnvelope('llm.context.after'));

    expect(envelopes.map(envelope => envelope.action)).toEqual(['llm.response.summary']);
  });

  it('records a bounded upstream response summary without enabling stream evidence', async () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    createLinnyaAuditRuntime({ sink, level: 'response' });

    await runWithLlmAuditContext(
      {
        conversationId: 'conversation-audit-runtime-test',
        runId: 'run-audit-runtime-test',
        traceId: 'trace-audit-runtime-test',
      },
      async () => {
        recordAfterContextManager({
          contextMessages: [{ role: 'user', content: 'must not be recorded at response level' }],
          llmMessages: [{ role: 'assistant', content: 'must not be recorded at response level' }],
        });
        recordLlmResponseSummary({
          attemptId: 'attempt-audit-runtime-test',
          traceId: 'trace-audit-runtime-test',
          modelId: 'model-audit-runtime-test',
          endpointId: 'endpoint-audit-runtime-test',
          endpointModelId: 'provider-model-audit-runtime-test',
          capabilityId: 'capability-audit-runtime-test',
          apiSurface: 'mock',
          outcome: 'succeeded',
          finishReason: 'stop',
          usage: {
            provenance: 'provider_reported',
            inputTokens: 12,
            outputTokens: 4,
            totalTokens: 16,
          },
        });
        await flushLinnyaAudit();
      }
    );

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      action: 'llm.response.succeeded',
      scope: {
        conversationId: 'conversation-audit-runtime-test',
        runId: 'run-audit-runtime-test',
        traceId: 'trace-audit-runtime-test',
        modelId: 'model-audit-runtime-test',
      },
      evidence: [
        {
          kind: 'llm_response_summary',
          metadata: {
            attemptId: 'attempt-audit-runtime-test',
            outcome: 'succeeded',
            finishReason: 'stop',
            usage: { provenance: 'provider_reported', totalTokens: 16 },
          },
        },
      ],
    });
    expect(JSON.stringify(envelopes)).not.toContain('must not be recorded');
  });

  it('通过同一入口把 stream evidence 写入同一个 durable sink', async () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    createLinnyaAuditRuntime({ sink, level: 'stream' });

    await runWithLlmAuditContext(
      {
        conversationId: 'conversation-audit-runtime-test',
        runId: 'run-audit-runtime-test',
        traceId: 'trace-audit-runtime-test',
      },
      async () => {
        recordAfterContextManager({
          contextMessages: [{ role: 'user', content: 'debug evidence' }],
          llmMessages: [{ role: 'user', content: 'debug evidence' }],
          toolNames: ['read_file'],
        });
        await flushLinnyaAudit();
      }
    );

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.action).toBe('llm.context.after');
    expect(envelopes[0]?.scope?.conversationId).toBe('conversation-audit-runtime-test');
    expect(envelopes[0]?.evidence?.[0]?.kind).toBe('llm_stream_evidence');
  });

  it('packaged runtime ignores an explicitly requested stream level', async () => {
    const sink: AuditPort = { emit: vi.fn(), flush: vi.fn() };
    const runtime = createLinnyaAuditRuntime({
      sink,
      level: 'stream',
      trust: { packaged: true },
    });

    await runtime.auditPort.emit(baseEnvelope('model.select'));
    await runtime.auditPort.emit(baseEnvelope('llm.context.after'));
    await runtime.flush();

    expect(runtime.level).toBe('off');
    expect(sink.emit).not.toHaveBeenCalled();
    expect(sink.flush).not.toHaveBeenCalled();
  });

  it.each(['sync', 'async'] as const)('%s sink 失败不让运行控制或命令 producer 失败，也不重试', async mode => {
    const emit = vi.fn(() => {
      if (mode === 'sync') throw new Error('storage unavailable');
      return Promise.reject(new Error('storage unavailable'));
    });
    const flush = vi.fn(async () => { throw new Error('flush unavailable'); });
    const runtime = createLinnyaAuditRuntime({ sink: { emit, flush }, level: 'behavior' });
    await expect(runtime.auditPort.emit(baseEnvelope('run.cancel'))).resolves.toBeUndefined();
    await expect(runtime.auditPort.emit(baseEnvelope('command.execution.started'))).resolves.toBeUndefined();
    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
