import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { createDefaultHostInferencePort } from './createDefaultHostInferencePort';
import { createEmbeddingPort } from './createEmbeddingPort';
import { createRerankingPort } from './createRerankingPort';
import { createTextGenerationPort } from './createTextGenerationPort';
import { createDocumentOcrPort } from '../../document-ocr';

/** SDK 和已授权 CLI 共用正式 Host 推理装配，不返回模型目录或凭据。 */
export function createPluginInferencePort(): PluginInferencePort {
  return {
    embedding: createEmbeddingPort(),
    reranking: createRerankingPort(),
    textGeneration: createTextGenerationPort({ inferencePort: createDefaultHostInferencePort() }),
    documentOcr: createDocumentOcrPort(),
  };
}
