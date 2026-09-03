import { describe, expect, it } from 'vitest';

import { getWorkspaceSchemaProviders } from './schema-providers';

describe('getWorkspaceSchemaProviders', () => {
  it('only includes host-owned workspace schema providers', () => {
    const providerNames = getWorkspaceSchemaProviders().map((provider) => provider.name);

    expect(providerNames).toEqual(['workspace']);
    expect(providerNames).not.toContain('presentation_document');
    expect(providerNames).not.toContain('sheet_document');
  });
});
