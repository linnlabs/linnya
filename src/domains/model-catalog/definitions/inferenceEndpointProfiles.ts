import {
  LANGUAGE_INFERENCE_ROUTE_PROFILES,
  EMBEDDING_ROUTE_PROFILES,
  IMAGE_GENERATION_ROUTE_PROFILES,
} from '@app/schemas/model-inference';
import { DOCUMENT_OCR_CAPABILITY_IDS } from '@app/schemas/document-ocr';

/** Endpoint 是所有已接入推理能力的凭据边界，不把非对话模型伪装成语言 route。 */
export const INFERENCE_ENDPOINT_PROFILES = [
  ...LANGUAGE_INFERENCE_ROUTE_PROFILES,
  ...EMBEDDING_ROUTE_PROFILES,
  ...IMAGE_GENERATION_ROUTE_PROFILES,
  {
    id: 'cohere_compatible_reranking',
    api_surface: 'cohere_rerank',
    capability_id: 'ai-sdk:cohere-compatible-reranking',
    auth_profiles: ['bearer'],
  },
  {
    id: 'paddle_layout_parsing',
    api_surface: 'paddle_layout_parsing',
    capability_id: DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_LAYOUT_PARSING,
    auth_profiles: ['token'],
  },
  {
    id: 'paddle_ocr_jobs',
    api_surface: 'paddle_ocr_jobs',
    capability_id: DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_OCR_JOBS,
    auth_profiles: ['bearer'],
  },
] as const;

export type InferenceEndpointProfileId = (typeof INFERENCE_ENDPOINT_PROFILES)[number]['id'];
export type InferenceEndpointAuthProfile =
  (typeof INFERENCE_ENDPOINT_PROFILES)[number]['auth_profiles'][number];
