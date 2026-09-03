import { describe, expect, it } from 'vitest';
import {
  beginProviderOutboundAttempt,
  completeProviderOutboundAttempt,
  createInMemoryProviderOutboundAudit,
  type ProviderOutboundAttemptSnapshot,
} from '..';

function started(attemptId: string): ProviderOutboundAttemptSnapshot {
  return {
    schema_version: 2,
    attempt_id: attemptId,
    operation: 'embedding',
    route: {
      model_id: 'embedding-model',
      endpoint_id: 'provider',
      endpoint_model_id: 'upstream-model',
      api_surface: 'openai_embeddings',
      capability_id: 'ai-sdk:openai-compatible-embeddings',
    },
    input: { kind: 'embedding', value_count: 2 },
    status: 'started',
    started_at: '2026-08-14T01:00:00.000Z',
    usage: { provenance: 'pending' },
  };
}

describe('provider outbound audit', () => {
  it('记录完整成功状态并保留 Provider usage 来源', () => {
    const audit = createInMemoryProviderOutboundAudit();
    const initial = started('attempt-1');
    audit.record(initial);
    audit.record(
      completeProviderOutboundAttempt(initial, {
        completed_at: '2026-08-14T01:00:00.020Z',
        duration_ms: 20,
        finish_reason: 'completed',
        usage: { provenance: 'provider_reported', input_tokens: 12 },
      })
    );

    expect(audit.readLatest()).toMatchObject({
      attempt_id: 'attempt-1',
      status: 'succeeded',
      duration_ms: 20,
      usage: { provenance: 'provider_reported', input_tokens: 12 },
    });
  });

  it('明确区分 Provider 未返回 usage，并让迟到终态不能覆盖较新 attempt', () => {
    const audit = createInMemoryProviderOutboundAudit();
    const first = started('attempt-1');
    const second = started('attempt-2');
    audit.record(first);
    audit.record(second);
    audit.record(
      completeProviderOutboundAttempt(first, {
        completed_at: '2026-08-14T01:00:00.030Z',
        duration_ms: 30,
        finish_reason: 'completed',
        usage: { provenance: 'not_reported' },
      })
    );

    expect(audit.readLatest()).toEqual(second);
  });

  it('只暴露快照副本，读取方不能获得 store 内部对象', () => {
    const audit = createInMemoryProviderOutboundAudit();
    audit.record(started('attempt-1'));
    const snapshot = audit.readLatest();
    expect(snapshot).not.toBeNull();
    expect(snapshot).not.toBe(audit.readLatest());
    expect(snapshot?.route).not.toBe(audit.readLatest()?.route);
  });

  it('统一生命周期只允许发布一个终态', () => {
    const audit = createInMemoryProviderOutboundAudit();
    const attempt = beginProviderOutboundAttempt(audit, {
      attempt_id: 'attempt-1',
      operation: 'embedding',
      route: started('attempt-1').route,
      input: { kind: 'embedding', value_count: 2 },
    });

    attempt.succeed({
      finish_reason: 'completed',
      usage: { provenance: 'not_reported' },
    });
    expect(() =>
      attempt.fail({
        usage: { provenance: 'not_reported' },
        failure: { kind: 'protocol', code: 'late_failure', retryable: false },
      })
    ).toThrow('已经进入终态');
  });
});
