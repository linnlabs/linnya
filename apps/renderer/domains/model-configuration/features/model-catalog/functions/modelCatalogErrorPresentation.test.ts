import { describe, expect, it } from 'vitest';
import { resolveModelCatalogErrorPresentation } from './modelCatalogErrorPresentation';
import type { SettingsMessageResolver } from '@/domains/settings/public';

const message: SettingsMessageResolver = (key) => `translated:${key}`;

describe('resolveModelCatalogErrorPresentation', () => {
  it('uses the localized operation message instead of exposing raw technical detail', () => {
    expect(resolveModelCatalogErrorPresentation({ operation: 'load', detail: 'Server unavailable' }, message)).toBe(
      'translated:settings.modelConfig.error.fetchFailed',
    );
  });

  it('uses localized fallback for known model operations', () => {
    expect(resolveModelCatalogErrorPresentation({ operation: 'delete', detail: null }, message)).toBe(
      'translated:settings.modelConfig.error.deleteFailed',
    );
  });
});
