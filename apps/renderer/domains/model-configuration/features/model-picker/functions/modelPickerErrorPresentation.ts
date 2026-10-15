import type { SettingsMessageResolver } from '@/domains/settings/public';
import type { ModelPickerOperationError } from '../definitions/modelPicker';

export function resolveModelPickerErrorPresentation(
  error: ModelPickerOperationError,
  message: SettingsMessageResolver
): string {
  if (error.outcome === 'source-refreshed-synchronization-failed') {
    return message('settings.modelPicker.refreshedSyncFailed', { source: error.sourceLabel });
  }
  return error.detail ?? message('settings.modelPicker.failure');
}
