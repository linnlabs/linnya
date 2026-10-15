import type { DiscoveredModel } from '@app/schemas';
import type { NewCustomApiDiscoveredModel } from '../definitions/customApiProviderRefreshTarget';

/** 以同一连接内的远端 ID 去重；刷新不能覆盖用户容量、显示名或重新启用已关闭的模型。 */
export function selectNewCustomApiModels(
  discovered: readonly DiscoveredModel[],
  existingRemoteModelIds: ReadonlySet<string>
): NewCustomApiDiscoveredModel[] {
  const seen = new Set(existingRemoteModelIds);
  return discovered.flatMap(model => {
    if (seen.has(model.id)) return [];
    seen.add(model.id);
    const item = {
      endpoint_model_id: model.id,
      display_name: model.name,
      context_window_tokens: model.context_window_tokens,
      max_output_tokens: model.max_output_tokens,
      supports_image_input: model.supports_image_input,
    };
    return [{ ...item, picker_enabled: false }];
  });
}
