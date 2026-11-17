import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import {
  createDefaultHostInferencePort,
  createEmbeddingPort,
  createRerankingPort,
  createTextGenerationPort,
} from 'src/app-hosts/linnya/adapters/inference';
import { createDocumentOcrPort } from 'src/app-hosts/linnya/adapters/document-ocr';

export type * from '@linnya/plugin-host-contract/backend/inferenceRuntime';

/** 只返回执行能力；不透传目录、路由、凭据存储或 Provider SDK。 */
export function getPluginInferencePort(): PluginInferencePort {
  return {
    embedding: createEmbeddingPort(),
    reranking: createRerankingPort(),
    textGeneration: createTextGenerationPort({ inferencePort: createDefaultHostInferencePort() }),
    documentOcr: createDocumentOcrPort(),
  };
}
