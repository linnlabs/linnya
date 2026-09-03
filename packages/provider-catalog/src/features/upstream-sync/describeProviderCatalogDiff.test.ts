import { describe, expect, it } from 'vitest';
import type { ProviderCatalogSnapshot } from '../../definitions/providerCatalog';
import { describeProviderCatalogDiff } from './describeProviderCatalogDiff';

function snapshot(
  generationId: string,
  models: readonly {
    readonly id: string;
    readonly contextWindowTokens: number;
  }[]
): ProviderCatalogSnapshot {
  return {
    schema_version: 2,
    generation: {
      id: generationId,
      source_url: 'https://models.dev/api.json',
      source_sha256: 'a'.repeat(64),
      synced_at: '2026-08-21T00:00:00.000Z',
      policy_version: 11,
    },
    providers: [
      {
        id: 'fixture',
        display_name: 'Fixture',
        connections: [
          {
            id: 'fixture',
            display_name: 'Fixture API',
            kind: 'direct',
            release_status: 'stable',
            setup_fields: [],
            model_discovery: 'bundled',
            models: models.map(model => ({
              id: model.id,
              display_name: model.id,
              release_status: 'active',
              context_window_tokens: model.contextWindowTokens,
              max_input_tokens: model.contextWindowTokens - 1_000,
              max_output_tokens: 1_000,
              capabilities: {
                image_input: false,
                tool_call: true,
                reasoning: false,
              },
            })),
          },
        ],
      },
    ],
  };
}

describe('describeProviderCatalogDiff', () => {
  it('分别报告模型新增、删除、容量变化和 runtime binding 变化', () => {
    const previous = snapshot('generation-before', [
      { id: 'removed', contextWindowTokens: 32_000 },
      { id: 'resized', contextWindowTokens: 64_000 },
    ]);
    const next = snapshot('generation-after', [
      { id: 'added', contextWindowTokens: 128_000 },
      { id: 'resized', contextWindowTokens: 256_000 },
    ]);

    expect(describeProviderCatalogDiff(previous, next, true)).toBe(
      [
        'Generation: generation-before -> generation-after',
        'Added models: 1\n  fixture/fixture/added',
        'Removed models: 1\n  fixture/fixture/removed',
        'Changed model limits: 1\n  fixture/fixture/resized',
        'Runtime binding/source observation changed: true',
      ].join('\n')
    );
  });
});
