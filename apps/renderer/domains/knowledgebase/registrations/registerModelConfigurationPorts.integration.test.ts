import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmbeddingModelChangeImpactPort } from '@/domains/model-configuration';

import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { registerKnowledgeBaseModelConfigurationPorts } from './registerModelConfigurationPorts';

vi.mock('../services/knowledgeBaseService', () => ({
  knowledgeBaseService: {
    getAllKnowledgeBases: vi.fn(),
  },
}));

describe('Knowledge Base model-configuration port', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerKnowledgeBaseModelConfigurationPorts();
  });

  it('只返回已有文档且 provenance 与目标模型不同的知识库', async () => {
    vi.mocked(knowledgeBaseService.getAllKnowledgeBases).mockResolvedValue({
      knowledge_bases: [
        {
          id: 'kb-affected',
          name: 'Affected',
          documentCount: 4,
          embeddingModelId: 'embedding-before',
        },
        {
          id: 'kb-current',
          name: 'Current',
          documentCount: 2,
          embeddingModelId: 'embedding-next',
        },
        {
          id: 'kb-empty',
          name: 'Empty',
          documentCount: 0,
          embeddingModelId: 'embedding-before',
        },
        {
          id: 'kb-without-provenance',
          name: 'Without provenance',
          documentCount: 3,
          embeddingModelId: null,
        },
      ],
      total: 4,
      timestamp: '2026-08-14T00:00:00.000Z',
    });

    await expect(
      getEmbeddingModelChangeImpactPort().findImpactedKnowledgeBases('embedding-next'),
    ).resolves.toEqual([
      {
        id: 'kb-affected',
        name: 'Affected',
        documentCount: 4,
      },
    ]);
  });
});
