import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingIndexChangeImpactPort } from '@plugin/renderer/modelConfiguration';
const registration = vi.hoisted(() => {
  const result: { port: EmbeddingIndexChangeImpactPort | null } = { port: null };
  return result;
});
vi.mock('@plugin/renderer/modelConfiguration', () => ({ registerEmbeddingIndexChangeImpactPort: (port: EmbeddingIndexChangeImpactPort) => { registration.port = port; return () => { registration.port = null; }; } }));

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
          enableGraphIndexing: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          id: 'kb-affected',
          name: 'Affected',
          documentCount: 4,
          embeddingModelId: 'embedding-before',
        },
        {
          enableGraphIndexing: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          id: 'kb-current',
          name: 'Current',
          documentCount: 2,
          embeddingModelId: 'embedding-next',
        },
        {
          enableGraphIndexing: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          id: 'kb-empty',
          name: 'Empty',
          documentCount: 0,
          embeddingModelId: 'embedding-before',
        },
        {
          enableGraphIndexing: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          id: 'kb-without-provenance',
          name: 'Without provenance',
          documentCount: 3,
          embeddingModelId: undefined,
        },
      ],
      total: 4,
      timestamp: '2026-08-14T00:00:00.000Z',
    });

    await expect(
      registration.port?.findIndexesUsingModel('embedding-next')
    ).resolves.toEqual([{ id: 'kb-current', name: 'Current', documentCount: 2 }]);
    await expect(
      registration.port?.findImpactedIndexes('embedding-next')
    ).resolves.toEqual([
      {
        id: 'kb-affected',
        name: 'Affected',
        documentCount: 4,
      },
    ]);
  });
});
