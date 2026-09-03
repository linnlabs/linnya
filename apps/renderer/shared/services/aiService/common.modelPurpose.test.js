import { describe, expect, it, vi } from 'vitest';

vi.mock('@/domains/model-configuration', () => ({
  isAuxiliaryModelPurposeKey: (key) => key === 'autocomplete',
  readEffectiveAuxiliaryModelPurposeBinding: () => 'autocomplete-model',
  readEffectiveModelPurposeBinding: () => 'primary-model',
}));

import { determineModelId } from './common.js';

describe('determineModelId auxiliary purpose selection', () => {
  it('已注册的辅助用途使用对应的有效模型', () => {
    expect(determineModelId('autocomplete')).toBe('autocomplete-model');
  });

  it('非辅助用途使用当前主模型', () => {
    expect(determineModelId('default')).toBe('primary-model');
  });
});
