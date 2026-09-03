import { describe, it, expect } from 'vitest';
import crc32 from 'crc-32';
import type { TextGenerationResult } from 'src/domains/model-inference';

import { GraphExtractionService } from '../application/graphExtractionService';

function generation(text: string): TextGenerationResult {
  return { text, reasoning: '', finishReason: 'stop' };
}

describe('GraphExtractionService (M3)', () => {
  it('batchSize=1：应把 LLM 输出规范化为稳定的 node/edge（含稳定 edgeId）', async () => {
    const llm = {
      async generate(): Promise<TextGenerationResult> {
        return generation(JSON.stringify([
          {
            chunk_id: 'b1',
            entities: [
              { name: 'Apple Inc.', type: 'Company' },
              { name: 'iPhone', type: 'Product' },
            ],
            edges: [
              {
                source: 'Apple Inc.',
                target: 'iPhone',
                relation_type: 'produces',
                statement: 'Apple produces iPhone.',
                confidence: 0.9,
              },
            ],
          },
        ]));
      },
    };

    const service = new GraphExtractionService(llm);

    const r1 = await service.extractFromChunks(
      'model-any',
      [{ kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Apple produces iPhone.' }],
      { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
    );

    expect(r1.nodes.map((n) => n.id).sort()).toEqual(['apple-inc', 'iphone']);
    expect(r1.edges).toHaveLength(1);
    expect(r1.edges[0].sourceEntityId).toBe('apple-inc');
    expect(r1.edges[0].targetEntityId).toBe('iphone');
    // produces 不在 relation_type 白名单内，应确定性归一到 RELATED_TO
    expect(r1.edges[0].relationType).toBe('RELATED_TO');
    expect(r1.edges[0].evidenceDocId).toBe('doc1');
    expect(r1.edges[0].evidenceBlockId).toBe('b1');

    // edgeId 稳定：基于 seed 的 crc32（与实现一致）
    const seed = ['kb1', 'apple-inc', 'RELATED_TO', 'iphone', 'doc1', 'b1', 'apple produces iphone'].join('|');
    const expected = `edge_${((crc32.str(seed) >>> 0).toString(16)).padStart(8, '0')}`;
    expect(r1.edges[0].id).toBe(expected);

    // 再跑一次应得到完全一致的 id（幂等基础）
    const r2 = await service.extractFromChunks(
      'model-any',
      [{ kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Apple produces iPhone.' }],
      { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
    );
    expect(r2.edges[0].id).toBe(r1.edges[0].id);
  });

  it('批量抽取：应要求 LLM 返回 chunk_id，并把 edges 归属到对应 evidence_block_id', async () => {
    const llm = {
      async generate(): Promise<TextGenerationResult> {
        return generation(JSON.stringify([
          {
            chunk_id: 'b1',
            entities: [{ name: 'Apple Inc.', type: 'Company' }],
            edges: [],
          },
          {
            chunk_id: 'b2',
            entities: [{ name: 'iPhone', type: 'Product' }],
            edges: [
              {
                source: 'iPhone',
                target: 'Apple Inc.',
                relation_type: 'DEPENDS_ON',
                statement: 'iPhone 的供应链高度依赖 Apple Inc.',
                confidence: 0.7,
              },
            ],
          },
        ]));
      },
    };

    const service = new GraphExtractionService(llm);
    const r = await service.extractFromChunks(
      'model-any',
      [
        { kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Chunk1 text' },
        { kbId: 'kb1', docId: 'doc1', blockId: 'b2', text: 'Chunk2 text' },
      ],
      { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
    );

    // nodes 至少包含 apple-inc / iphone（批量合并，允许重复 upsert）
    const nodeIds = Array.from(new Set(r.nodes.map((n) => n.id))).sort();
    expect(nodeIds).toEqual(['apple-inc', 'iphone']);

    // edge 归属到 b2
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0].evidenceDocId).toBe('doc1');
    expect(r.edges[0].evidenceBlockId).toBe('b2');

    // edgeId 稳定：基于 seed 的 crc32（与实现一致）
    const seed = [
      'kb1',
      'iphone',
      'DEPENDS_ON',
      'apple-inc',
      'doc1',
      'b2',
      'iphone 的供应链高度依赖 apple inc',
    ].join('|');
    const expected = `edge_${((crc32.str(seed) >>> 0).toString(16)).padStart(8, '0')}`;
    expect(r.edges[0].id).toBe(expected);
  });

  it('批量抽取：当 LLM 漏掉某些 chunk_id 时，应抛错（避免“进度推进但漏抽”）', async () => {
    const llm = {
      async generate(): Promise<TextGenerationResult> {
        // 故意只返回 b1，漏掉 b2
        return generation(JSON.stringify([{ chunk_id: 'b1', entities: [], edges: [] }]));
      },
    };

    const service = new GraphExtractionService(llm);

    await expect(
      service.extractFromChunks(
        'model-any',
        [
          { kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Chunk1 text' },
          { kbId: 'kb1', docId: 'doc1', blockId: 'b2', text: 'Chunk2 text' },
        ],
        { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
      )
    ).rejects.toThrow(/未覆盖全部 chunk_id/);
  });

  it('批量抽取：当 LLM 输出包含“第二段数组/尾随 JSON”时，应只解析第一段完整数组', async () => {
    const llm = {
      async generate(): Promise<TextGenerationResult> {
        const first = JSON.stringify([
          { chunk_id: 'b1', entities: [{ name: 'Apple' }], edges: [] },
        ]);
        const second = JSON.stringify([{ chunk_id: 'b2', entities: [], edges: [] }]);
        return generation(`${first}\n${second}\n`);
      },
    };

    const service = new GraphExtractionService(llm);
    const r = await service.extractFromChunks(
      'model-any',
      [{ kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Chunk1 text' }],
      { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
    );

    // 只解析第一段数组，因此只会产生 apple 相关节点
    const nodeIds = Array.from(new Set(r.nodes.map((n) => n.id))).sort();
    expect(nodeIds).toEqual(['apple']);
  });

  it('批量抽取：当 LLM 输出被截断导致数组不闭合时，应抛出“JSON 数组不完整”错误（用于上层降 chunksPerCall 重试）', async () => {
    const llm = {
      async generate(): Promise<TextGenerationResult> {
        // 模拟 finish_reason=length 导致的截断：只输出到一半，没有闭合 ]
        return generation(`[
  { "chunk_id": "b1", "entities": [], "edges": [] }
`);
      },
    };

    const service = new GraphExtractionService(llm);

    await expect(
      service.extractFromChunks(
        'model-any',
        [{ kbId: 'kb1', docId: 'doc1', blockId: 'b1', text: 'Chunk1 text' }],
        { maxEntitiesPerChunk: 32, maxEdgesPerChunk: 64 }
      )
    ).rejects.toThrow(/JSON 数组不完整/);
  });
});

