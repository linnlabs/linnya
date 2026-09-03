// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockVisibilityManager } from './useBlockVisibilityManager';
import { createShellBlockVisibilityBridge } from './useShellBlockVisibilityBridge';
import {
  publishRootBlockNodeViewMounted,
  publishRootBlockNodeViewUnmounted,
  resetRootBlockNodeViewLifecycleRegistry,
} from '../../features/RenderVirtualization/state/nodeViewLifecycle';

const owner = {};

function createVisibilityManagerMock(): BlockVisibilityManager {
  return {
    getBlockVisibilityState: vi.fn(),
    getBlockVisibilityRef: vi.fn(),
    registerBlockVisibility: vi.fn(),
    unregisterBlockVisibility: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    resetObserver: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as BlockVisibilityManager;
}

describe('createShellBlockVisibilityBridge', () => {
  afterEach(() => {
    resetRootBlockNodeViewLifecycleRegistry(owner);
  });

  it('registers root block shell DOM nodes with the shared visibility manager', () => {
    const root = document.createElement('div');
    const blockA = document.createElement('div');
    blockA.className = 'root-block-outer';
    blockA.dataset.id = 'block-a';
    const blockB = document.createElement('div');
    blockB.className = 'root-block-outer';
    blockB.dataset.id = 'block-b';
    root.append(blockA, blockB);
    publishRootBlockNodeViewMounted({ blockId: 'block-a', mode: 'hydrated', dom: blockA }, owner);
    publishRootBlockNodeViewMounted({ blockId: 'block-b', mode: 'hydrated', dom: blockB }, owner);

    const visibilityManager = createVisibilityManagerMock();
    const bridge = createShellBlockVisibilityBridge({
      getEditorRoot: () => root,
      owner,
      visibilityManager,
    });

    bridge.refresh();

    expect(bridge.getObservedCount()).toBe(2);
    expect(visibilityManager.registerBlockVisibility).toHaveBeenCalledWith('block-a', blockA);
    expect(visibilityManager.registerBlockVisibility).toHaveBeenCalledWith('block-b', blockB);

    blockB.remove();
    publishRootBlockNodeViewUnmounted({ blockId: 'block-b', mode: 'hydrated', dom: blockB }, owner);

    expect(bridge.getObservedCount()).toBe(1);
    expect(visibilityManager.unregisterBlockVisibility).toHaveBeenCalledWith('block-b', blockB);
  });

  it('only observes hydrated root block DOM when virtualization replaces a NodeView', async () => {
    const root = document.createElement('div');
    const oldBlock = document.createElement('div');
    oldBlock.className = 'root-block-outer root-block-virtual-placeholder';
    oldBlock.dataset.id = 'block-a';
    oldBlock.dataset.rootBlockRenderMode = 'placeholder';
    root.append(oldBlock);
    publishRootBlockNodeViewMounted(
      { blockId: 'block-a', mode: 'placeholder', dom: oldBlock },
      owner
    );

    const visibilityManager = createVisibilityManagerMock();
    const bridge = createShellBlockVisibilityBridge({
      getEditorRoot: () => root,
      owner,
      visibilityManager,
    });

    bridge.refresh();
    expect(bridge.getObservedCount()).toBe(0);
    expect(visibilityManager.registerBlockVisibility).not.toHaveBeenCalledWith('block-a', oldBlock);

    const newBlock = document.createElement('div');
    newBlock.className = 'root-block-outer is-hydrated';
    newBlock.dataset.id = 'block-a';
    newBlock.dataset.rootBlockRenderMode = 'hydrated';
    root.replaceChild(newBlock, oldBlock);
    publishRootBlockNodeViewUnmounted(
      {
        blockId: 'block-a',
        mode: 'placeholder',
        dom: oldBlock,
      },
      owner
    );
    publishRootBlockNodeViewMounted({ blockId: 'block-a', mode: 'hydrated', dom: newBlock }, owner);

    expect(visibilityManager.unregisterBlockVisibility).not.toHaveBeenCalledWith(
      'block-a',
      oldBlock
    );
    expect(visibilityManager.registerBlockVisibility).toHaveBeenCalledWith('block-a', newBlock);
    expect(bridge.getObservedCount()).toBe(1);

    bridge.cleanup();
  });

  it('unregisters a hydrated block when it is replaced by a placeholder', () => {
    const root = document.createElement('div');
    const hydratedBlock = document.createElement('div');
    hydratedBlock.className = 'root-block-outer is-hydrated';
    hydratedBlock.dataset.id = 'block-a';
    hydratedBlock.dataset.rootBlockRenderMode = 'hydrated';
    root.append(hydratedBlock);
    publishRootBlockNodeViewMounted(
      {
        blockId: 'block-a',
        mode: 'hydrated',
        dom: hydratedBlock,
      },
      owner
    );

    const visibilityManager = createVisibilityManagerMock();
    const bridge = createShellBlockVisibilityBridge({
      getEditorRoot: () => root,
      owner,
      visibilityManager,
    });

    bridge.refresh();
    expect(bridge.getObservedCount()).toBe(1);

    const placeholderBlock = document.createElement('div');
    placeholderBlock.className = 'root-block-outer root-block-virtual-placeholder';
    placeholderBlock.dataset.id = 'block-a';
    placeholderBlock.dataset.rootBlockRenderMode = 'placeholder';
    root.replaceChild(placeholderBlock, hydratedBlock);
    publishRootBlockNodeViewMounted(
      {
        blockId: 'block-a',
        mode: 'placeholder',
        dom: placeholderBlock,
      },
      owner
    );

    expect(visibilityManager.unregisterBlockVisibility).toHaveBeenCalledWith(
      'block-a',
      hydratedBlock
    );
    expect(bridge.getObservedCount()).toBe(0);

    bridge.cleanup();
  });
});
