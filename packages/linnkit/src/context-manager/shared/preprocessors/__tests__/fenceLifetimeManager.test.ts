import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../../contracts';
import { createFenceRegistry } from '../../fences';
import { FenceLifetimePreprocessor } from '../fenceLifetimeManager';

describe('FenceLifetimePreprocessor', () => {
  it('removes historical turn-only context injection messages', async () => {
    const registry = createFenceRegistry([
      {
        kind: 'memory-context',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'turn-only',
        formatter: content => content,
      },
      {
        kind: 'system-event',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted',
        formatter: content => content,
      },
    ]);
    const messages: AiMessage[] = [
      {
        id: 'old-memory',
        role: 'user',
        type: 'context_injection',
        content: 'old memory',
        timestamp: 1,
        metadata: { fenceKind: 'memory-context' },
      },
      {
        id: 'persisted-event',
        role: 'user',
        type: 'context_injection',
        content: 'event',
        timestamp: 2,
        metadata: { fenceKind: 'system-event' },
      },
      { id: 'current-user', role: 'user', type: 'user_input', content: 'current', timestamp: 3 },
      {
        id: 'current-memory',
        role: 'user',
        type: 'context_injection',
        content: 'current memory',
        timestamp: 4,
        metadata: { fenceKind: 'memory-context' },
      },
    ];

    const result = await new FenceLifetimePreprocessor({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages.map(message => message.id)).toEqual([
      'persisted-event',
      'current-user',
      'current-memory',
    ]);
    expect(result.appliedStrategies).toContain('fence_lifetime');
  });

  it('removes historical user-quote context injections when the host registers them as turn-only', async () => {
    const registry = createFenceRegistry([
      {
        kind: 'user-quote',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'turn-only',
        formatter: content => content,
      },
    ]);
    const messages: AiMessage[] = [
      {
        id: 'old-user-quote',
        role: 'user',
        type: 'context_injection',
        content: 'old quoted text',
        timestamp: 1,
        metadata: { fenceKind: 'user-quote' },
      },
      { id: 'current-user', role: 'user', type: 'user_input', content: 'current query', timestamp: 2 },
      {
        id: 'current-user-quote',
        role: 'user',
        type: 'context_injection',
        content: 'current quoted text',
        timestamp: 3,
        metadata: { fenceKind: 'user-quote' },
      },
    ];

    const result = await new FenceLifetimePreprocessor({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages.map(message => message.id)).toEqual([
      'current-user',
      'current-user-quote',
    ]);
    expect(result.appliedStrategies).toContain('fence_lifetime');
  });

  it('keeps unregistered fence kinds and logs only in debug mode', async () => {
    const messages: AiMessage[] = [
      {
        id: 'unknown',
        role: 'user',
        type: 'context_injection',
        content: 'unknown',
        timestamp: 1,
        metadata: { fenceKind: 'unknown-kind' },
      },
    ];

    const result = await new FenceLifetimePreprocessor({ fenceRegistry: createFenceRegistry() }).process(messages, {
      debugMode: false,
    });

    expect(result.messages).toEqual(messages);
    expect(result.appliedStrategies).toEqual([]);
  });
});
