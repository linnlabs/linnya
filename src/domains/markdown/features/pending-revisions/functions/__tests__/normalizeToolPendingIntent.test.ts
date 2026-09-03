import { describe, expect, it } from 'vitest';

import { normalizeToolPendingIntent } from '../normalizeToolPendingIntent';

describe('normalizeToolPendingIntent', () => {
  it('新块后续更新仍保持 insert 身份和原始锚点', () => {
    expect(normalizeToolPendingIntent({
      existingMetadataJson: JSON.stringify({ operation: 'insert', anchorBlockId: 'anchor-original' }),
      incomingMetadata: { operation: 'update', anchorBlockId: 'anchor-new' },
    })).toEqual({
      action: 'write',
      metadata: { operation: 'insert', anchorBlockId: 'anchor-original' },
    });
  });

  it('尚未接受的新块再被删除时抵消整个插入意图', () => {
    expect(normalizeToolPendingIntent({
      existingMetadataJson: JSON.stringify({ operation: 'insert', anchorBlockId: 'anchor' }),
      incomingMetadata: { operation: 'delete' },
    })).toEqual({ action: 'cancel_insert' });
  });
});
