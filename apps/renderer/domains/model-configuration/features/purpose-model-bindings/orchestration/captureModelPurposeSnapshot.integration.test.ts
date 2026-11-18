import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { PromptKeys } from '@app/schemas';
import { useModelCatalogStore } from '../../model-catalog';
import {
  captureModelPurposeSnapshot,
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
} from './modelPurposeBindings';

describe('captureModelPurposeSnapshot', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('复用设置页实际有效选择；设置变化只影响下一轮，不改变已经捕获的ID', () => {
    const catalog = useModelCatalogStore();
    catalog.replaceSnapshot({
      models: [
        { id: 'embedding-default', catalog_source: 'user', capabilities: ['embedding'] },
        { id: 'embedding-selected', catalog_source: 'user', capabilities: ['embedding'] },
        { id: 'ocr-selected', catalog_source: 'user', capabilities: ['pdf_ocr_default'] },
        { id: 'vision-selected', catalog_source: 'user', capabilities: ['vision'] },
        { id: 'graph-selected', catalog_source: 'user', capabilities: ['chat'] },
      ],
      purposeDefaults: {}, cloudModelsReady: true,
    });
    setModelPurposeBinding('embedding', 'embedding-selected');
    setModelPurposeBinding('pdf_ocr', 'ocr-selected');
    setModelPurposeBinding('image_vision', 'vision-selected');
    setAuxiliaryModelPurposeBinding(PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION, 'graph-selected');
    const first = captureModelPurposeSnapshot();
    setModelPurposeBinding('embedding', 'embedding-default');
    expect(first).toEqual({
      embeddingModelId: 'embedding-selected', pdfOcrModelId: 'ocr-selected',
      imageVisionModelId: 'vision-selected', graphExtractionModelId: 'graph-selected',
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(captureModelPurposeSnapshot().embeddingModelId).toBe('embedding-default');
    catalog.replaceSnapshot({ models: [], purposeDefaults: {}, cloudModelsReady: true });
    expect(captureModelPurposeSnapshot()).toEqual({
      embeddingModelId: null, pdfOcrModelId: null, imageVisionModelId: null, graphExtractionModelId: null,
    });
    expect(first.embeddingModelId).toBe('embedding-selected');
  });
});
