import { describe, expect, it } from 'vitest';

import type { ModelCatalogItem } from '../../model-catalog';
import type { ModelPurposeSelections } from '../definitions/modelPurposeBindings';
import {
  resolveAuxiliaryModelId,
  resolveImageGenerationModelId,
  resolveImageVisionModelId,
  resolvePrimaryModelId,
  resolvePrimaryReasoningEffort,
  type ModelPurposeResolutionContext,
} from './resolveModelPurposeBindings';

const emptySelections: ModelPurposeSelections = {
  primaryModelId: null,
  primaryReasoningEffort: null,
  auxiliaryModelIds: {},
  embeddingModelId: null,
  rerankModelId: null,
  pdfOcrModelId: null,
  imageVisionModelId: null,
  imageGenerationModelId: null,
  transcriptionModelId: null,
};

function context(
  models: readonly ModelCatalogItem[],
  selections: Partial<ModelPurposeSelections> = {},
  cloudModelsReady = false
): ModelPurposeResolutionContext {
  return {
    models,
    purposeDefaults: { autocomplete: 'cloud-fast' },
    cloudModelsReady,
    selections: { ...emptySelections, ...selections },
  };
}

describe('model purpose resolution', () => {
  it('主模型选择、默认值和 reasoning 降级共享同一个目录快照', () => {
    const models: ModelCatalogItem[] = [
      {
        id: 'reasoner',
        catalog_source: 'default',
        capabilities: ['chat'],
        ui_visibility: ['chat'],
        reasoning: { supported_efforts: ['low', 'high'], default_effort: 'high' },
      },
    ];
    const resolutionContext = context(models, { primaryReasoningEffort: 'xhigh' });

    expect(resolvePrimaryModelId(resolutionContext)).toBe('reasoner');
    expect(resolvePrimaryReasoningEffort(resolutionContext)).toBe('high');
  });

  it('云目录确认后才把已消失的云选择切到当前 purpose default', () => {
    const models: ModelCatalogItem[] = [
      { id: 'primary', catalog_source: 'default', capabilities: ['chat'] },
      { id: 'cloud-fast', catalog_source: 'default', capabilities: ['chat'] },
    ];
    const selections = { auxiliaryModelIds: { autocomplete: 'cloud-removed' } };

    expect(resolveAuxiliaryModelId(context(models, selections, false), 'autocomplete')).toBeNull();
    expect(resolveAuxiliaryModelId(context(models, selections, true), 'autocomplete')).toBe(
      'cloud-fast'
    );
  });

  it('图片理解默认值优先避开文档上传 OCR 模型', () => {
    const models: ModelCatalogItem[] = [
      {
        id: 'document-ocr',
        catalog_source: 'default',
        capabilities: ['vision', 'document_ocr'],
        ui_visibility: ['vision'],
        document_ocr_route: {
          api_surface: 'paddle_layout_parsing',
          capability_id: 'host:paddle-ocr-layout-parsing',
          endpoint_id: 'paddleocr',
          endpoint_model_id: 'document-ocr',
          base_url: 'https://example.test/layout-parsing',
          auth_profile: 'token',
          mode: 'document_upload',
          supports_abort_signal: true,
          attempt_timeout_ms: 300_000,
        },
      },
      {
        id: 'page-vision',
        catalog_source: 'default',
        capabilities: ['vision'],
        ui_visibility: ['vision'],
      },
    ];

    expect(resolveImageVisionModelId(context(models))).toBe('page-vision');
  });

  it('图片生成在没有显式选择时使用目录中的有效默认模型', () => {
    const models: ModelCatalogItem[] = [
      {
        id: 'image-default',
        catalog_source: 'default',
        capabilities: ['image_generation'],
        ui_visibility: ['image_generation'],
      },
      {
        id: 'image-selected',
        catalog_source: 'default',
        capabilities: ['image_generation'],
        ui_visibility: ['image_generation'],
      },
    ];

    expect(resolveImageGenerationModelId(context(models))).toBe('image-default');
    expect(resolveImageGenerationModelId(context(models, {
      imageGenerationModelId: 'image-selected',
    }))).toBe('image-selected');
  });

  it('目录中没有图片生成模型时不制造默认绑定', () => {
    const models: ModelCatalogItem[] = [
      { id: 'chat-only', catalog_source: 'default', capabilities: ['chat'] },
    ];

    expect(resolveImageGenerationModelId(context(models))).toBeNull();
  });
});
