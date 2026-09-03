import { describe, expect, it, vi } from 'vitest';

import { createBoundedJsonLineDecoder } from '..';

describe('bounded JSON line decoder', () => {
  it('跨 chunk 解码多帧并按包含换行符的原始 bytes 计费', () => {
    const values: unknown[] = [];
    const onFailure = vi.fn();
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'test protocol',
      maxFrameBytes: 9,
      onValue: value => values.push(value),
      onFailure,
    });

    decoder.push('{"a":');
    decoder.push('1}\nnull\n');
    decoder.end();

    expect(values).toEqual([{ a: 1 }, null]);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('超大单个 chunk 在拼接前失败且不再尝试恢复边界', () => {
    const onValue = vi.fn();
    const onFailure = vi.fn();
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'test protocol',
      maxFrameBytes: 8,
      onValue,
      onFailure,
    });

    decoder.push(Buffer.alloc(1024 * 1024, 0x61));
    decoder.push('{}\n');

    expect(onValue).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
      message: 'test protocol frame 超过 8 bytes',
    });
  });
});
