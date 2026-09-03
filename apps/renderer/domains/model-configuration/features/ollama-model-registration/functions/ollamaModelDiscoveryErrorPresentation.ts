import type { SettingsMessageResolver } from '@/domains/settings/public';
import { isOllamaModelDiscoveryError } from '../definitions/ollamaModelDiscoveryError';

export function resolveOllamaModelDiscoveryErrorPresentation(
  error: unknown,
  message: SettingsMessageResolver
): string {
  if (!isOllamaModelDiscoveryError(error)) {
    return message('settings.addModel.ollama.unknownRefreshError');
  }

  if (error.code === 'INVALID_URL') {
    return message('settings.addModel.ollama.urlRequired');
  }

  if (error.code === 'NO_MODELS') {
    return message('settings.addModel.ollama.noModels');
  }

  if (error.code === 'TIMEOUT') {
    return message('settings.addModel.ollama.timeout');
  }

  if (error.code === 'STATUS_FAILED') {
    const statusText =
      error.statusCode === undefined
        ? ''
        : message('settings.addModel.ollama.statusCode', {
            statusCode: error.statusCode,
          });
    return `${message('settings.addModel.ollama.statusFailed')}${statusText}`.trim();
  }

  if (error.code === 'CONNECTION_FAILED') {
    const target = error.target
      ? message('settings.addModel.ollama.connectionTarget', { target: error.target })
      : '';
    return `${message('settings.addModel.ollama.connectionFailed')}${target}`.trim();
  }

  return message('settings.addModel.ollama.unknownRefreshError');
}
