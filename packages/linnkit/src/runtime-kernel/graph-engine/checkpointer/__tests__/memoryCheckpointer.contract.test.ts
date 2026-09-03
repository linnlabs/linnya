import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCheckpointer } from '../memoryCheckpointer';
import type { CheckpointSummary } from '../base';
import type { EngineState } from '../../types';
import { RunIdSchema, ToolCallIdSchema } from '../../../../contracts';

function createEngineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    nodeId: 'llm',
    schemaVersion: 1,
    local: {},
    ...overrides,
  };
}

describe('MemoryCheckpointer contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists schemaVersion and exposes metadata without loading the full checkpoint', async () => {
    vi.setSystemTime(new Date('2026-04-22T09:30:00.000Z'));
    const checkpointer = new MemoryCheckpointer();

    await checkpointer.save(
      'conv-1',
      createEngineState({
        nodeId: 'answer',
        schemaVersion: 7,
        local: {
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('tool-1'),
              type: 'function',
              function: {
                name: 'lookup',
                arguments: '{}',
              },
            },
          ],
          executorLocal: { stepCount: 3 },
        },
      })
    );

    await expect(checkpointer.load('conv-1')).resolves.toMatchObject({
      nodeId: 'answer',
      schemaVersion: 7,
    });

    expect(checkpointer.peekMeta).toBeTypeOf('function');
    const peekMeta = checkpointer.peekMeta;
    if (!peekMeta) {
      throw new Error('MemoryCheckpointer.peekMeta must be implemented');
    }

    await expect(peekMeta.call(checkpointer, 'conv-1')).resolves.toEqual({
      checkpointKey: 'conv-1',
      schemaVersion: 7,
      savedAt: Date.parse('2026-04-22T09:30:00.000Z'),
      currentNode: 'answer',
      iterations: 3,
      hasPendingToolCalls: true,
    });
  });

  it('lists checkpoints with savedAfter and limit filters', async () => {
    const checkpointer = new MemoryCheckpointer();

    vi.setSystemTime(new Date('2026-04-22T09:00:00.000Z'));
    await checkpointer.save('conv-1', createEngineState({ nodeId: 'user', schemaVersion: 1 }));

    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
    await checkpointer.save('conv-2', createEngineState({ nodeId: 'llm', schemaVersion: 2 }));

    vi.setSystemTime(new Date('2026-04-22T11:00:00.000Z'));
    await checkpointer.save('conv-3', createEngineState({ nodeId: 'answer', schemaVersion: 3 }));

    expect(checkpointer.list).toBeTypeOf('function');
    const list = checkpointer.list;
    if (!list) {
      throw new Error('MemoryCheckpointer.list must be implemented');
    }

    const summaries = await list.call(checkpointer, {
      savedAfter: Date.parse('2026-04-22T09:30:00.000Z'),
      limit: 2,
    });

    expect(summaries).toEqual<CheckpointSummary[]>([
      {
        checkpointKey: 'conv-3',
        schemaVersion: 3,
        savedAt: Date.parse('2026-04-22T11:00:00.000Z'),
        currentNode: 'answer',
        iterations: undefined,
        hasPendingToolCalls: false,
      },
      {
        checkpointKey: 'conv-2',
        schemaVersion: 2,
        savedAt: Date.parse('2026-04-22T10:00:00.000Z'),
        currentNode: 'llm',
        iterations: undefined,
        hasPendingToolCalls: false,
      },
    ]);
  });

  it('isolates saved and loaded nested state snapshots', async () => {
    const checkpointer = new MemoryCheckpointer();
    const state = createEngineState({
      local: {
        history: [
          {
            type: 'final_answer',
            id: 'answer-1',
            conversation_id: 'conv-1',
            turn_id: 'turn-1',
            timestamp: 1,
            version: 1,
            answer_id: 'answer-1',
            content: 'before',
            is_complete: true,
            completion_reason: 'terminal',
          },
        ],
        executorLocal: { stepCount: 1 },
        pendingToolCalls: [
          {
            id: ToolCallIdSchema.parse('tool-1'),
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"before"}' },
          },
        ],
      },
    });

    await checkpointer.save('conv-1', state);
    const savedHistory = state.local?.history;
    if (!savedHistory) throw new Error('test state must include history');
    savedHistory[0] = { ...savedHistory[0], content: 'mutated-after-save' };
    if (state.local?.executorLocal) {
      state.local.executorLocal.stepCount = 99;
    }
    if (state.local?.pendingToolCalls?.[0]) {
      state.local.pendingToolCalls[0].function.arguments = '{"q":"mutated"}';
    }

    const firstLoad = await checkpointer.load('conv-1');
    expect(firstLoad?.local?.history?.[0]?.content).toBe('before');
    expect(firstLoad?.local?.executorLocal?.stepCount).toBe(1);
    expect(firstLoad?.local?.pendingToolCalls?.[0]?.function.arguments).toBe('{"q":"before"}');

    if (firstLoad?.local?.history?.[0]) {
      firstLoad.local.history[0].content = 'mutated-after-load';
    }
    if (firstLoad?.local?.executorLocal) {
      firstLoad.local.executorLocal.stepCount = 42;
    }

    const secondLoad = await checkpointer.load('conv-1');
    expect(secondLoad?.local?.history?.[0]?.content).toBe('before');
    expect(secondLoad?.local?.executorLocal?.stepCount).toBe(1);
  });
});
