// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { readRootBlockIdFromChromeEventTarget } from './readRootBlockIdFromChromeEventTarget';

describe('readRootBlockIdFromChromeEventTarget', () => {
  it('从 rootBlock 子节点归一到 rootBlock id', () => {
    const root = document.createElement('div');
    root.className = 'root-block-outer';
    root.dataset.id = ' root-a ';

    const child = document.createElement('span');
    root.appendChild(child);
    document.body.appendChild(root);

    expect(readRootBlockIdFromChromeEventTarget(child)).toBe('root-a');

    root.remove();
  });

  it('忽略非 rootBlock 事件目标和空 id', () => {
    const loose = document.createElement('div');
    const emptyRoot = document.createElement('div');
    emptyRoot.className = 'root-block-outer';
    emptyRoot.dataset.id = '   ';

    expect(readRootBlockIdFromChromeEventTarget(loose)).toBeNull();
    expect(readRootBlockIdFromChromeEventTarget(emptyRoot)).toBeNull();
    expect(readRootBlockIdFromChromeEventTarget(null)).toBeNull();
  });
});
