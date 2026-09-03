import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearBackendTextMeasurementRuntimeDependenciesForTesting,
  getBackendTextMeasurementRuntimeDependencies,
  installBackendTextMeasurementRuntimeDependencies,
  type BackendTextMeasurementRuntimeDependencies,
} from '..';

afterEach(clearBackendTextMeasurementRuntimeDependenciesForTesting);

describe('Backend text measurement runtime registry', () => {
  it('冻结同一 App owner 的唯一测量 runtime 输入', () => {
    const dependencies = createDependencies();
    installBackendTextMeasurementRuntimeDependencies(dependencies);
    installBackendTextMeasurementRuntimeDependencies(dependencies);

    expect(getBackendTextMeasurementRuntimeDependencies()).toBe(dependencies);
    expect(() => installBackendTextMeasurementRuntimeDependencies(createDependencies()))
      .toThrow('已安装另一实现');
  });
});

function createDependencies(): BackendTextMeasurementRuntimeDependencies {
  const dependencies: BackendTextMeasurementRuntimeDependencies = {
    worker: Object.freeze({
      availability: { available: true },
      measureBatch: vi.fn(),
      measureClusterAdvancesBatch: vi.fn(),
      touch: vi.fn(),
    }),
    useBrowserPretext: true,
    useHarfBuzz: true,
  };
  return Object.freeze(dependencies);
}
