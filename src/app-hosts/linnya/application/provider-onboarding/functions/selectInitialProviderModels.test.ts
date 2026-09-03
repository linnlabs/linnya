import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import { describe, expect, it } from 'vitest';

import { selectInitialProviderModels } from './selectInitialProviderModels';

function model(
  id: string,
  releaseDate: string,
  releaseStatus: ProviderModelDefinition['release_status'] = 'active'
): ProviderModelDefinition {
  return {
    id,
    display_name: id,
    release_status: releaseStatus,
    release_date: releaseDate,
    context_window_tokens: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 8_000,
    capabilities: { image_input: false, tool_call: true, reasoning: true },
  };
}

describe('selectInitialProviderModels', () => {
  it('首次连接只选择三个最新稳定模型，预览模型留给模型管理', () => {
    expect(
      selectInitialProviderModels([
        model('stable-old', '2026-01-01'),
        model('preview-new', '2026-12-01', 'preview'),
        model('stable-newest', '2026-08-01'),
        model('stable-middle', '2026-06-01'),
        model('stable-new', '2026-07-01'),
      ]).map(candidate => candidate.id)
    ).toEqual(['stable-newest', 'stable-new', 'stable-middle']);
  });
});
