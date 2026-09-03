import type { AuditEnvelope } from '../../contracts';
import type { AuditPort } from '../../ports';

export interface CollectingAuditPortHarness {
  port: AuditPort;
  getEnvelopes(action?: string): AuditEnvelope[];
  assertEmitted(action: string): AuditEnvelope;
  assertEmittedInOrder(actions: readonly string[]): AuditEnvelope[];
  reset(): void;
}

function cloneEnvelope(envelope: AuditEnvelope): AuditEnvelope {
  return structuredClone(envelope);
}

/**
 * 收集型 AuditPort。
 *
 * 中文备注：
 * - 用于测试“某次 run 做过哪些决策”，不写文件、不进 EventStore；
 * - 断言方法故意抛普通 Error，让 Vitest/Jest 能直接显示友好的失败原因。
 */
export function createCollectingAuditPort(): CollectingAuditPortHarness {
  const envelopes: AuditEnvelope[] = [];

  return {
    port: {
      emit(envelope: AuditEnvelope): void {
        envelopes.push(cloneEnvelope(envelope));
      },
    },

    getEnvelopes(action?: string): AuditEnvelope[] {
      const selected = action === undefined
        ? envelopes
        : envelopes.filter((envelope) => envelope.action === action);
      return selected.map(cloneEnvelope);
    },

    assertEmitted(action: string): AuditEnvelope {
      const envelope = envelopes.find((candidate) => candidate.action === action);
      if (!envelope) {
        const emitted = envelopes.map((candidate) => candidate.action).join(', ') || '<none>';
        throw new Error(`Expected audit action "${action}" to be emitted, got: ${emitted}`);
      }
      return cloneEnvelope(envelope);
    },

    assertEmittedInOrder(actions: readonly string[]): AuditEnvelope[] {
      const matched: AuditEnvelope[] = [];
      let cursor = 0;

      for (const action of actions) {
        const foundIndex = envelopes.findIndex((candidate, index) => {
          return index >= cursor && candidate.action === action;
        });
        if (foundIndex < 0) {
          const emitted = envelopes.map((candidate) => candidate.action).join(' -> ') || '<none>';
          throw new Error(`Expected audit action order ${actions.join(' -> ')}, got: ${emitted}`);
        }
        matched.push(envelopes[foundIndex]);
        cursor = foundIndex + 1;
      }

      return matched.map(cloneEnvelope);
    },

    reset(): void {
      envelopes.length = 0;
    },
  };
}
