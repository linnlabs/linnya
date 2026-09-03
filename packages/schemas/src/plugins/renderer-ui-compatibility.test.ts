import { describe, expect, it } from 'vitest';

import {
  evaluateRendererUiCompatibility,
  isValidRendererUiCompatibilityRange,
} from './renderer-ui-compatibility';

describe('Renderer UI compatibility', () => {
  it('采用 node-semver range 处理 patch、minor 与 major 边界', () => {
    expect(evaluateRendererUiCompatibility('1.0.0', '^1.0.0').compatible).toBe(true);
    expect(evaluateRendererUiCompatibility('1.8.4', '^1.0.0').compatible).toBe(true);
    expect(evaluateRendererUiCompatibility('2.0.0', '^1.0.0')).toMatchObject({
      compatible: false,
      reason: 'not-satisfied',
    });
    expect(evaluateRendererUiCompatibility('1.2.3', '>=1 <2').compatible).toBe(true);
  });

  it('拒绝空、非法 range 和无法解析的 Host version', () => {
    expect(isValidRendererUiCompatibilityRange('')).toBe(false);
    expect(isValidRendererUiCompatibilityRange('not-a-range')).toBe(false);
    expect(evaluateRendererUiCompatibility('1.0.0', 'not-a-range')).toMatchObject({
      compatible: false,
      reason: 'invalid-range',
    });
    expect(evaluateRendererUiCompatibility('dev', '^1.0.0')).toMatchObject({
      compatible: false,
      reason: 'invalid-host-version',
    });
  });

  it('预发布版本必须被 range 显式接纳', () => {
    expect(evaluateRendererUiCompatibility('1.1.0-beta.1', '^1.0.0')).toMatchObject({
      compatible: false,
      reason: 'not-satisfied',
    });
    expect(evaluateRendererUiCompatibility('1.1.0-beta.1', '^1.1.0-beta.1').compatible).toBe(true);
  });
});
