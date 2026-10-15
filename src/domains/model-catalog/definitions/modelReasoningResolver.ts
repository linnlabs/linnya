import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type { ModelInferenceRoute } from '@app/schemas/model-inference';

/** Catalog 只查询 canonical 能力；SDK 与 Provider 协议由 App 装配的实现拥有。 */
export type ModelReasoningResolver = (
  route: Pick<ModelInferenceRoute, 'capability_id' | 'endpoint_model_id'>
) => ModelReasoningConfig | undefined;
