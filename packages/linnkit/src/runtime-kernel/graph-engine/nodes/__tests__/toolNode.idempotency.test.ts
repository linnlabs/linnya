import { describe, expect, it, vi } from 'vitest';

import { executeToolWithIdempotency } from '../toolNode.idempotency';
import { createToolOutputEvent } from '../../../../contracts';

describe('toolNode.idempotency', () => {
  it('命中历史缓存时返回 cacheHit=true，且不调用底层执行', async () => {
    const execute = vi.fn();

    await expect(executeToolWithIdempotency({
      idempotencyKey: 'idem-key',
      inFlight: new Map(),
      history: [
        createToolOutputEvent('cached-output', 'conv-1', 'turn-1', 'search', 'call-1', {
          status: 'success', observation: 'cached', data: { cached: true },
        }, {
          metadata: { idempotency: { key: 'idem-key' } },
        }),
      ],
      toolName: 'search',
      execute,
    })).resolves.toEqual({
      success: true,
      result: JSON.stringify({ data: { cached: true }, observation: 'cached' }),
      durationMs: 0,
      idempotency: { key: 'idem-key', cacheHit: true },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('同 key in-flight 成功执行只调用一次底层执行', async () => {
    const inFlight = new Map();
    let releaseTool!: () => void;
    const toolCanFinish = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const execute = vi.fn(async () => {
      await toolCanFinish;
      return { success: true, result: 'fresh', durationMs: 9 };
    });

    const first = executeToolWithIdempotency({
      idempotencyKey: 'idem-key',
      inFlight,
      history: [],
      toolName: 'search',
      execute,
    });
    const second = executeToolWithIdempotency({
      idempotencyKey: 'idem-key',
      inFlight,
      history: [],
      toolName: 'search',
      execute,
    });

    releaseTool();

    await expect(first).resolves.toEqual({
      success: true,
      result: 'fresh',
      durationMs: 9,
      idempotency: { key: 'idem-key', cacheHit: false },
    });
    await expect(second).resolves.toEqual({
      success: true,
      result: 'fresh',
      durationMs: 0,
      idempotency: { key: 'idem-key', cacheHit: true },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(0);
  });

  it('失败执行不写 idempotency metadata，避免缓存错误结果', async () => {
    const execute = vi.fn(async () => ({
      success: false,
      error: 'boom',
      errorKind: 'execution' as const,
      durationMs: 4,
    }));

    await expect(executeToolWithIdempotency({
      idempotencyKey: 'idem-key',
      inFlight: new Map(),
      history: [],
      toolName: 'search',
      execute,
    })).resolves.toEqual({
      success: false,
      error: 'boom',
      errorKind: 'execution',
      durationMs: 4,
    });
  });
});
