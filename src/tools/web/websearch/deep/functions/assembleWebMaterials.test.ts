import { describe, expect, it, vi } from 'vitest';
import { createToolOutputEvent, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { AssembleWebSourcesArgsSchema } from '@app/schemas';
import { buildDeepWebObservation } from './buildDeepWebObservation';
import { assembleWebMaterials } from './assembleWebMaterials';
import type { WebSearchAcquisition } from '../ports/webSearchSnapshotReader';

const citation = {
  sourceType: 'web',
  ref: 'Abc234',
  index: 1,
  url: 'https://example.com/source',
  docTitle: 'Source',
  snippet: 'Search summary',
  siteName: 'Source publisher',
  publishedAt: '2026-09-01',
};
const output = (
  tool: string,
  id: string,
  data: unknown,
  observation: string,
  status: 'success' | 'error' = 'success'
) =>
  createToolOutputEvent(
    id,
    'conversation',
    'turn',
    tool,
    id,
    status === 'error'
      ? { status, observation, error: observation, error_code: 'tool_execution_failed' }
      : { status, observation, data }
  );
function search(empty = false) {
  return output(
    'search_web',
    'search-1',
    {
      query: 'question',
      resultCount: empty ? 0 : 1,
      citations: { query: 'question', searchMode: 'web', citations: empty ? [] : [citation] },
      evidence_store: { bundle_id: 'search' },
      cacheStatus: 'miss',
    },
    'Search summary'
  );
}
function read(text = 'Original body', id = 'read-1', truncated = false, extra: Record<string, unknown> = {}) {
  return output(
    'web_read',
    id,
    {
      url: citation.url,
      title: citation.docTitle,
      charCount: text.length,
      truncated,
      provider: 'local_http',
      renderMode: 'http',
      extractor: 'readability',
      renderAttempted: false,
      escalated: false,
      citations: {
        query: citation.url,
        searchMode: 'web',
        citations: [{ ...citation, snippet: text }],
      },
      evidence_store: { bundle_id: id },
      cacheStatus: 'miss',
      ...extra,
    },
    text || 'No body available'
  );
}
const selection = (ref = citation.ref, anchors?: string[]) =>
  AssembleWebSourcesArgsSchema.parse({
    selected: [{ ref, purpose: 'Relevance is an assessment', ...(anchors ? { anchors } : {}) }],
    summary: 'Brief synthesis',
    gaps: [],
    conflicts: [],
  });
const writer = { save: vi.fn(async () => ({ bundleId: 'assembled-bundle' })) };
function acquisitions(events: readonly RuntimeEvent[]): WebSearchAcquisition[] {
  const items: WebSearchAcquisition[] = [];
  for (const event of events) {
    if (
      event.type !== 'tool_output' ||
      (event.tool_name !== 'search_web' && event.tool_name !== 'web_read')
    )
      continue;
    items.push({
      toolName: event.tool_name,
      callId: event.tool_call_id,
      status: event.status,
      ...(event.data !== undefined ? { data: event.data } : {}),
      observation: event.observation,
      timestamp: event.timestamp,
    });
  }
  return items;
}

function assemble(events: RuntimeEvent[], text: string | Record<string, string>, ref = citation.ref, anchors?: string[]) {
  const reader = {
    read: vi.fn(async (bundleId: string) => ({
      text: typeof text === 'string' ? text : text[bundleId] ?? '',
      url: citation.url,
      captureKind: 'web_page' as const,
    })),
  };
  return {
    reader,
    result: assembleWebMaterials({
      acquisitions: acquisitions(events),
      selection: selection(ref, anchors),
      reader,
      writer,
      query: 'question',
      topK: 6,
    }),
  };
}
describe('网页资料组装：工具自动回填，不让模型重抄原文', () => {
  it('汇总同一来源的全部读取，无定位时退回最近一次从头读的正文；拒绝未取得 ref 与模型自带 URL/摘录', async () => {
    const events = [search(), read(), read('Revised body', 'read-2', true)];
    const { reader, result } = assemble(events, { 'read-1': 'Original body', 'read-2': 'Revised body' });
    expect((await result).sources[0]).toMatchObject({
      source_call_id: 'read-2',
      bundle_id: 'read-2',
      capture_kind: 'page_content',
      citation: { snippet: 'Revised body' },
      excerpts: [{ located: 'start' }],
    });
    expect(reader.read).toHaveBeenCalledWith('read-1', 'Abc234');
    expect(reader.read).toHaveBeenCalledWith('read-2', 'Abc234');
    await expect(assemble(events, 'Revised body', 'Def567').result).rejects.toThrow('not acquired');
    expect(() =>
      AssembleWebSourcesArgsSchema.parse({
        ...selection(),
        selected: [{ ref: citation.ref, purpose: 'test', excerpts: ['Invented quote'] }],
      })
    ).toThrow();
    expect(() =>
      AssembleWebSourcesArgsSchema.parse({
        ...selection(),
        selected: [{ ref: citation.ref, purpose: 'test', url: 'https://fake.example' }],
      })
    ).toThrow();
  });
  it('没给定位时只交开头约 600 字并标明未定位，完整正文交付 Evidence', async () => {
    const body = 'Original '.repeat(1000) + 'Critical qualification at the end.';
    const result = await assemble([search(), read(body)], body).result;
    expect(result.sources[0].citation.snippet.length).toBeLessThanOrEqual(602);
    expect(result.sources[0].truncated).toBe(false);
    expect(result.sources[0].acquired_range).toBe('Read in full.');
    const observation = buildDeepWebObservation('question', result);
    expect(observation).not.toContain('Critical qualification at the end.');
    expect(observation).toContain('not located at the relevant passage');
    expect(observation).toContain('not the full body');
    expect(observation).toContain('Use web_read');
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(writer.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            contentText: body,
            siteName: citation.siteName,
            publishedAt: citation.publishedAt,
          }),
        ],
      })
    );
  });
  it('超长模型注释一次组装成功，明确标记裁剪且不改变来源与证据', async () => {
    const args = AssembleWebSourcesArgsSchema.parse({
      ...selection(),
      summary: 'S'.repeat(1800),
      selected: [{ ref: citation.ref, purpose: 'P'.repeat(700) }],
    });
    const data = await assembleWebMaterials({
      acquisitions: acquisitions([search(), read()]),
      selection: args,
      reader: {
        read: async () => ({ text: 'Original body', url: citation.url, captureKind: 'web_page' }),
      },
      writer,
      query: 'question',
      topK: 6,
    });
    expect(data.notes_truncated).toBe(true);
    expect(data.summary.length).toBeLessThanOrEqual(1200);
    expect(data.sources[0].purpose.length).toBeLessThanOrEqual(300);
    expect(data.sources[0].citation.snippet).toBe('Original body');
  });

  it('空正文不升级为已读；失败独立保留，摘要只能作为摘要返回', async () => {
    expect((await assemble([search(), read('')], '').result).sources[0]).toMatchObject({
      capture_kind: 'metadata_only',
      citation: { snippet: '' },
    });
    const failures = [search(), output('web_read', 'failed', {}, 'HTTP 403', 'error')];
    const data = await assembleWebMaterials({
      acquisitions: acquisitions(failures),
      selection: selection(),
      reader: {
        read: async () => ({
          text: 'Search summary',
          url: citation.url,
          captureKind: 'web_search_result',
        }),
      },
      writer,
      query: 'question',
      topK: 6,
    });
    expect(data.sources[0].capture_kind).toBe('search_snippet');
    expect(data.failures).toEqual([{ tool: 'web_read', call_id: 'failed', error: 'HTTP 403' }]);
  });
  it('有候选须实际尝试读取；零候选允许带缺口交付空包', async () => {
    await expect(assemble([], 'body').result).rejects.toThrow('Search before');
    await expect(assemble([search()], 'body').result).rejects.toThrow('Read promising');
    const data = await assembleWebMaterials({
      acquisitions: acquisitions([search(true)]),
      selection: { selected: [], summary: '', gaps: ['No candidates'], conflicts: [] },
      reader: {
        read: async () => {
          throw new Error('unexpected read');
        },
      },
      writer,
      query: 'question',
      topK: 6,
    });
    expect(data).toMatchObject({ sources: [], search_count: 1, read_attempt_count: 0 });
  });
});

it('原文件取得进入资料包但不升级为已读正文，绑定精确 bundle 的身份摘要', async () => {
  const hash = 'b'.repeat(64);
  const identity = `Original PDF file; SHA-256 ${hash}; file identity only.`;
  const event = output('web_read', 'file-read', {
    url: citation.url, title: citation.docTitle, charCount: 0, truncated: false,
    provider: 'local_http', renderMode: 'http', extractor: 'file_download', renderAttempted: false, escalated: false,
    citations: { query: citation.url, searchMode: 'web', citations: [{ ...citation, snippet: identity }] },
    evidence_store: { bundle_id: 'file-bundle' }, cacheStatus: 'bypass',
    file: { path: `web-downloads/${hash}.pdf`, format: 'pdf', mimeType: 'application/pdf', byteLength: 100,
      sha256: hash, requestedUrl: citation.url, finalUrl: citation.url, acquiredAt: '2026-10-17T00:00:00.000Z', trust: 'untrusted_external_file' },
  }, identity);
  const reader = { read: vi.fn(async () => ({ text: identity, url: citation.url, captureKind: 'web_file' as const })) };
  const result = await assembleWebMaterials({ selection: selection(), acquisitions: acquisitions([search(), event]),
    reader, writer, query: 'question', topK: 6 });
  expect(reader.read).toHaveBeenCalledWith('file-bundle', citation.ref);
  // 文件身份说明不是原文，不当作摘录交出；取得范围说明文件未读。
  expect(result.sources[0]).toMatchObject({
    capture_kind: 'file_download',
    citation: { snippet: '' },
    excerpts: [],
    acquired_range: 'Original PDF file saved; its contents were not read here.',
  });
  expect(buildDeepWebObservation('question', result)).toContain('not parsed');
});

describe('深搜交接按定位截取原文', () => {
  const window = (offset: number, end: number, total: number) => ({
    window: { offset, end, total_chars: total, capture_truncated: false },
  });

  it('按定位短语截取关键段落（忽略大小写与空白），两段分别定位，并给出取得范围', async () => {
    const head = 'Navigation menu and introduction. '.repeat(40);
    const middle = 'The trial found a 19% slowdown among 16 experienced developers across 246 tasks.';
    const tail = ' Filler text. '.repeat(80) + 'Caveat: results may not generalize to novice users.';
    const page1 = head + middle;
    const page2 = tail;
    const events = [
      search(),
      read(page1, 'read-1', true, window(0, page1.length, page1.length + page2.length)),
      read(page2, 'read-2', false, window(page1.length, page1.length + page2.length, page1.length + page2.length)),
    ];
    const result = await assemble(events, { 'read-1': page1, 'read-2': page2 }, citation.ref, [
      '19%  SLOWDOWN among 16 experienced',
      'may not generalize to novice users',
    ]).result;
    const source = result.sources[0]!;
    expect(source.excerpts).toEqual([
      { located: 'anchor', anchor: '19%  SLOWDOWN among 16 experienced' },
      { located: 'anchor', anchor: 'may not generalize to novice users' },
    ]);
    expect(source.citation.snippet).toContain('246 tasks');
    expect(source.citation.snippet).toContain('Caveat: results may not generalize');
    expect(source.citation.snippet).not.toMatch(/^Navigation menu and introduction\. Navigation/u);
    expect(source.citation.snippet.length).toBeLessThanOrEqual(2 * 602 + 5);
    expect(source.acquired_range).toBe(`Read in full (${page1.length + page2.length} characters).`);
    expect(source.truncated).toBe(false);
    const observation = buildDeepWebObservation('question', result);
    expect(observation).toContain("at phrases the child quoted");
    expect(observation).not.toContain('Excerpt: start of the text read');
    expect(observation).toContain('Read by the child: Read in full');
  });

  it('定位短语不在已读原文里时如实列出，退回开头，并提示父 Agent 谨慎对待用途说明', async () => {
    const body = 'Opening paragraph. ' + 'Details. '.repeat(200);
    const result = await assemble(
      [search(), read(body, 'read-1', true, window(0, body.length, body.length * 3))],
      body,
      citation.ref,
      ['revenue grew 40% in 2024'],
    ).result;
    const source = result.sources[0]!;
    expect(source.unmatched_anchors).toEqual(['revenue grew 40% in 2024']);
    expect(source.excerpts).toEqual([{ located: 'start' }]);
    expect(source.citation.snippet.startsWith('Opening paragraph.')).toBe(true);
    expect(source.truncated).toBe(true);
    expect(source.acquired_range).toMatch(/^Read characters 0-\d+ of \d+ \(33%\)\.$/u);
    const observation = buildDeepWebObservation('question', result);
    expect(observation).toContain('"revenue grew 40% in 2024" was not found in the text it read');
  });

  it('两个短语落在同一段时只截一段；查找结果也能用来定位', async () => {
    const body = 'Alpha beta gamma delta. '.repeat(10) + 'Key figure: 72 MW installed. Second detail nearby.';
    const found = '[offset 12000] …later section mentions the 2030 target of 5 GW…';
    const events = [
      search(),
      read(body, 'read-1', true, window(0, body.length, 20000)),
      read(found, 'read-2', false, { find: { query: '2030 target', hit_count: 1, hit_offsets: [12000], truncated: false } }),
    ];
    const result = await assemble(events, { 'read-1': body, 'read-2': found }, citation.ref, [
      'Key figure: 72 MW installed',
      'Second detail nearby',
    ]).result;
    expect(result.sources[0]!.excerpts).toHaveLength(1);
    const viaFind = await assemble(events, { 'read-1': body, 'read-2': found }, citation.ref, ['2030 target of 5 GW']).result;
    expect(viaFind.sources[0]!.citation.snippet).toContain('2030 target of 5 GW');
    expect(viaFind.sources[0]!.acquired_range).toContain('Searched for "2030 target"');
  });

  it('PDF 页文字的摘录带页码，取得范围列出读过的页与无文字层页', async () => {
    const hash = 'c'.repeat(64);
    const pages = '[Page 1]\nCover\n\n[Page 2: no text layer]\n\n[Page 3]\nTable 4 shows household income rose 3.1% in 2024.';
    const file = { path: `web-downloads/${hash}.pdf`, format: 'pdf', mimeType: 'application/pdf', byteLength: 100,
      sha256: hash, requestedUrl: citation.url, finalUrl: citation.url, acquiredAt: '2026-10-17T00:00:00.000Z', trust: 'untrusted_external_file' };
    const event = output('web_read', 'pdf-read', {
      url: citation.url, title: citation.docTitle, charCount: pages.length, truncated: true,
      provider: 'local_http', renderMode: 'http', extractor: 'pdf_text_layer', renderAttempted: false, escalated: false,
      pdf: { page_count: 9, pages: { from: 1, to: 3 }, next_pages: '4-6', pages_without_text: [2], complex_layout_pages: [] },
      citations: { query: citation.url, searchMode: 'web', citations: [{ ...citation, snippet: 'identity' }] },
      evidence_store: { bundle_id: 'pdf-bundle' }, cacheStatus: 'bypass', file,
    }, 'pdf');
    const reader = { read: vi.fn(async () => ({ text: `identity\nRequested URL: x\nFinal URL: y\nCaptured text:\n${pages}`, url: citation.url, captureKind: 'web_file' as const })) };
    const result = await assembleWebMaterials({
      selection: selection(citation.ref, ['household income rose 3.1%']),
      acquisitions: acquisitions([search(), event]), reader, writer, query: 'question', topK: 6,
    });
    const source = result.sources[0]!;
    expect(source.capture_kind).toBe('page_content');
    expect(source.excerpts).toEqual([{ located: 'anchor', anchor: 'household income rose 3.1%', page: 3 }]);
    expect(source.citation.snippet.startsWith('[Page 3] ')).toBe(true);
    expect(source.citation.snippet).not.toContain('Requested URL');
    expect(source.acquired_range).toBe('PDF pages 1-3 of 9 read. No text layer on page 2.');
    expect(source.truncated).toBe(true);
  });
});

describe('交接预算与取得范围细节', () => {
  it('来源多时每段摘录缩短，让整个资料包留在预览上限内；无命中的后续查找不把已读来源降级', async () => {
    const body = 'Lead. '.repeat(300) + 'Anchor sentence with 42% growth. ' + 'Tail. '.repeat(300);
    const empty = output('web_read', 'read-2', {
      url: citation.url, title: citation.docTitle, charCount: 0, truncated: false,
      provider: 'local_http', renderMode: 'http', extractor: 'readability', renderAttempted: false, escalated: false,
      find: { query: 'nothing', hit_count: 0, hit_offsets: [], truncated: false },
      citations: { query: citation.url, searchMode: 'web', citations: [{ ...citation, snippet: '' }] },
      evidence_store: { bundle_id: 'read-2' }, cacheStatus: 'hit',
    }, 'no match');
    const result = await assemble([search(), read(body), empty], { 'read-1': body, 'read-2': '' }, citation.ref, ['42% growth']).result;
    expect(result.sources[0]!.capture_kind).toBe('page_content');
    expect(result.sources[0]!.citation.snippet.length).toBeLessThanOrEqual(602);

    const { excerptWidth } = await import('./assembleWebMaterials');
    expect(excerptWidth(3)).toBe(600);
    expect(excerptWidth(10)).toBe(500);
    expect(excerptWidth(50)).toBe(300);
  });

  it('相邻的 PDF 页段合并成一段', async () => {
    const { describeAcquiredRange } = await import('./describeAcquiredRange');
    const pdfRead = (from: number, to: number) => ({
      pdf: { page_count: 50, pages: { from, to }, pages_without_text: [], complex_layout_pages: [] },
    });
    const range = describeAcquiredRange([pdfRead(1, 4), pdfRead(5, 8), pdfRead(9, 12)] as never);
    expect(range.description).toBe('PDF pages 1-12 of 50 read.');
    expect(describeAcquiredRange([pdfRead(2, 2)] as never).description).toBe('PDF page 2 of 50 read.');
  });
});
