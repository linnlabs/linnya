import { describe, expect, it } from 'vitest';

import publicCatalog from '../../../generated/provider-catalog.generated.json';
import runtimeBindings from '../../../generated/provider-runtime-bindings.generated.json';
import { assertProviderCatalogProjectionConsistency } from '../assertProviderCatalogProjectionConsistency';

describe('assertProviderCatalogProjectionConsistency', () => {
  it('接纳当前同代的 public catalog 与 runtime binding', () => {
    expect(() =>
      assertProviderCatalogProjectionConsistency(publicCatalog, runtimeBindings)
    ).not.toThrow();
  });

  it('拒绝 generation 或 source digest 不一致的双投影', () => {
    expect(() =>
      assertProviderCatalogProjectionConsistency(publicCatalog, {
        ...runtimeBindings,
        generation_id: 'different-generation',
      })
    ).toThrow(/generation 不一致/);

    expect(() =>
      assertProviderCatalogProjectionConsistency(publicCatalog, {
        ...runtimeBindings,
        source_sha256: 'f'.repeat(64),
      })
    ).toThrow(/source digest 不一致/);
  });

  it('拒绝只存在于 runtime binding 的模型 route', () => {
    expect(() =>
      assertProviderCatalogProjectionConsistency(publicCatalog, {
        ...runtimeBindings,
        bindings: runtimeBindings.bindings.map(binding =>
          binding.provider_definition_id === 'openai'
            ? {
                ...binding,
                model_route_bindings: [
                  {
                    model_id: 'not-in-public-catalog',
                    base_url: binding.default_base_url,
                    route_profile_id: binding.default_route_profile_id,
                  },
                ],
              }
            : binding
        ),
      })
    ).toThrow(/runtime 模型未进入公开目录/);
  });
});
