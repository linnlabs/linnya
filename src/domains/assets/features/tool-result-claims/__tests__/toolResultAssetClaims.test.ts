import { describe, expect, it } from 'vitest';
import { createInMemoryToolResultAssetClaimRegistry } from '../index';

describe('tool result asset claims', () => {
  it('绑定 conversation、tool call 与 selection，并在完整匹配后一次性消费', () => {
    const ids = ['claim-a', 'claim-b'];
    const registry = createInMemoryToolResultAssetClaimRegistry({
      createClaimId: () => ids.shift() ?? 'claim-extra',
    });
    const issued = registry.issueClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: [
        { selectionId: 'slide-1', assetId: 'asset-1' },
        { selectionId: 'slide-2', assetId: 'asset-2' },
      ],
    });

    expect(issued).toEqual([
      { selectionId: 'slide-1', uri: 'artifact://tool-results/claim-a' },
      { selectionId: 'slide-2', uri: 'artifact://tool-results/claim-b' },
    ]);
    expect(() => registry.consumeClaims({
      conversationId: 'conversation-b',
      toolCallId: 'call-a',
      selections: issued,
    })).toThrowError(expect.objectContaining({ failure: 'claim_scope_mismatch' }));

    expect(registry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: issued,
    })).toEqual([
      { selectionId: 'slide-1', assetId: 'asset-1' },
      { selectionId: 'slide-2', assetId: 'asset-2' },
    ]);
    expect(() => registry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: issued,
    })).toThrowError(expect.objectContaining({ failure: 'claim_not_found' }));
  });

  it('过期或进程重启后的 claim 不可消费', () => {
    let currentTime = 1_000;
    const registry = createInMemoryToolResultAssetClaimRegistry({
      ttlMs: 100,
      now: () => currentTime,
      createClaimId: () => 'claim-expiring',
    });
    const issued = registry.issueClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: [{ selectionId: 'slide-1', assetId: 'asset-1' }],
    });
    currentTime = 1_100;
    expect(() => registry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: issued,
    })).toThrowError(expect.objectContaining({ failure: 'claim_expired' }));

    const restartedRegistry = createInMemoryToolResultAssetClaimRegistry();
    expect(() => restartedRegistry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: issued,
    })).toThrowError(expect.objectContaining({ failure: 'claim_not_found' }));
  });

  it('按 tool call 显式释放未消费 claim，且不影响 sibling 调用', () => {
    const ids = ['claim-a', 'claim-b'];
    const registry = createInMemoryToolResultAssetClaimRegistry({
      createClaimId: () => ids.shift() ?? 'claim-extra',
    });
    const [first] = registry.issueClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: [{ selectionId: 'slide-a', assetId: 'asset-a' }],
    });
    const [sibling] = registry.issueClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-b',
      selections: [{ selectionId: 'slide-b', assetId: 'asset-b' }],
    });

    registry.releaseClaims({ conversationId: 'conversation-a', toolCallId: 'call-a' });

    expect(() => registry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-a',
      selections: [first],
    })).toThrowError(expect.objectContaining({ failure: 'claim_not_found' }));
    expect(registry.consumeClaims({
      conversationId: 'conversation-a',
      toolCallId: 'call-b',
      selections: [sibling],
    })).toEqual([{ selectionId: 'slide-b', assetId: 'asset-b' }]);
  });
});
