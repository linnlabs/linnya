import { describe, expect, it } from 'vitest';

import { validateAiMessage } from '../messages';

describe('context_injection message contract', () => {
  it('accepts system context injection messages with fence metadata', () => {
    const parsed = validateAiMessage({
      id: 'ctx-system-1',
      role: 'system',
      type: 'context_injection',
      content: 'System-scoped injected context',
      timestamp: 1,
      metadata: {
        fenceKind: 'additional-context',
        fenceAttrs: { source: 'doc-1' },
        fencePlacement: 'after-system',
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.data.metadata?.fenceKind).toBe('additional-context');
    expect(parsed.data.metadata?.fenceAttrs).toEqual({ source: 'doc-1' });
    expect(parsed.data.metadata?.fencePlacement).toBe('after-system');
  });

  it('accepts user context injection messages with fence metadata', () => {
    const parsed = validateAiMessage({
      id: 'ctx-user-1',
      role: 'user',
      type: 'context_injection',
      content: 'User-scoped injected context',
      timestamp: 1,
      metadata: {
        fenceKind: 'memory-context',
        fenceAttrs: { memoryId: 'mem-1' },
        fencePlacement: 'before-current-user',
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.data.metadata?.fenceKind).toBe('memory-context');
  });

  it('keeps legacy context message types parseable during migration', () => {
    for (const type of ['document_fragment', 'context_before', 'context_after'] as const) {
      const parsed = validateAiMessage({
        id: `legacy-${type}`,
        role: 'user',
        type,
        content: 'legacy context',
        timestamp: 1,
      });

      expect(parsed.success).toBe(true);
    }
  });
});
