import { describe, expect, it } from 'vitest';

import { evaluateRemotePluginCompatibility } from './evaluateRemotePluginCompatibility';

describe('evaluateRemotePluginCompatibility', () => {
  it('允许兼容的 Renderer UI minor 更新复用既有插件 range', () => {
    expect(evaluateRemotePluginCompatibility({
      appVersion: '0.0.38',
      rendererUiVersion: '1.8.4',
      requirement: {
        minApp: '0.0.36',
        rendererUi: '^1.0.0',
      },
    })).toEqual({ compatible: true });
  });

  it('区分应用版本与 Renderer UI major 不兼容', () => {
    expect(evaluateRemotePluginCompatibility({
      appVersion: '0.0.35',
      rendererUiVersion: '1.0.0',
      requirement: { minApp: '0.0.36', rendererUi: '^1.0.0' },
    })).toMatchObject({ compatible: false, reason: 'app-version' });

    expect(evaluateRemotePluginCompatibility({
      appVersion: '0.0.38',
      rendererUiVersion: '1.0.0',
      requirement: { rendererUi: '^2.0.0' },
    })).toMatchObject({
      compatible: false,
      reason: 'renderer-ui',
      detail: '当前 Renderer UI 版本 1.0.0 不满足插件要求 ^2.0.0',
    });
  });
});
