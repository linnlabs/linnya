import { describe, expect, it, vi } from 'vitest';
import { createToolOutputEvent, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { AssembleWebSourcesArgsSchema } from '@app/schemas';
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
function read(text = 'Original body', id = 'read-1', truncated = false) {
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
    },
    text || 'No body available'
  );
}
const selection = (ref = citation.ref) =>
  AssembleWebSourcesArgsSchema.parse({
    selected: [{ ref, purpose: 'Relevance is an assessment' }],
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

function assemble(events: RuntimeEvent[], text: string, ref = citation.ref) {
  const reader = {
    read: vi.fn(async () => ({ text, url: citation.url, captureKind: 'web_page' as const })),
  };
  return {
    reader,
    result: assembleWebMaterials({
      acquisitions: acquisitions(events),
      selection: selection(ref),
      reader,
      writer,
      query: 'question',
      topK: 6,
    }),
  };
}
describe('网页资料组装：工具自动回填，不让模型重抄原文', () => {
  it('从指定版本自动生成短摘要，保留截断；拒绝未取得 ref 与模型自带 URL/摘录', async () => {
    const events = [search(), read(), read('Revised body', 'read-2', true)];
    const { reader, result } = assemble(events, 'Revised body');
    expect((await result).sources[0]).toMatchObject({
      source_call_id: 'read-2',
      bundle_id: 'read-2',
      capture_kind: 'page_content',
      truncated: true,
      citation: { snippet: 'Revised body' },
    });
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
  it('正文不回传给模型重复生成，短摘要有上限，完整快照交付 Evidence', async () => {
    const body = 'Original '.repeat(1000);
    const result = await assemble([search(), read(body)], body).result;
    expect(result.sources[0].citation.snippet).toHaveLength(800);
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
