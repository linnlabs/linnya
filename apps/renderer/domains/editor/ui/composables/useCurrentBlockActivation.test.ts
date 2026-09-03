import { describe, expect, it } from 'vitest';
import { createDefaultBlockActivation } from './useCurrentBlockActivation';

describe('useCurrentBlockActivation', () => {
  it('默认激活契约包含完整 UseBlockActivationReturn 字段', () => {
    const activation = createDefaultBlockActivation();

    expect(activation.isUiActive.value).toBe(true);
    expect(activation.activationMask.value).toBe(0);
    expect(activation.activationReasons.value).toEqual([]);
    expect(activation.renderHandles.value).toBe(true);
    expect(activation.renderAnnotation.value).toBe(true);
    expect(activation.renderRevisionChrome.value).toBe(true);
    expect(activation.renderRevisionToolbar.value).toBe(true);
    expect(activation.renderHistory.value).toBe(true);
  });
});
