import { describe, expect, it } from 'vitest';

import { PdfPageTextCache, SerialGate } from './pdfTextSession';

describe('PdfPageTextCache', () => {
  const page = (pageNumber: number, text: string) => ({ pageNumber, text, layout: 'direct' as const });

  it('按文件身份缓存页文字，超出字数上限时淘汰最久未用的文件', () => {
    const cache = new PdfPageTextCache(10, 8);
    cache.put('a', 3, page(1, '12345'));
    cache.put('b', 2, page(1, '12345'));
    expect(cache.get('a', 1)?.text).toBe('12345');
    cache.put('c', 1, page(1, '123'));
    expect(cache.pageCount('b')).toBeUndefined();
    expect(cache.pageCount('a')).toBe(3);
    expect(cache.get('c', 1)?.text).toBe('123');
  });

  it('文件被改写后身份不同，不会读到旧文字', () => {
    expect(PdfPageTextCache.key({ resolvedPath: '/r.pdf', byteLength: 10, modifiedAtMs: 1 }))
      .not.toBe(PdfPageTextCache.key({ resolvedPath: '/r.pdf', byteLength: 10, modifiedAtMs: 2 }));
  });
});

describe('SerialGate', () => {
  it('同一时刻只执行一个任务，失败不阻塞后续任务', async () => {
    const gate = new SerialGate();
    const order: string[] = [];
    let release!: () => void;
    const first = gate.run(() => new Promise<void>(resolve => { order.push('first'); release = resolve; }));
    const failed = gate.run(async () => { order.push('failed'); throw new Error('boom'); });
    const third = gate.run(async () => { order.push('third'); });
    await Promise.resolve();
    expect(order).toEqual(['first']);
    release();
    await first;
    await expect(failed).rejects.toThrow('boom');
    await third;
    expect(order).toEqual(['first', 'failed', 'third']);
  });
});
