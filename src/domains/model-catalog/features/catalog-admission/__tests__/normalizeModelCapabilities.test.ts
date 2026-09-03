import { describe, expect, it } from 'vitest';

import { normalizeModelCapabilities } from '../functions/normalizeModelCapabilities';
import { parseEditableModelPatch } from '../functions/parseEditableModelPatch';

describe('model capability management contracts', () => {
  it('normalizes duplicate capabilities while preserving open extension values and order', () => {
    expect(normalizeModelCapabilities([
      'chat',
      ' image_input ',
      'plugin.custom_capability',
      'image_input',
    ])).toEqual(['chat', 'image_input', 'plugin.custom_capability']);
  });

  it('rejects malformed capability values instead of silently widening model abilities', () => {
    expect(normalizeModelCapabilities('chat')).toBeNull();
    expect(normalizeModelCapabilities(['chat', ''])).toBeNull();
    expect(normalizeModelCapabilities(['chat', 1])).toBeNull();
  });

  it('applies only editable model fields and normalizes capabilities', () => {
    expect(parseEditableModelPatch({
      display_name: 'Vision model',
      capabilities: ['chat', 'image_input', 'image_input'],
      catalog_source: 'must-not-change',
      enabled: false,
    })).toEqual({
      success: true,
      patch: {
        display_name: 'Vision model',
        capabilities: ['chat', 'image_input'],
      },
    });
  });
});
