import { describe, expect, it } from 'vitest';
import { parseEditableModelPatch } from '../functions/parseEditableModelPatch';

const embeddingRoute = {
  api_surface: 'openai_embeddings',
  capability_id: 'ai-sdk:openai-compatible-embeddings',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  usage: { response_usage: 'provider_reported_optional' },
};

const rerankingRoute = {
  api_surface: 'cohere_rerank',
  capability_id: 'ai-sdk:cohere-compatible-reranking',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  usage: { response_usage: 'provider_reported_optional' },
};

const documentOcrRoute = {
  api_surface: 'paddle_ocr_jobs',
  capability_id: 'host:paddle-ocr-jobs',
  endpoint_id: 'fixture',
  endpoint_model_id: 'provider-model-v2',
  base_url: 'https://fixture.invalid/v2',
  auth_profile: 'bearer',
  mode: 'document_upload',
  supports_abort_signal: true,
  attempt_timeout_ms: 300_000,
  poll_interval_ms: 5_000,
};

describe('parseEditableModelPatch - embedding route', () => {
  it('原子接受 model 与 embedding route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        embedding_route: embeddingRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        embedding_route: embeddingRoute,
      },
    });
  });

  it('拒绝不同步 route 的 model 更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
      })
    ).toMatchObject({ success: false });
  });
});

describe('parseEditableModelPatch - reranking route', () => {
  it('原子接受 model 与 reranking route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        reranking_route: rerankingRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        reranking_route: rerankingRoute,
      },
    });
  });
});

describe('parseEditableModelPatch - document OCR route', () => {
  it('原子接受 model 与 document OCR route 身份更新', () => {
    expect(
      parseEditableModelPatch({
        model_name: 'provider-model-v2',
        document_ocr_route: documentOcrRoute,
      })
    ).toEqual({
      success: true,
      patch: {
        model_name: 'provider-model-v2',
        document_ocr_route: documentOcrRoute,
      },
    });
  });
});
