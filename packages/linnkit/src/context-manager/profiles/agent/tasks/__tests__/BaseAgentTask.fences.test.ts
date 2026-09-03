import { describe, expect, it } from 'vitest';

import { createFenceRegistry } from '../../../../shared/fences';
import type { AgentProfileRequest } from '../../contracts';
import { BaseAgentTask } from '../BaseAgentTask';

class TestAgentTask extends BaseAgentTask {
  readonly name = 'test-agent-task';

  protected getSystemPrompt(_request: AgentProfileRequest): string {
    return 'system prompt';
  }
}

describe('BaseAgentTask fence messages', () => {
  it('places after-system fences immediately after the system prompt', () => {
    const registry = createFenceRegistry([
      {
        kind: 'additional-context',
        llmRole: 'system',
        placement: 'after-system',
        lifetime: 'persisted',
        formatter: content => content,
      },
    ]);
    const task = new TestAgentTask({ fenceRegistry: registry });

    const messages = task.buildMessages({
      query: 'current query',
      promptKey: 'default',
      fences: [{ kind: 'additional-context', content: 'doc fragment' }],
    }, []);

    expect(messages.map(message => message.type)).toEqual([
      'system_prompt',
      'context_injection',
      'user_input',
    ]);
    expect(messages[1]).toMatchObject({
      role: 'system',
      type: 'context_injection',
      content: 'doc fragment',
      metadata: {
        fenceKind: 'additional-context',
        fencePlacement: 'after-system',
      },
    });
  });

  it('places fences before and after the current user input', () => {
    const registry = createFenceRegistry([
      {
        kind: 'memory-context',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'turn-only',
        formatter: content => content,
      },
      {
        kind: 'user-quote',
        llmRole: 'user',
        placement: 'after-current-user',
        lifetime: 'turn-only',
        formatter: content => content,
      },
    ]);
    const task = new TestAgentTask({ fenceRegistry: registry });

    const messages = task.buildMessages({
      query: 'current query',
      promptKey: 'default',
      fences: [
        { kind: 'memory-context', content: 'remembered fact' },
        { kind: 'user-quote', content: 'quoted block' },
      ],
    }, []);

    expect(messages.map(message => message.type)).toEqual([
      'system_prompt',
      'context_injection',
      'user_input',
      'context_injection',
    ]);
    expect(messages[1].metadata?.fenceKind).toBe('memory-context');
    expect(messages[2].content).toBe('current query');
    expect(messages[3].metadata?.fenceKind).toBe('user-quote');
  });

  it('places request fences around the matching current user input from history', () => {
    const registry = createFenceRegistry([
      {
        kind: 'document-context',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'turn-only',
        formatter: content => content,
      },
    ]);
    const task = new TestAgentTask({ fenceRegistry: registry });

    const messages = task.buildMessages({
      query: 'current query',
      currentUserEventId: 'current-user',
      promptKey: 'default',
      fences: [{ kind: 'document-context', content: 'selected source' }],
    }, [
      { id: 'old-user', role: 'user', type: 'user_input', content: 'old query', timestamp: 1 },
      { id: 'old-answer', role: 'assistant', type: 'final_answer', content: 'old answer', timestamp: 2 },
      { id: 'current-user', role: 'user', type: 'user_input', content: 'current query', timestamp: 3 },
    ]);

    expect(messages.map(message => message.id)).toEqual([
      expect.any(String),
      'old-user',
      'old-answer',
      expect.any(String),
      'current-user',
    ]);
    expect(messages[3].metadata?.fenceKind).toBe('document-context');
    expect(messages[4].content).toBe('current query');
  });

  it('throws a clear error when a fence kind is not registered', () => {
    const task = new TestAgentTask({ fenceRegistry: createFenceRegistry() });

    expect(() => task.buildMessages({
      query: 'current query',
      promptKey: 'default',
      fences: [{ kind: 'missing-kind', content: 'content' }],
    }, [])).toThrow(/Fence kind "missing-kind" is not registered/i);
  });
});
