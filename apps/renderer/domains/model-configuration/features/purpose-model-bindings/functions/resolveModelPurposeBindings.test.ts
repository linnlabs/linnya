import { describe, expect, it } from 'vitest';

import type { ModelCatalogItem } from '../../model-catalog';
import type { ModelPurposeSelections } from '../definitions/modelPurposeBindings';
import {
  findAuxiliaryModelPurposeDefinition,
  ModelPurposeDefaultStrategy,
} from '../definitions/modelPurposes';
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
        catalog_source: 'user',
        capabilities: ['chat'],
        ui_visibility: ['chat'],
        reasoning: { supported_efforts: ['low', 'high'], default_effort: 'high' },
      },
    ];
    const resolutionContext = context(models, { primaryReasoningEffort: 'xhigh' });

    expect(resolvePrimaryModelId(resolutionContext)).toBe('reasoner');
    expect(resolvePrimaryReasoningEffort(resolutionContext)).toBe('high');
  });

  it('默认目录里的开发模型不会成为隐式主模型', () => {
    const models: ModelCatalogItem[] = [
      { id: 'mock-debug-chat', catalog_source: 'default', capabilities: ['chat'], ui_visibility: ['chat1'] },
    ];

    expect(resolvePrimaryModelId(context(models))).toBeNull();
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

  describe('对话标题模型', () => {
    const chatModels: ModelCatalogItem[] = [
      { id: 'primary-a', catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] },
      { id: 'primary-b', catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] },
      { id: 'title-flash', catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] },
    ];

    it('未单独选择标题模型时跟随主模型，主模型变化后继续跟随', () => {
      expect(resolveAuxiliaryModelId(
        context(chatModels, { primaryModelId: 'primary-a' }),
        'conversation_title'
      )).toBe('primary-a');
      expect(resolveAuxiliaryModelId(
        context(chatModels, { primaryModelId: 'primary-b' }),
        'conversation_title'
      )).toBe('primary-b');
    });

    it('主模型未显式选择时，标题跟随主模型的有效默认值', () => {
      expect(resolveAuxiliaryModelId(context(chatModels), 'conversation_title')).toBe(
        resolvePrimaryModelId(context(chatModels))
      );
      expect(resolveAuxiliaryModelId(context(chatModels), 'conversation_title')).toBe('primary-a');
    });

    it('显式选择的标题模型优先于主模型', () => {
      expect(resolveAuxiliaryModelId(
        context(chatModels, {
          primaryModelId: 'primary-a',
          auxiliaryModelIds: { conversation_title: 'title-flash' },
        }),
        'conversation_title'
      )).toBe('title-flash');
    });

    it('清除显式选择后回到跟随主模型', () => {
      const selected = context(chatModels, {
        primaryModelId: 'primary-b',
        auxiliaryModelIds: { conversation_title: 'title-flash' },
      });
      const cleared = context(chatModels, {
        primaryModelId: 'primary-b',
        auxiliaryModelIds: { conversation_title: null },
      });

      expect(resolveAuxiliaryModelId(selected, 'conversation_title')).toBe('title-flash');
      expect(resolveAuxiliaryModelId(cleared, 'conversation_title')).toBe('primary-b');
    });

    it('标题模型与主模型都不可用时没有有效模型，也不会借用其他用途默认值', () => {
      const devOnly: ModelCatalogItem[] = [
        { id: 'mock-debug-chat', catalog_source: 'default', capabilities: ['chat'], ui_visibility: ['chat'] },
      ];

      expect(resolveAuxiliaryModelId(context([]), 'conversation_title')).toBeNull();
      expect(resolveAuxiliaryModelId(context(devOnly), 'conversation_title')).toBeNull();
    });

    it('默认策略被声明为跟随主模型，设置页据此提供“使用主模型”选项', () => {
      expect(findAuxiliaryModelPurposeDefinition('conversation_title')?.defaultStrategy).toBe(
        ModelPurposeDefaultStrategy.PRIMARY_MODEL
      );
    });
  });
});
