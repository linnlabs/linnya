import { describe, expect, it } from 'vitest';
import { allocateAgentKnowledgeSearchEvidence } from './agentSearchOutput';

describe('allocateAgentKnowledgeSearchEvidence', () => {
  it('只投影具备真实证据身份的检索结果，并附着 allocator 已接纳的 ref', async () => {
    await expect(
      allocateAgentKnowledgeSearchEvidence(
        [
          {
            doc_id: 'doc-1',
            block_id: 'block-1',
            doc_title: 'Report',
            document: 'Revenue increased.',
            page_number: 4,
          },
        ],
        {
          async allocate() {
            return ['Abc234'];
          },
        }
      )
    ).resolves.toEqual({
      refs: ['Abc234'],
      hits: [
        {
          ref: 'Abc234',
          docId: 'doc-1',
          blockId: 'block-1',
          docName: 'Report',
          snippet: 'Revenue increased.',
          pageNumber: 4,
        },
      ],
    });
  });

  it('缺少 block_id 时失败，不得用向量点 ID 伪造 citation', async () => {
    await expect(
      allocateAgentKnowledgeSearchEvidence(
        [
          {
            id: 'vector-point-1',
            doc_id: 'doc-1',
            doc_title: 'Report',
            document: 'Revenue increased.',
          },
        ],
        {
          async allocate() {
            return ['Abc234'];
          },
        }
      )
    ).rejects.toThrow('requires non-empty block_id');
  });
});
