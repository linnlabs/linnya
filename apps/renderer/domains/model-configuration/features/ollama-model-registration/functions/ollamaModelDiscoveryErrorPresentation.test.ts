import { describe, expect, it } from 'vitest';
import { OllamaModelDiscoveryError } from '../definitions/ollamaModelDiscoveryError';
import { resolveOllamaModelDiscoveryErrorPresentation } from './ollamaModelDiscoveryErrorPresentation';
import type { SettingsMessageResolver } from '@/domains/settings/public';

const message: SettingsMessageResolver = (key, params) => {
  if (key === 'settings.addModel.ollama.connectionTarget') {
    return ` target=${params?.target}`;
  }
  if (key === 'settings.addModel.ollama.statusCode') {
    return ` status=${params?.statusCode}`;
  }
  return key;
};

describe('resolveOllamaModelDiscoveryErrorPresentation', () => {
  it('maps connection failures without exposing raw detail', () => {
    const error = new OllamaModelDiscoveryError({
      code: 'CONNECTION_FAILED',
      target: 'http://localhost:11434',
    });

    expect(resolveOllamaModelDiscoveryErrorPresentation(error, message)).toBe(
      'settings.addModel.ollama.connectionFailed target=http://localhost:11434'
    );
  });

  it('maps timeout failures', () => {
    expect(
      resolveOllamaModelDiscoveryErrorPresentation(
        new OllamaModelDiscoveryError({ code: 'TIMEOUT' }),
        message
      )
    ).toBe('settings.addModel.ollama.timeout');
  });

  it('uses the localized unknown fallback for generic errors', () => {
    expect(resolveOllamaModelDiscoveryErrorPresentation(new Error('raw detail'), message)).toBe(
      'settings.addModel.ollama.unknownRefreshError'
    );
  });
});
