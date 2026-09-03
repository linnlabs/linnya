// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { SearchResultCitation } from '@app/schemas';
import { projectConversationCitationsToEditorHtml } from '../functions/projectConversationCitationsToEditorHtml';

describe('projectConversationCitationsToEditorHtml', () => {
  it('把 Conversation 的派生编号投影为 Editor 可移植 CitationNode DOM', () => {
    const renderedHtml = `
      <p>
        <span class="conversation-citation-node" data-citation-ref="Abc234" data-turn-id="turn-1" data-display-index="1">[1]</span>
        <span class="conversation-citation-node" data-citation-ref="Def567" data-turn-id="turn-1" data-display-index="2">[2]</span>
      </p>
    `;

    const citationMap = new Map<string, SearchResultCitation>([
      [
        'turn-1::Abc234',
        {
          ref: 'Abc234',
          index: 1,
          sourceType: 'knowledge_base',
          docId: 'doc-kb-1',
          blockId: 'block-kb-1',
          docTitle: '知识库文档 A',
          snippet: '知识库摘录 A',
        },
      ],
      [
        'turn-1::Def567',
        {
          ref: 'Def567',
          index: 2,
          sourceType: 'web',
          url: 'https://example.com/article',
          docTitle: '网页文档 B',
          snippet: '网页摘录 B',
          publishedAt: '2026-02-20',
          author: 'Alice',
        },
      ],
    ]);

    let seq = 0;
    const result = projectConversationCitationsToEditorHtml({
      renderedHtml,
      findCitationByRef: (turnId, ref) => citationMap.get(`${turnId}::${ref}`) ?? null,
      generateCitationId: () => {
        seq += 1;
        return `cid-${seq}`;
      },
    });

    expect(result.stats).toEqual({ total: 2, hydrated: 2, missing: [] });
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const nodes = doc.querySelectorAll<HTMLElement>(
      'span.citation-mark[data-type="citation"][data-citation-id]'
    );
    expect(nodes).toHaveLength(2);

    const kbNode = nodes[0];
    expect(kbNode.dataset).toMatchObject({
      citationId: 'cid-1',
      citationRef: 'Abc234',
      sourceType: 'knowledge_base',
      sourceId: 'doc-kb-1',
      blockId: 'block-kb-1',
      title: '知识库文档 A',
      snippet: '知识库摘录 A',
    });
    // DOM 边界保存 canonical ref；进入 Editor 后才由当前文档顺序派生为 [1]。
    expect(kbNode.textContent).toBe('[@Abc234]');

    const webNode = nodes[1];
    expect(webNode.dataset).toMatchObject({
      citationId: 'cid-2',
      citationRef: 'Def567',
      sourceType: 'web',
      sourceId: 'https://example.com/article',
      url: 'https://example.com/article',
      date: '2026-02-20',
      authors: JSON.stringify(['Alice']),
      title: '网页文档 B',
      snippet: '网页摘录 B',
    });
    expect(webNode.textContent).toBe('[@Def567]');
  });

  it('元数据缺失时保留 Conversation 原节点并报告 missing', () => {
    const renderedHtml = `
      <div>
        <span class="conversation-citation-node" data-citation-ref="Efg789" data-turn-id="turn-2" data-display-index="3">[3]</span>
      </div>
    `;

    const result = projectConversationCitationsToEditorHtml({
      renderedHtml,
      findCitationByRef: () => null,
      generateCitationId: () => 'unused',
    });

    expect(result.stats).toEqual({
      total: 1,
      hydrated: 0,
      missing: [{ turnId: 'turn-2', ref: 'Efg789' }],
    });
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const originalNode = doc.querySelector<HTMLElement>(
      '[data-citation-ref="Efg789"][data-turn-id="turn-2"]'
    );
    expect(originalNode?.textContent).toBe('[3]');
    expect(doc.querySelector('span.citation-mark')).toBeNull();
  });
});
