/**
 * 桌面后端 Model Catalog 的唯一跨 domain 入口。
 *
 * 本入口只暴露产品模型目录合同、准入纯函数、Cloud 模型稳定 ID 和唯一目录实例。
 * Provider SDK、推理执行、Renderer 状态与业务模型选择均不属于本 domain。
 */

import { modelCatalog } from './registry/modelCatalogRegistry';

export type {
  DocumentOcrRoute,
  FunctionalModelDefaults,
  InferenceApiSurface,
  InferenceAuthProfile,
  ModelCatalog,
  ModelCatalogSource,
  ModelConfig,
  ModelDiff,
  ModelEmbeddingRoute,
  ModelInferenceRoute,
  ModelImageGenerationRoute,
  ModelRerankingRoute,
  TranscriptionRoute,
} from './definitions/modelCatalog';
export type {
  CredentialReference,
  NewInferenceEndpoint,
  InferenceEndpoint,
  InferenceEndpointSelection,
  InferenceEndpointView,
  EndpointCredentialStatus,
  EndpointCredentialCodec,
} from './definitions/inferenceEndpoint';
export { EndpointCredentialUnavailableError } from './definitions/inferenceEndpoint';

export {
  CLOUD_DEEPSEEK_CHAT_MODEL_ID,
  CLOUD_DEEPSEEK_REASONER_MODEL_ID,
  toCloudModelId,
} from './features/cloud-catalog/functions/cloudModelIds';
export { getDeviceId as getLinnyaCloudDeviceId } from './features/cloud-catalog/functions/deviceId';
export { isLinnyaCloudClientEnabled } from './features/cloud-catalog/functions/isLinnyaCloudClientEnabled';
export { normalizeModelCapabilities } from './features/catalog-admission/functions/normalizeModelCapabilities';
export { parseEditableModelPatch } from './features/catalog-admission/functions/parseEditableModelPatch';
export { readDocumentOcrRoute } from './features/catalog-admission/functions/readDocumentOcrRoute';
export { readTranscriptionRoute } from './features/catalog-admission/functions/readTranscriptionRoute';
export { readModelEmbeddingRoute } from './features/catalog-admission/functions/readModelEmbeddingRoute';
export { readModelInferenceRoute } from './features/catalog-admission/functions/readModelInferenceRoute';
export { readModelImageGenerationRoute } from './features/catalog-admission/functions/readModelImageGenerationRoute';
export { readModelRerankingRoute } from './features/catalog-admission/functions/readModelRerankingRoute';
export {
  resolveExplicitDefaultModelsPath,
  sourceDefaultModelsPath,
} from './features/default-catalog/functions/resolveDefaultModelsPath';
export {
  ModelDiscoveryService,
  ModelDiscoveryError,
  buildDiscoveryUrl,
  parseModelListingResponse,
} from './features/model-discovery/modelDiscoveryService';
export {
  inferModelCapabilitiesById,
  inferContextWindowByModelId,
  inferMaxOutputTokensByModelId,
  inferImageInputSupportByModelId,
} from './features/catalog-admission/functions/inferModelCapabilitiesById';
export {
  ModelCatalogRegistry,
  modelCatalog,
  type CloudModelsLoadedEvent,
  type CloudModelsLoadedListener,
} from './registry/modelCatalogRegistry';

/** 按 capability 读取当前首个已发布模型，供尚未升级为 purpose binding 的能力使用。 */
export function getDefaultModelIdByCapability(capability: string): string | undefined {
  return modelCatalog.getDefaultModelIdByCapability(capability);
}
