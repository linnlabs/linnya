import type { ProviderModelDefinition } from '@linnya/provider-catalog';

export const DEFAULT_INITIAL_PROVIDER_MODEL_COUNT = 3;

/**
 * 首次连接只启用少量近期模型，避免把大目录全部写入 Workspace。
 * 其余模型仍完整保留在模型管理中，由用户按需激活。
 */
export function selectInitialProviderModels(
  models: readonly ProviderModelDefinition[],
  limit = DEFAULT_INITIAL_PROVIDER_MODEL_COUNT
): readonly ProviderModelDefinition[] {
  return [...models]
    .sort((left, right) => {
      const statusOrder =
        Number(left.release_status === 'preview') - Number(right.release_status === 'preview');
      if (statusOrder !== 0) return statusOrder;
      const dateOrder = (right.release_date ?? '').localeCompare(left.release_date ?? '');
      if (dateOrder !== 0) return dateOrder;
      return left.display_name.localeCompare(right.display_name);
    })
    .slice(0, limit);
}
