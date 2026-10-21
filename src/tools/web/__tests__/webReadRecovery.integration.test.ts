import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { Readability } from '@mozilla/readability';
import { WebReadResultSchema } from '@app/schemas';
import type { ToolContext } from '../../types';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import { WebReadTool } from '../webread/WebReadTool';
import { LocalHttpProvider } from '../webread/providers/localHttp';
import { createWebReadResult } from '../webread/functions/createWebReadResult';
import { extractArticle } from '../webread/extraction/extractArticle';
import { WebFailureError, getWebFailureDiagnostics } from '../shared/webFailure';
import { WebHttpError } from 'src/infra/adapters/web-http/webHttpFetch';
import { WebPageRenderError } from '../webread/definitions/webPageRenderer';
import { LocalRenderProvider } from '../webread/providers/localRender';
import { readWebPageWithLadder } from '../webread/orchestration/readLadder';
import { assessWebReadQuality } from '../webread/functions/assessWebReadQuality';

const annualTable = `<table summary="Annual output, units: GW"><tr><th>Year</th><th>A</th><th>B</th></tr>
  <tr><td>2024</td><td>8.3</td><td></td></tr><tr><td>2025</td><td>11.3</td><td>2.0</td></tr></table>`;
const landing = `<html><head><title>Report entry</title></head><body><article><h1>Report entry</h1>
  <p>A brief introduction.</p><a href="/report.pdf">Download report</a>
  <a href="/table.csv">Download data</a></article></body></html>`;

function context(): ToolContext {
  const value: ToolContext = { conversationId: 'web-recovery', turnId: 'turn' };
  attachCitationSequence(value, { offset: 0 });
  attachCitationRefAllocator(value, createCitationRefAllocatorFixture());
  return value;
}

describe('Web 数据页和失败恢复线索的业务链路', () => {
  let server: Server;
  let port: number;
  let requests: string[] = [];
  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/html' });
      if (request.url === '/landing') response.end(landing);
      else response.end(`<html><head><title>Annual output (GW)</title></head><body>
        <nav><table><tr><td><table><tr><td><a href="/menu">MENU_ONLY</a></td></tr></table></td></tr></table></nav>
        ${annualTable}<p>NA means not available; blank cells are not zero.</p>
        <div hidden><table><tr><th>Old</th><th>Value</th></tr><tr><td>2025</td><td>999</td></tr></table></div>
        </body></html>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    port = address.port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  function localProvider(): LocalHttpProvider {
    return new LocalHttpProvider({ resolveHost: async url => ({ hostname: url.hostname,
      addresses: [{ address: '127.0.0.1', family: 4 }] }) });
  }

  it('没有main/article的旧数据页保留真实表格、单位与已选脚注，直接物化同一捕获到Evidence', async () => {
    const save = vi.fn<WebEvidenceWriter['save']>(async () => ({ bundleId: 'fixture-bundle' }));
    const render = vi.fn();
    const tool = new WebReadTool({ provider: localProvider(),
      renderProvider: { name: 'renderer', read: render }, managedProvider: null,
      config: { renderEnabled: true, managedReader: 'none' }, evidenceWriter: { save } });
    const result = WebReadResultSchema.parse(JSON.parse(await tool.run({ url: `http://tables.test:${port}/table` }, context())));
    expect(result.data.extractor).toBe('tabular_dom');
    expect(result.data.renderAttempted).toBe(false);
    expect(result.observation).toContain('Annual output, units: GW');
    expect(result.observation).toContain('blank cells are not zero');
    expect(result.observation).not.toContain('MENU');
    expect(result.observation).not.toContain('<td>999</td>');
    const table = load(result.observation);
    expect(table('tr').map((_, row) => [table(row).children().map((_, cell) => table(cell).text()).get()]).get())
      .toEqual([['Year', 'A', 'B'], ['2024', '8.3', ''], ['2025', '11.3', '2.0']]);
    expect(render).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].items[0]?.contentText).toContain('<td>11.3</td>');
  });

  it.each([false, true])('质量不足后增强读取不可用时保留实际资源，仍为失败且不读取附件、不写Evidence（render=%s）', async renderEnabled => {
    requests = [];
    const save = vi.fn(async () => ({ bundleId: 'fixture-bundle' }));
    const cacheRuntime = createWebCacheRuntime(new MemoryWebCache());
    const tool = new WebReadTool({ provider: localProvider(),
      renderProvider: renderEnabled ? new LocalRenderProvider({ renderer: {
        async render() { throw new WebPageRenderError('unavailable', 'not available'); },
      } }) : null,
      managedProvider: null, config: { renderEnabled, managedReader: 'none' },
      evidenceWriter: { save }, cacheRuntime });
    const error = await tool.run({ url: `http://entry.test:${port}/landing` }, context())
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(WebFailureError);
    if (!(error instanceof WebFailureError)) throw new Error('Expected recovery failure');
    expect(error.kind).toBe('managed_disabled');
    expect(error.message).toContain(`http://entry.test:${port}/report.pdf`);
    expect(error.message).toContain(`http://entry.test:${port}/table.csv`);
    expect(error.message).toContain('链接目标尚未读取或保存');
    expect(error.message.indexOf('BEGIN_UNTRUSTED_WEB_CONTENT')).toBeLessThan(error.message.indexOf('/report.pdf'));
    expect(error.details?.resources).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    expect(requests).toEqual(['/landing']);
    // 失败不写正文缓存；恢复后同 URL 的完整结果仍会真实取得。
    const fullRead = vi.fn(async () => createWebReadResult({ url: `http://entry.test:${port}/landing`,
      status: 200, contentType: 'text/plain', title: 'Complete', content: 'Actual complete text',
      contentFormat: 'text', extractor: 'raw_text', renderMode: 'http', rawLength: 20, latencyMs: 0 }));
    const recovered = new WebReadTool({ provider: { name: 'local_http', read: fullRead },
      renderProvider: renderEnabled ? { name: 'local_render', read: fullRead } : null,
      managedProvider: null, config: { renderEnabled, managedReader: 'none' }, cacheRuntime,
      evidenceWriter: { save } });
    expect(JSON.parse(await recovered.run({ url: `http://entry.test:${port}/landing` }, context())).data.cacheStatus).toBe('miss');
    expect(fullRead).toHaveBeenCalledOnce();
  });

  it('503的Retry-After和停止原因跨工具错误保留，不能转述上游正文', async () => {
    const tool = new WebReadTool({ provider: { name: 'local_http', async read() {
      throw new WebHttpError('http_5xx', '本地网页抓取请求失败: HTTP 503。', {
        status: 503, retryAfterMs: 30_000, attempt: 1, retryCount: 0, retryStopReason: 'retry_after_limit',
      });
    } }, renderProvider: null, managedProvider: null });
    const error = await tool.run({ url: 'https://source.test/unavailable' }, context()).catch((failure: unknown) => failure);
    expect(getWebFailureDiagnostics(error)).toMatchObject({ retryAfterMs: 30_000, retryStopReason: 'retry_after_limit', attempt: 1, retryCount: 0 });
    expect(error).toMatchObject({ message: expect.stringContaining('至少等待 30 秒') });
  });

  it('托管读取失败仍保留有界外部链接，不把标签当指令，也不登记目标来源', async () => {
    const url = 'https://entry.test/resource-index';
    const save = vi.fn(async () => ({ bundleId: 'fixture-bundle' }));
    const tool = new WebReadTool({ provider: { name: 'local_http', read: async () => createWebReadResult({
      url, status: 200, contentType: 'text/html', title: 'Entry', content: 'Short',
      contentFormat: 'text', extractor: 'readability', renderMode: 'http', rawLength: 20,
      warnings: ['content_too_short'], latencyMs: 0,
      resources: Array.from({ length: 12 }, (_, i) => ({ kind: 'document',
        url: `https://entry.test/${i}.pdf`, label: `EXTERNAL_INSTRUCTION ${'x'.repeat(500)}` })),
    }) }, renderProvider: null,
    managedProvider: { name: 'managed_fixture', async read() { throw new WebFailureError('timeout', '托管读取超时。'); } },
    evidenceWriter: { save } });
    const error = await tool.run({ url }, context()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(WebFailureError);
    if (!(error instanceof WebFailureError)) throw new Error('Expected managed failure');
    expect(error.kind).toBe('timeout');
    expect(error.details?.resources).toHaveLength(8);
    expect(error.details?.resources?.every(resource => (resource.label?.length ?? 0) <= 200)).toBe(true);
    expect(error.message.indexOf('BEGIN_UNTRUSTED_WEB_CONTENT')).toBeLessThan(error.message.indexOf('EXTERNAL_INSTRUCTION'));
    expect(save).not.toHaveBeenCalled();
  });

  it.each([true, false, undefined])('404只依据Host正式历史判断地址来历，缺失能力不冒充未出现（observed=%s）', async observed => {
    const value = context();
    const hasObservedUrl = vi.fn(() => observed === true);
    if (observed !== undefined) value.webReadAccessHistory = {
      read: () => ({ blocked: 0, succeeded: 0, unclassified: 0 }), hasObservedUrl,
    };
    const tool = new WebReadTool({ provider: { name: 'local_http', async read() {
      throw new WebHttpError('http_error', '本地网页抓取请求失败: HTTP 404。', { status: 404 });
    } }, renderProvider: null, managedProvider: null });
    const error = await tool.run({ url: 'https://source.test/missing' }, value).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(WebFailureError);
    if (!(error instanceof WebFailureError)) throw new Error('Expected HTTP failure');
    expect(error.message).toContain('site:source.test');
    expect(error.message.includes('可能是推测地址')).toBe(observed === false);
    if (observed !== undefined) expect(hasObservedUrl).toHaveBeenCalledOnce();
  });

  it('布局表、隐藏表与空表头不能作为真实数据表绕过质量检查', () => {
    for (const table of [
      '<table role="presentation"><tr><th>Menu</th><th>Links</th></tr><tr><td>A</td><td>B</td></tr></table>',
      '<table><tr><th>Topics</th><th>Links</th></tr><tr><td><a href="/a">About</a></td><td><a href="/b">Contact</a></td></tr></table>',
      '<div hidden>' + annualTable + '</div>',
      '<table><tr><th>Year</th><th>Value</th></tr><tr><td></td><td></td></tr></table>',
    ]) {
      expect(extractArticle(`<html><body>${table}</body></html>`).extractor).not.toBe('tabular_dom');
    }
  });

  it('真实数据表仍经过JS壳检查，脚本骨架不因有数值表就成为完整正文', () => {
    const url = 'https://source.test/loading-data';
    const extracted = extractArticle(`<html><body>${annualTable}<script></script><script></script><script></script></body></html>`);
    expect(extracted.extractor).toBe('tabular_dom');
    const result = createWebReadResult({ url, status: 200, contentType: 'text/html', content: extracted.text,
      contentFormat: 'markdown', extractor: extracted.extractor, renderMode: 'http',
      rawLength: 100, warnings: extracted.warnings, latencyMs: 0 });
    expect(assessWebReadQuality(result)).toMatchObject({ shouldEscalate: true, reason: 'js_required' });
  });

  it('Readability只留下残表时不把新旧两版同时交付，仍保留表外脚注', () => {
    const result = extractArticle(`<html><head><title>Measured output</title></head><body>
      ${annualTable}<p>Blank cells are unavailable, not zero.</p></body></html>`, {
      parseReadability(document) {
        document.querySelector('td:empty')?.remove();
        return new Readability(document, { charThreshold: 0 }).parse();
      },
    });
    const tables = load(result.text);
    expect(tables('table')).toHaveLength(1);
    expect(tables('tr').eq(1).children()).toHaveLength(3);
    expect(result.text).toContain('Blank cells are unavailable');
  });

  it('入口资源在总预算耗尽后保留，调用者取消仍是取消且不展示恢复链接', async () => {
    const url = 'https://entry.test/report';
    const resources = [{ kind: 'document' as const, url: 'https://entry.test/report.pdf' }];
    const provider = { name: 'local_http', read: async () => createWebReadResult({
      url, status: 200, contentType: 'text/html', title: 'Entry', content: 'Short',
      contentFormat: 'text', extractor: 'readability', renderMode: 'http',
      rawLength: 100, warnings: ['content_too_short'], resources, latencyMs: 0,
    }) };
    const renderProvider = { name: 'local_render', read: ({ signal }: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () =>
        reject(new WebFailureError('aborted', 'Rendering stopped')), { once: true })) };
    await expect(readWebPageWithLadder({ url }, { provider, renderProvider,
      managedProvider: null, totalTimeoutMs: 5 })).rejects.toMatchObject({
      kind: 'timeout', details: { resources },
    });
    const controller = new AbortController();
    const value = context();
    value.abortSignal = controller.signal;
    const tool = new WebReadTool({ provider, renderProvider, managedProvider: null });
    const pending = tool.run({ url }, value);
    setTimeout(() => controller.abort(), 5);
    const error = await pending.catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: 'aborted' });
    expect(String(error)).not.toContain('report.pdf');
  });

  it('两张表共用表头时，保留未进入表格视图的另一张表及其独有观测', () => {
    const otherTable = '<table><tr><th>Year</th><th>A</th><th>B</th></tr><tr><td>2030</td><td>777</td><td>888</td></tr></table>';
    const result = extractArticle(`<html><head><title>Two series</title></head><body>
      ${annualTable}${otherTable}<p>Two independently measured series.</p></body></html>`, {
      parseReadability(document) {
        const parsed = new Readability(document, { charThreshold: 0 }).parse();
        if (!parsed) throw new Error('Expected fixture article');
        return { ...parsed, content: `${annualTable}${otherTable}<p>Two independently measured series.</p>` };
      },
    });
    const tables = load(result.text);
    expect(tables('table')).toHaveLength(2);
    expect(result.text).toContain('<td>777</td>');
    expect(result.text).toContain('Two independently measured series.');
  });
});
