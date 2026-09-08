import { afterEach, describe, expect, it } from 'vitest';

import { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import {
  configureLlmDebugEvidence,
  flushLinnyaAudit,
  recordAfterContextManager,
  recordToolProtocolError,
  resetLlmDebugEvidenceForTest,
  runWithLLMDebugEvidenceContext,
} from '..';

const context = {
  conversationId: 'conversation-llm-audit-test',
  runId: 'run-llm-audit-test',
};

function createSink(envelopes: AuditEnvelope[]): AuditPort {
  return {
    emit(envelope) {
      envelopes.push(envelope);
    },
  };
}

afterEach(() => {
  resetLlmDebugEvidenceForTest();
});

describe('LLM debug evidence', () => {
  it('uses the configured AuditPort and keeps protocol error evidence bounded', async () => {
    const envelopes: AuditEnvelope[] = [];
    configureLlmDebugEvidence({ auditPort: createSink(envelopes), level: 'debug' });

    await runWithLLMDebugEvidenceContext(context, async () => {
      for (let index = 0; index < 20; index += 1) {
        recordToolProtocolError({
          toolName: 'read_file',
          toolCallId: `call-${index}`,
          rawArguments: '{}',
          error: 'invalid tool arguments',
        });
      }
      await flushLinnyaAudit();
    });

    expect(envelopes).toHaveLength(16);
    expect(envelopes.every(envelope => envelope.action === 'llm.tool_protocol_error')).toBe(true);
  });

  it('fails closed for transient provider image values', async () => {
    const envelopes: AuditEnvelope[] = [];
    configureLlmDebugEvidence({ auditPort: createSink(envelopes), level: 'debug' });

    await runWithLLMDebugEvidenceContext(context, async () => {
      recordAfterContextManager({
        llmMessages: [{ type: 'input_image', image: new Uint8Array([1, 2, 3]) }],
      });
      await flushLinnyaAudit();
    });

    expect(envelopes).toHaveLength(0);
  });
});
