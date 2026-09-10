import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import {
  createLinnyaAuditRuntime,
  flushLinnyaAudit,
  recordAfterContextManager,
  resetLlmDebugEvidenceForTest,
  resolveAuditLevel,
  runWithLLMDebugEvidenceContext,
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
  resetLlmDebugEvidenceForTest();
});

describe('unified audit runtime', () => {
  it('defaults to off and only enables audit from a development environment', () => {
    expect(resolveAuditLevel({})).toBe('off');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'behavior' })).toBe('off');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'unknown', LINNYA_DEV_MODE: 'true' })).toBe('off');
    expect(
      resolveAuditLevel({
        LINNYA_AUDIT_LEVEL: 'stream',
        LINNYA_DEV_MODE: 'true',
      })
    ).toBe('stream');
    expect(
      resolveAuditLevel(
        { LINNYA_AUDIT_LEVEL: 'stream', LINNYA_DEV_MODE: 'true' },
        { packaged: true },
      )
    ).toBe('off');
    expect(resolveAuditLevel({ NODE_ENV: 'production', LINNYA_AUDIT_LEVEL: 'stream', LINNYA_DEV_MODE: 'true' })).toBe('off');
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

  it('通过同一入口把 stream evidence 写入同一个 durable sink', async () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    createLinnyaAuditRuntime({ sink, level: 'stream' });

    await runWithLLMDebugEvidenceContext(
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
    expect(envelopes[0]?.evidence?.[0]?.kind).toBe('llm_debug_evidence');
  });

  it('packaged runtime ignores an explicitly requested stream level', async () => {
    const sink: AuditPort = { emit: vi.fn() };
    const runtime = createLinnyaAuditRuntime({
      sink,
      level: 'stream',
      trust: { packaged: true },
    });

    await runtime.auditPort.emit(baseEnvelope('model.select'));
    await runtime.auditPort.emit(baseEnvelope('llm.context.after'));

    expect(runtime.level).toBe('off');
    expect(sink.emit).not.toHaveBeenCalled();
  });
});
