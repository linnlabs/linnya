import { describe, expect, it } from 'vitest';
import { createEvidenceBundleRecord } from '../createEvidenceBundleRecord';

describe('Evidence bundle identity', () => {
  it('相同来源快照保持稳定 ID，正文变化产生新 ID', () => {
    const command = {
      scope: { conversationId: 'conversation-id', instanceId: 'instance-id' },
      kind: 'knowledge_evidence' as const,
      query: '产品模型',
      items: [
        {
          ref_id: 'Abc234',
          source_type: 'knowledge_base' as const,
          capture_kind: 'knowledge_document_chunk' as const,
          title: '产品模型',
          snippet: '快照正文',
          content_text: '快照正文',
          captured_at_ms: 1,
          doc_id: 'document-1',
          block_id: 'block-1',
        },
      ],
    };

    const first = createEvidenceBundleRecord({
      conversationId: 'conversation-id',
      command,
      createdAtMs: 1,
    });
    const repeated = createEvidenceBundleRecord({
      conversationId: 'conversation-id',
      command,
      createdAtMs: 2,
    });
    const changed = createEvidenceBundleRecord({
      conversationId: 'conversation-id',
      command: {
        ...command,
        items: [{ ...command.items[0], content_text: '变化后的正文' }],
      },
      createdAtMs: 2,
    });

    expect(repeated.bundleId).toBe(first.bundleId);
    expect(repeated.record.created_at_ms).toBe(2);
    expect(changed.bundleId).not.toBe(first.bundleId);
  });
});
