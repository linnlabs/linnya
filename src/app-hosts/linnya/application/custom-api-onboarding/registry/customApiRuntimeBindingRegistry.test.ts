import { describe, expect, it } from 'vitest';
import {
  CUSTOM_API_FORMAT_DEFINITIONS,
  readCustomApiFormatRouteProfileId,
} from '@app/schemas/custom-api-onboarding';

import { readCustomApiRuntimeBinding } from './customApiRuntimeBindingRegistry';

describe('custom API runtime binding registry', () => {
  it('覆盖全部公开格式且与共享 route profile 真源一致', () => {
    for (const definition of CUSTOM_API_FORMAT_DEFINITIONS) {
      const binding = readCustomApiRuntimeBinding(definition.id);
      expect(binding.api_format).toBe(definition.id);
      expect(binding.route_profile_id).toBe(readCustomApiFormatRouteProfileId(definition.id));
    }
  });
});
