import { describe, expect, it } from 'vitest';
import { AuditEnvelope } from '../audit';

describe('AuditEnvelope contract', () => {
  it('accepts a minimal run cancel envelope', () => {
    const parsed = AuditEnvelope.parse({
      envelopeId: 'audit-1',
      runId: 'run-1',
      ts: 1000,
      actor: { kind: 'host' },
      action: 'run.cancel',
      decision: {
        outcome: 'cancelled',
        reason: '用户取消',
      },
    });

    expect(parsed.action).toBe('run.cancel');
    expect(parsed.decision?.outcome).toBe('cancelled');
  });

  it('rejects an invalid actor kind', () => {
    expect(() => AuditEnvelope.parse({
      envelopeId: 'audit-1',
      runId: 'run-1',
      ts: 1000,
      actor: { kind: 'daemon' },
      action: 'run.cancel',
    })).toThrow();
  });

  it('keeps evidence/cost/scope as structured records without any-shaped fields', () => {
    const parsed = AuditEnvelope.parse({
      envelopeId: 'audit-2',
      runId: 'run-1',
      parentRunId: 'run-parent',
      ts: 1000,
      actor: { kind: 'model', id: 'model-1' },
      action: 'model.fallback',
      decision: {
        outcome: 'fallback',
        policy: 'retry-fallback',
      },
      evidence: [{
        kind: 'provider_error',
        ref: 'evt-1',
        metadata: { status: 429 },
      }],
      costDelta: {
        tokensInput: 10,
        tokensOutput: 2,
        latencyMs: 100,
      },
      scope: {
        conversationId: 'conv-1',
        runId: 'run-1',
        parentRunId: 'run-parent',
        modelId: 'model-1',
      },
    });

    expect(parsed.evidence?.[0]?.metadata).toEqual({ status: 429 });
    expect(parsed.costDelta?.tokensInput).toBe(10);
    expect(parsed.scope?.parentRunId).toBe('run-parent');
  });

  it('accepts the five G-1 decision envelope classes', () => {
    const actions = [
      'model.select',
      'model.fallback',
      'tool.deny',
      'wait_user.request',
      'sandbox.decide',
    ] as const;

    for (const action of actions) {
      const parsed = AuditEnvelope.parse({
        envelopeId: `audit-${action}`,
        runId: 'run-1',
        ts: 1000,
        actor: { kind: 'system' },
        action,
        decision: {
          outcome: action === 'tool.deny' || action === 'sandbox.decide' ? 'denied' : 'recorded',
          reason: `test ${action}`,
        },
        scope: {
          conversationId: 'conv-1',
          runId: 'run-1',
          turnId: 'turn-1',
        },
      });

      expect(parsed.action).toBe(action);
    }
  });
});
