import type { ModelCatalogItem } from '../definitions/modelCatalog';
import type {
  EditableLanguageModelForm,
  EditableLanguageModelUpdateResult,
} from '../definitions/editableLanguageModel';
import { setImageInputCapability } from './modelInputCapability';
import {
  buildConfigurableLanguageModelRoute,
  parseModelTokenLimits,
  resolveConfigurableLanguageRouteProfileId,
} from '../../inference-endpoints';

/**
 * 从详情表单构造一次原子的模型 route 更新。
 *
 * 容量与 route 其他身份字段一起提交，避免目录顶层字段和推理 route 在一次编辑后分叉。
 */
export function buildEditableLanguageModelUpdate(
  model: Readonly<ModelCatalogItem>,
  form: Readonly<EditableLanguageModelForm>
): EditableLanguageModelUpdateResult {
  const displayName = form.displayName.trim();
  if (!displayName) return { ok: false, issue: 'display_name_required' };

  const modelName = form.modelName.trim();
  if (!modelName) return { ok: false, issue: 'model_name_required' };

  if (!model.inference_route) return { ok: false, issue: 'inference_route_missing' };

  const tokenLimits = parseModelTokenLimits(form.contextWindowTokens, form.maxOutputTokens);
  if (!tokenLimits) return { ok: false, issue: 'token_limits_invalid' };

  const capabilities = setImageInputCapability(model.capabilities, form.supportsImageInput);
  const targetProfileId = form.protocolProfileId ?? resolveConfigurableLanguageRouteProfileId(model.inference_route);
  return {
    ok: true,
    command: {
      display_name: displayName,
      model_name: modelName,
      capabilities,
      inference_route: buildConfigurableLanguageModelRoute({
        profile_id: targetProfileId,
        endpoint_id: model.inference_route.endpoint_id,
        endpoint_model_id: modelName,
        base_url: model.inference_route.base_url,
        auth_profile: model.inference_route.auth_profile,
        context_window_tokens: tokenLimits.contextWindowTokens,
        max_output_tokens: tokenLimits.maxOutputTokens,
        supports_image_input: form.supportsImageInput,
      }),
    },
  };
}
