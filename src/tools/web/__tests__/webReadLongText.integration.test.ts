import { describe, expect, it, vi } from 'vitest';
import { WebReadResultSchema } from '@app/schemas';
import type { ToolContext } from '../../types';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import { WebReadTool } from '../webread/WebReadTool';
import type { WebReadProvider, WebReadResult } from '../webread/providers/types';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';

const URL_ = 'https://example.com/long-guide';

function createContext(): ToolContext {
  const context: ToolContext = {
    conversationId: 'long-text-conversation',
    turnId: 'long-text-turn',
    research: { instanceId: 'long-text-instance' },
  };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

const evidenceWriter: WebEvidenceWriter = { save: vi.fn(async () => ({ bundleId: '0123456789abcdef' })) };

/** 12 万字的长文档：每行带编号，末尾附近有一句只出现一次的关键句。 */
function longDocument(): string {
  const lines = Array.from({ length: 2_000 }, (_, index) => `Line ${String(index + 1).padStart(4, '0')}: payout schedule detail ${'x'.repeat(40)}`);
  lines.splice(1_900, 0, 'Instant Payouts settle within 30 minutes in Hong Kong.');
  return lines.join('\n');
}

function readResult(content: string, truncated = false): WebReadResult {
  return {
    url: URL_,
    finalUrl: URL_,
    status: 200,
    contentType: 'text/markdown; charset=utf-8',
    title: 'Long Guide',
    content,
    charCount: content.length,
    text: content,
    markdown: content,
    extractor: 'raw_text',
    renderMode: 'http',
    provider: 'local_http',
    truncated,
    rawLength: content.length,
    fetchedAt: '2026-11-11T00:00:00.000Z',
    contentHash: 'long-guide-hash',
    warnings: [],
    latencyMs: 5,
  };
}

function setup(options: { now?: () => number; content?: string; truncated?: boolean } = {}) {
  const content = options.content ?? longDocument();
  const provider: WebReadProvider = {
    name: 'local_http',
    read: vi.fn().mockResolvedValue(readResult(content, options.truncated)),
  };
  const cache = new MemoryWebCache(options.now ? { now: options.now } : {});
  const tool = new WebReadTool({
    provider,
    renderProvider: null,
    managedProvider: null,
    evidenceWriter,
    cacheRuntime: createWebCacheRuntime(cache),
  });
  const read = async (args: Record<string, unknown>) =>
    WebReadResultSchema.parse(JSON.parse(await tool.run({ url: URL_, ...args }, createContext())));
  return { content, provider, read };
}

describe('web_read 长正文：快照续读与查找', () => {
  it('默认返回 1.5 万字以内的一段，在换行处停下并给出续读偏移', async () => {
    const { content, read } = setup();
    const first = await read({});
    const window = first.data.window!;
    expect(window.offset).toBe(0);
    expect(window.end).toBeLessThanOrEqual(15_000);
    expect(window.end).toBeGreaterThan(12_000);
    expect(content[window.end - 1]).toBe('\n');
    expect(window.total_chars).toBe(content.length);
    expect(window.next_offset).toBe(window.end);
    expect(first.data.truncated).toBe(true);
    expect(first.observation.length).toBeLessThan(20_000);
    expect(first.observation).toContain(`web_read(${JSON.stringify({ url: URL_, offset: window.end })})`);
    expect(first.observation.trimEnd().endsWith(']')).toBe(true);
  });

  it('按偏移续读同一份快照，不重新抓取；读到末尾不再给续读', async () => {
    const { content, provider, read } = setup();
    const first = await read({});
    const second = await read({ offset: first.data.window!.next_offset });
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(second.data.cacheStatus).toBe('hit');
    expect(second.data.window!.offset).toBe(first.data.window!.end);
    expect(second.observation).toContain(content.slice(second.data.window!.offset, second.data.window!.offset + 60));

    const tail = await read({ offset: content.length - 100 });
    expect(tail.data.window!.next_offset).toBeUndefined();
    expect(tail.data.truncated).toBe(false);
    expect(tail.observation).not.toContain('[web_read: next');
  });

  it('find 在全文里定位关键句，给出偏移和原文上下文；按偏移能读到它', async () => {
    const { content, read } = setup();
    const found = await read({ find: 'instant payouts SETTLE within 30 minutes' });
    expect(found.data.find).toMatchObject({ hit_count: 1, truncated: false });
    const offset = found.data.find!.hit_offsets![0]!;
    expect(content.slice(offset)).toMatch(/^Instant Payouts settle/u);
    expect(found.observation).toContain('Instant Payouts settle within 30 minutes in Hong Kong.');
    expect(found.observation).toContain(`[offset ${offset}]`);

    const around = await read({ offset: Math.max(0, offset - 500) });
    expect(around.observation).toContain('Instant Payouts settle within 30 minutes');
  });

  it('续读时快照已过期但仍保留，照样读同一份，不重新抓取', async () => {
    let now = 0;
    const { provider, read } = setup({ now: () => now });
    await read({});
    now = 25 * 60 * 60 * 1_000;
    const continued = await read({ offset: 15_000 });
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(continued.data.cacheStatus).toBe('hit');
    // 不带 offset/find 的新读取按原规则重新抓取。
    await read({});
    expect(provider.read).toHaveBeenCalledTimes(2);
  });

  it('续读时快照已不在，重新抓取并提示偏移可能错位', async () => {
    const { provider, read } = setup();
    const result = await read({ offset: 100 });
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(result.observation).toContain('fetched again now');
  });

  it('快照在保存上限处截断时说明后面还有原文', async () => {
    const { read } = setup({ content: 'short page\n'.repeat(10), truncated: true });
    const result = await read({});
    expect(result.data.window!.capture_truncated).toBe(true);
    expect(result.data.truncated).toBe(true);
    expect(result.observation).toContain('the page continues beyond it');
  });

  it('偏移越界、网页用 pages、offset 与 find 同用都明确报错', async () => {
    const { content, read } = setup();
    await expect(read({ offset: content.length + 10 })).rejects.toThrow('WEB_READ_OFFSET_OUT_OF_RANGE');
    await expect(read({ pages: '2' })).rejects.toThrow('WEB_READ_PAGES_NOT_PDF');
    expect(WebReadResultSchema).toBeDefined();
    const tool = new WebReadTool();
    const validation = (tool as unknown as { validateArguments(args: Record<string, unknown>): { success: boolean; error?: string } })
      .validateArguments({ url: URL_, offset: 5, find: 'x' });
    expect(validation.success).toBe(false);
    expect(validation.error).toContain('use offset or find');
  });
});
