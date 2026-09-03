// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { RootBlockRuntimeHandle } from '../../../features/RenderVirtualization';
import { resolveBlockChromeHostSurfaceTargets } from './resolveBlockChromeHostSurfaceTargets';

function createRuntimeDom(): {
  rootBlockOuter: HTMLElement;
  rootBlock: HTMLElement;
  chromeAnchor: HTMLElement;
  revisionHeaderMount: HTMLElement;
} {
  const rootBlockOuter = document.createElement('div');
  rootBlockOuter.className = 'root-block-outer';
  const rootBlock = document.createElement('div');
  rootBlock.className = 'root-block';
  const chromeAnchor = document.createElement('div');
  chromeAnchor.className = 'root-block-chrome-anchor';
  const revisionHeaderMount = document.createElement('div');
  revisionHeaderMount.className = 'root-block-revision-header-mount';

  rootBlock.append(chromeAnchor, revisionHeaderMount);
  rootBlockOuter.append(rootBlock);
  document.body.append(rootBlockOuter);

  return {
    rootBlockOuter,
    rootBlock,
    chromeAnchor,
    revisionHeaderMount,
  };
}

function createHandle(
  blockId: string,
  dom: ReturnType<typeof createRuntimeDom>
): RootBlockRuntimeHandle {
  return {
    blockId,
    mode: 'hydrated',
    getDom: () => dom.rootBlockOuter,
    getContentDom: () => dom.rootBlock,
    getChromeAnchor: () => dom.chromeAnchor,
    getRevisionHeaderMount: () => dom.revisionHeaderMount,
    getPos: () => 42,
    getRect: () => null,
    measure: () => null,
  };
}

describe('resolveBlockChromeHostSurfaceTargets', () => {
  it('集中解析 Host surface 的 Teleport 目标', () => {
    const dom = createRuntimeDom();
    const handle = createHandle('root-a', dom);

    const targets = resolveBlockChromeHostSurfaceTargets({
      shouldRender: true,
      renderPlans: [{
        blockId: 'root-a',
        sources: ['hovered', 'revision-toolbar', 'history-mode'],
        surfaces: ['left-handle', 'annotation-handle', 'revision-toolbar', 'history-panel'],
        targetReady: true,
      }],
      hydratedRevisionIndicatorBlockIds: ['root-a'],
      getRuntimeHandle: (blockId) => blockId === 'root-a' ? handle : null,
    });

    expect(targets.map((target) => target.kind)).toEqual([
      'left-handle',
      'annotation-handle',
      'revision-indicator',
      'revision-toolbar',
      'history-panel',
    ]);
    expect(targets.map((target) => target.blockId)).toEqual([
      'root-a',
      'root-a',
      'root-a',
      'root-a',
      'root-a',
    ]);
    expect(targets[0]?.mountElement).toBe(dom.chromeAnchor);
    expect(targets[1]?.mountElement).toBe(dom.rootBlock);
    expect(targets[2]?.mountElement).toBe(dom.revisionHeaderMount);
    expect(targets[3]?.mountElement).toBe(dom.rootBlock);
    expect(targets[4]?.mountElement).toBe(dom.rootBlock);
    expect(new Set(targets.map((target) => target.key)).size).toBe(targets.length);
  });

  it('Host 关闭时不读取 runtime handle', () => {
    let readCount = 0;
    const targets = resolveBlockChromeHostSurfaceTargets({
      shouldRender: false,
      renderPlans: [{
        blockId: 'root-a',
        sources: ['hovered'],
        surfaces: ['left-handle'],
        targetReady: true,
      }],
      hydratedRevisionIndicatorBlockIds: ['root-a'],
      getRuntimeHandle: () => {
        readCount += 1;
        return null;
      },
    });

    expect(targets).toEqual([]);
    expect(readCount).toBe(0);
  });

  it('allows revision indicator to render from hydrated pending header ids without an active chrome plan', () => {
    const dom = createRuntimeDom();
    const handle = createHandle('root-pending', dom);

    const targets = resolveBlockChromeHostSurfaceTargets({
      shouldRender: true,
      renderPlans: [],
      hydratedRevisionIndicatorBlockIds: ['root-pending'],
      getRuntimeHandle: (blockId) => blockId === 'root-pending' ? handle : null,
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(expect.objectContaining({
      kind: 'revision-indicator',
      blockId: 'root-pending',
      mountElement: dom.revisionHeaderMount,
    }));
    expect(targets[0]?.key).toMatch(/^revision-indicator:root-pending:mount-\d+$/);
  });

  it('keeps Teleport targets for runtime DOM that has not been attached yet', () => {
    const dom = createRuntimeDom();
    const handle = createHandle('root-detached', dom);
    dom.rootBlockOuter.remove();

    const targets = resolveBlockChromeHostSurfaceTargets({
      shouldRender: true,
      renderPlans: [{
        blockId: 'root-detached',
        sources: ['hovered', 'revision-toolbar', 'history-mode'],
        surfaces: ['left-handle', 'annotation-handle', 'revision-toolbar', 'history-panel'],
        targetReady: true,
      }],
      hydratedRevisionIndicatorBlockIds: ['root-detached'],
      getRuntimeHandle: (blockId) => blockId === 'root-detached' ? handle : null,
    });

    expect(targets.map((target) => target.kind)).toEqual([
      'left-handle',
      'annotation-handle',
      'revision-indicator',
      'revision-toolbar',
      'history-panel',
    ]);
    expect(targets[2]?.mountElement).toBe(dom.revisionHeaderMount);
  });

  it('changes surface keys when the same block id is mounted into a new DOM target', () => {
    const firstDom = createRuntimeDom();
    const secondDom = createRuntimeDom();
    const firstHandle = createHandle('root-a', firstDom);
    const secondHandle = createHandle('root-a', secondDom);
    const input = {
      shouldRender: true,
      renderPlans: [{
        blockId: 'root-a',
        sources: ['hovered'],
        surfaces: ['left-handle'],
        targetReady: true,
      }],
      hydratedRevisionIndicatorBlockIds: [],
    };

    const firstTargets = resolveBlockChromeHostSurfaceTargets({
      ...input,
      getRuntimeHandle: () => firstHandle,
    });
    const secondTargets = resolveBlockChromeHostSurfaceTargets({
      ...input,
      getRuntimeHandle: () => secondHandle,
    });

    expect(firstTargets).toHaveLength(1);
    expect(secondTargets).toHaveLength(1);
    expect(firstTargets[0]?.key).not.toBe(secondTargets[0]?.key);
  });
});
