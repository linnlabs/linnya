import type { ModelCatalogItem } from '../../model-catalog';
import type { ModelBindingSlot } from '../definitions/modelPurposeBindings';

export function modelHasCapability(model: ModelCatalogItem, capability: string): boolean {
  return model.capabilities?.includes(capability) === true;
}

export function modelHasVisibility(model: ModelCatalogItem, visibility: string): boolean {
  return model.ui_visibility?.includes(visibility) === true;
}

export function isDocumentUploadOcrModel(model: ModelCatalogItem): boolean {
  return (
    modelHasCapability(model, 'pdf_ocr_default') ||
    (modelHasCapability(model, 'document_ocr') &&
      model.document_ocr_route?.mode === 'document_upload')
  );
}

export function modelSupportsBindingSlot(model: ModelCatalogItem, slot: ModelBindingSlot): boolean {
  if (slot === 'primary') {
    return modelHasVisibility(model, 'chat') || modelHasCapability(model, 'chat');
  }
  if (slot === 'embedding') return modelHasCapability(model, 'embedding');
  if (slot === 'rerank') return modelHasCapability(model, 'rerank');
  if (slot === 'pdf_ocr') return isDocumentUploadOcrModel(model);
  if (slot === 'image_vision') return modelHasCapability(model, 'vision');
  if (slot === 'image_generation') return modelHasCapability(model, 'image_generation');
  return modelHasCapability(model, 'audio_transcription');
}
