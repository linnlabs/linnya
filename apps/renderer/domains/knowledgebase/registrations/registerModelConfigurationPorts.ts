import {
  registerEmbeddingModelChangeImpactPort,
  type EmbeddingModelChangeImpact,
} from '@/domains/model-configuration';

import { knowledgeBaseService } from '../services/knowledgeBaseService';

export function registerKnowledgeBaseModelConfigurationPorts(): () => void {
  return registerEmbeddingModelChangeImpactPort({
    async findKnowledgeBasesUsingModel(modelId): Promise<readonly EmbeddingModelChangeImpact[]> {
      const response = await knowledgeBaseService.getAllKnowledgeBases();
      return response.knowledge_bases.flatMap(knowledgeBase => {
        if (knowledgeBase.embeddingModelId !== modelId || !knowledgeBase.documentCount) return [];
        return [
          {
            id: knowledgeBase.id,
            name: knowledgeBase.name || knowledgeBase.id,
            documentCount: knowledgeBase.documentCount,
          },
        ];
      });
    },
    async findImpactedKnowledgeBases(nextModelId): Promise<readonly EmbeddingModelChangeImpact[]> {
      const response = await knowledgeBaseService.getAllKnowledgeBases();
      return response.knowledge_bases.flatMap(knowledgeBase => {
        const documentCount =
          typeof knowledgeBase.documentCount === 'number'
            ? Math.max(0, Math.trunc(knowledgeBase.documentCount))
            : 0;
        const provenance =
          typeof knowledgeBase.embeddingModelId === 'string'
            ? knowledgeBase.embeddingModelId.trim()
            : '';
        if (documentCount === 0 || !provenance || provenance === nextModelId) return [];
        return [
          {
            id: knowledgeBase.id,
            name: knowledgeBase.name || knowledgeBase.id,
            documentCount,
          },
        ];
      });
    },
  });
}
