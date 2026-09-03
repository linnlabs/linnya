import type { SettingsMessageKey, SettingsMessageResolver } from '@/domains/settings/public';
import type { ModelCatalogError, ModelCatalogOperation } from '../definitions/modelCatalog';

const OPERATION_MESSAGE_KEYS = {
  load: 'settings.modelConfig.error.fetchFailed',
  delete: 'settings.modelConfig.error.deleteFailed',
  update: 'settings.modelConfig.error.updateFailed',
} as const satisfies Readonly<Record<ModelCatalogOperation, SettingsMessageKey>>;

export function resolveModelCatalogErrorPresentation(
  error: ModelCatalogError | null,
  message: SettingsMessageResolver,
): string | null {
  if (!error) return null;
  return message(OPERATION_MESSAGE_KEYS[error.operation]);
}
