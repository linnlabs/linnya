import { describe, expect, it } from 'vitest';
import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';

import { projectCanonicalInferenceStreamAuditEvent } from './projectCanonicalInferenceStreamAuditEvent';

const continuation = {
  schema_version: 2 as const,
  producer: {
    model_id: 'model-1',
    endpoint_id: 'endpoint-1',
    api_surface: 'mock',
    capability_id: 'host:mock',
    endpoint_model_id: 'provider-model-1',
  },
  kind: 'provider-private',
  payload: { secret: 'CONTINUATION_SECRET' },
};

describe('canonical inference stream audit projection', () => {
  it('removes raw usage while preserving safe token aggregates', () => {
    const event: CanonicalInferenceEvent = {
      type: 'usage',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        source: 'provider-response-usage',
        confidence: 'actual',
        rawUsage: { secret: 'RAW_USAGE_SECRET' },
      },
    };

    const projected = projectCanonicalInferenceStreamAuditEvent(event);

    expect(projected).toEqual({
      type: 'usage',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        source: 'provider-response-usage',
        confidence: 'actual',
      },
    });
    expect(JSON.stringify(projected)).not.toContain('RAW_USAGE_SECRET');
  });

  it('removes Provider continuation from completed assistant and tool parts', () => {
    const assistantPart: CanonicalInferenceEvent = {
      type: 'assistant_part_end',
      index: 0,
      part: { type: 'reasoning', text: 'bounded reasoning', continuation: [continuation] },
    };
    const toolCall: CanonicalInferenceEvent = {
      type: 'tool_call_end',
      index: 1,
      call: {
        id: 'call-1',
        name: 'read_file',
        arguments: { locator: 'workspace:/notes.md' },
        continuation: [continuation],
      },
    };

    const projected = [
      projectCanonicalInferenceStreamAuditEvent(assistantPart),
      projectCanonicalInferenceStreamAuditEvent(toolCall),
    ];

    expect(projected).toEqual([
      {
        type: 'assistant_part_end',
        index: 0,
        part: { type: 'reasoning', text: 'bounded reasoning' },
      },
      {
        type: 'tool_call_end',
        index: 1,
        call: {
          id: 'call-1',
          name: 'read_file',
          arguments: { locator: 'workspace:/notes.md' },
        },
      },
    ]);
    expect(JSON.stringify(projected)).not.toContain('CONTINUATION_SECRET');
  });
});
