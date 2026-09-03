// @vitest-environment jsdom

import { computed, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBlockViewRuntimeHandle,
  findRootBlockContentElement,
  readRootBlockPosForRuntimeHandle,
  resolveBlockViewOuterElement,
  useBlockViewRuntimeHandle,
  type BlockViewOuterElementSource,
} from './useBlockViewRuntimeHandle';
import {
  getRootBlockRuntimeRegistry,
  resetRootBlockRuntimeRegistry,
} from '../../features/RenderVirtualization/runtime/RootBlockRuntimeRegistry';

describe('useBlockViewRuntimeHandle', () => {
  const runtimeOwner = {};

  afterEach(() => {
    resetRootBlockRuntimeRegistry(runtimeOwner);
  });

  it('解析 HTMLElement 或 Vue 组件根元素，不需要穿透式类型断言', () => {
    const outerEl = document.createElement('div');

    expect(resolveBlockViewOuterElement(outerEl)).toBe(outerEl);
    expect(resolveBlockViewOuterElement({ $el: outerEl })).toBe(outerEl);
    expect(resolveBlockViewOuterElement({ $el: {} })).toBeNull();
    expect(resolveBlockViewOuterElement(null)).toBeNull();
  });

  it('只把 root-block 下的 content 元素作为 contentDOM', () => {
    const rootBlockEl = document.createElement('div');
    const toolbarEl = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.className = 'content';

    rootBlockEl.append(toolbarEl, contentEl);

    expect(findRootBlockContentElement(rootBlockEl)).toBe(contentEl);
    expect(findRootBlockContentElement(null)).toBeNull();
  });

  it('生成旧 BlockView 的 hydrated runtime handle', () => {
    const outerEl = document.createElement('div');
    const contentEl = document.createElement('div');
    const anchorEl = document.createElement('div');

    const handle = createBlockViewRuntimeHandle({
      blockId: 'root-a',
      getRootBlockOuterEl: () => outerEl,
      getRootBlockContentEl: () => contentEl,
      getChromeAnchor: () => anchorEl,
      getPos: () => 10,
    });

    expect(handle.blockId).toBe('root-a');
    expect(handle.mode).toBe('hydrated');
    expect(handle.getDom()).toBe(outerEl);
    expect(handle.getContentDom()).toBe(contentEl);
    expect(handle.getChromeAnchor()).toBe(anchorEl);
    expect(handle.getPos()).toBe(10);
  });

  it('注册、替换并清理 per-owner runtime handle', () => {
    const outerEl = document.createElement('div');
    const rootBlockEl = document.createElement('div');
    const contentEl = document.createElement('div');
    const historyMountEl = document.createElement('div');
    contentEl.className = 'content';
    rootBlockEl.append(contentEl);

    const blockId = ref('root-a');
    const runtimeHandle = useBlockViewRuntimeHandle({
      blockId: computed(() => blockId.value),
      rootBlockOuterRef: ref<BlockViewOuterElementSource>(outerEl),
      rootBlockRef: ref(rootBlockEl),
      historyMountRef: ref(historyMountEl),
      getPos: () => 20,
      runtimeRegistryOwner: runtimeOwner,
    });
    const registry = getRootBlockRuntimeRegistry(runtimeOwner);

    runtimeHandle.refreshRootBlockRuntimeHandle();

    expect(registry.getHydrated('root-a')?.getDom()).toBe(outerEl);
    expect(registry.getHydrated('root-a')?.getContentDom()).toBe(contentEl);
    expect(registry.getHydrated('root-a')?.getChromeAnchor()).toBe(historyMountEl);

    blockId.value = 'root-b';
    runtimeHandle.refreshRootBlockRuntimeHandle();

    expect(registry.getHydrated('root-a')).toBeNull();
    expect(registry.getHydrated('root-b')?.getPos()).toBe(20);

    runtimeHandle.cleanupRootBlockRuntimeHandle();

    expect(registry.getHydrated('root-b')).toBeNull();
  });

  it('getPos 在 NodeView 生命周期边界失效时显式返回 null', () => {
    expect(readRootBlockPosForRuntimeHandle(() => Number.NaN)).toBeNull();
    expect(readRootBlockPosForRuntimeHandle(() => {
      throw new Error('stale getPos');
    })).toBeNull();
  });
});
