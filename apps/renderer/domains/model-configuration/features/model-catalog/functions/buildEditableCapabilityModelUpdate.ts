import type { ModelCatalogItem } from '../definitions/modelCatalog';
import type { EditableLanguageModelUpdateResult } from '../definitions/editableLanguageModel';

/** 非对话模型不拥有聊天容量或视觉开关；只替换模型身份并保留原协议参数。 */
export function buildEditableCapabilityModelUpdate(
  model: Readonly<ModelCatalogItem>,
  form: { readonly displayName: string; readonly modelName: string }
): EditableLanguageModelUpdateResult {
  const displayName = form.displayName.trim();
  if (!displayName) return { ok: false, issue: 'display_name_required' };
  const modelName = form.modelName.trim();
  if (!modelName) return { ok: false, issue: 'model_name_required' };
  if (
    !model.embedding_route &&
    !model.reranking_route &&
    !model.image_generation_route &&
    !model.document_ocr_route
  ) {
    return { ok: false, issue: 'model_route_missing' };
  }
  return {
    ok: true,
    command: {
      display_name: displayName,
      model_name: modelName,
      ...(model.embedding_route
        ? { embedding_route: { ...model.embedding_route, endpoint_model_id: modelName } }
        : {}),
      ...(model.reranking_route
        ? { reranking_route: { ...model.reranking_route, endpoint_model_id: modelName } }
        : {}),
      ...(model.image_generation_route
        ? {
            image_generation_route: {
              ...model.image_generation_route,
              endpoint_model_id: modelName,
            },
          }
        : {}),
      ...(model.document_ocr_route
        ? { document_ocr_route: { ...model.document_ocr_route, endpoint_model_id: modelName } }
        : {}),
    },
  };
}
