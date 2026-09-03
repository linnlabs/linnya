// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { RootBlockRuntimeHandle } from '../../../features/RenderVirtualization';
import { resolveBlockChromeRenderTargets } from './resolveBlockChromeRenderTargets';

function createHandle(anchorElement: HTMLElement | null): RootBlockRuntimeHandle {
  const dom = document.createElement('div');
  const contentDom = document.createElement('div');

  return {
    blockId: 'root-a',
    mode: 'hydrated',
    getDom: () => dom,
    getContentDom: () => contentDom,
    getChromeAnchor: () => anchorElement,
    getPos: () => 0,
    getRect: () => null,
    measure: () => null,
  };
}

describe('resolveBlockChromeRenderTargets', () => {
  it('为有 chrome anchor 的 render plan 生成 Teleport 目标', () => {
    const anchor = document.createElement('div');

    const targets = resolveBlockChromeRenderTargets({
      plans: [{
        blockId: 'root-a',
        sources: ['hovered'],
        surfaces: ['left-handle'],
        targetReady: true,
      }],
      getRuntimeHandle: () => createHandle(anchor),
    });

    expect(targets).toEqual([{
      plan: {
        blockId: 'root-a',
        sources: ['hovered'],
        surfaces: ['left-handle'],
        targetReady: true,
      },
      anchorElement: anchor,
    }]);
  });

  it('跳过未水合或缺少 chrome anchor 的 render plan', () => {
    const targets = resolveBlockChromeRenderTargets({
      plans: [
        {
          blockId: 'root-a',
          sources: ['hovered'],
          surfaces: ['left-handle'],
          targetReady: false,
        },
        {
          blockId: 'root-b',
          sources: ['focused'],
          surfaces: ['left-handle'],
          targetReady: false,
        },
      ],
      getRuntimeHandle: (blockId) => {
        if (blockId === 'root-a') return createHandle(null);
        return null;
      },
    });

    expect(targets).toEqual([]);
  });
});

