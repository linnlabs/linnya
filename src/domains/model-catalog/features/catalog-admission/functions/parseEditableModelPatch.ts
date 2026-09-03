import type { ModelConfig } from '../../../definitions/modelCatalog';
import { normalizeModelCapabilities } from './normalizeModelCapabilities';
import { readModelInferenceRoute } from './readModelInferenceRoute';
import { readModelEmbeddingRoute } from './readModelEmbeddingRoute';
import { readModelRerankingRoute } from './readModelRerankingRoute';
import { readModelImageGenerationRoute } from './readModelImageGenerationRoute';
import { readDocumentOcrRoute } from './readDocumentOcrRoute';
import { readTranscriptionRoute } from './readTranscriptionRoute';

type EditableModelPatch = Pick<
  ModelConfig,
  | 'display_name'
  | 'model_name'
  | 'capabilities'
  | 'inference_route'
  | 'embedding_route'
  | 'reranking_route'
  | 'image_generation_route'
  | 'document_ocr_route'
  | 'transcription_route'
>;

export type ParseEditableModelPatchResult =
  | { readonly success: true; readonly patch: Partial<EditableModelPatch> }
  | { readonly success: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseEditableModelPatch(value: unknown): ParseEditableModelPatchResult {
  if (!isRecord(value)) {
    return { success: false, reason: '更新内容必须是对象' };
  }

  const patch: Partial<EditableModelPatch> = {};
  for (const key of ['display_name', 'model_name'] as const) {
    if (!(key in value)) continue;
    const field = value[key];
    if (typeof field !== 'string') {
      return { success: false, reason: `${key} 必须是字符串` };
    }
    patch[key] = field;
  }

  if ('capabilities' in value) {
    const capabilities = normalizeModelCapabilities(value['capabilities']);
    if (!capabilities) {
      return { success: false, reason: 'capabilities 必须是非空字符串数组' };
    }
    patch.capabilities = capabilities;
  }

  if ('inference_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 inference_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.inference_route = readModelInferenceRoute(value.inference_route, {
        modelName,
        hasChatCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'inference_route 无效',
      };
    }
  }

  if ('embedding_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 embedding_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.embedding_route = readModelEmbeddingRoute(value.embedding_route, {
        modelName,
        hasEmbeddingCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'embedding_route 无效',
      };
    }
  }

  if ('reranking_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 reranking_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.reranking_route = readModelRerankingRoute(value.reranking_route, {
        modelName,
        hasRerankCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'reranking_route 无效',
      };
    }
  }

  if ('image_generation_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 image_generation_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.image_generation_route = readModelImageGenerationRoute(value.image_generation_route, {
        modelName,
        hasImageGenerationCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'image_generation_route 无效',
      };
    }
  }

  if ('document_ocr_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 document_ocr_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.document_ocr_route = readDocumentOcrRoute(value.document_ocr_route, {
        modelName,
        hasDocumentOcrCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'document_ocr_route 无效',
      };
    }
  }

  if ('transcription_route' in value) {
    const modelName = value.model_name;
    if (typeof modelName !== 'string') {
      return {
        success: false,
        reason: '更新 transcription_route 时必须同时提交 model_name',
      };
    }
    try {
      patch.transcription_route = readTranscriptionRoute(value.transcription_route, {
        modelName,
        hasAudioTranscriptionCapability: true,
      });
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'transcription_route 无效',
      };
    }
  }

  if (
    'model_name' in value &&
    !('inference_route' in value) &&
    !('embedding_route' in value) &&
    !('reranking_route' in value) &&
    !('image_generation_route' in value) &&
    !('document_ocr_route' in value) &&
    !('transcription_route' in value)
  ) {
    return {
      success: false,
      reason: '更新 model_name 时必须原子更新对应的推理 route',
    };
  }

  return { success: true, patch };
}
