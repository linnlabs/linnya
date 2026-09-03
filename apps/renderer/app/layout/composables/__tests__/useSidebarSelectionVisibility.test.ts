// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useUIStore } from '@/shared/stores/ui';
import { useWorkspaceSelectionStore } from '@/domains/workspace/store/WorkspaceSelectionStore';
import { useSidebarSelectionVisibility } from '../useSidebarSelectionVisibility';

describe('useSidebarSelectionVisibility', () => {
  let scope: EffectScope;

  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
    scope.run(() => {
      useSidebarSelectionVisibility();
    });
  });

  afterEach(() => {
    scope.stop();
  });

  it('左侧侧边栏显隐不影响当前可见文档的 tab 选中态', async () => {
    const uiStore = useUIStore();
    const layoutStore = useLayoutStore();
    const selectionStore = useWorkspaceSelectionStore();

    layoutStore.openDocument({
      id: 'doc-1',
      projectId: 'project-1',
      type: 'editor',
    });
    selectionStore.selectSingle('doc-1');

    uiStore.sidebarVisible = false;
    await nextTick();

    expect([...selectionStore.selectedNodeIds]).toEqual(['doc-1']);
    expect(selectionStore.lastSelectedNodeId).toBe('doc-1');
    expect(layoutStore.state.activeDocument?.id).toBe('doc-1');

    uiStore.sidebarVisible = true;
    await nextTick();

    expect([...selectionStore.selectedNodeIds]).toEqual(['doc-1']);
    expect(selectionStore.lastSelectedNodeId).toBe('doc-1');
    expect(layoutStore.state.activeDocument?.id).toBe('doc-1');
  });

  it('收起右侧文档 pane 时清 selection，重新展开时恢复当前文档 tab 选中态', async () => {
    const layoutStore = useLayoutStore();
    const selectionStore = useWorkspaceSelectionStore();

    layoutStore.openDocumentInRightPane({
      id: 'doc-1',
      projectId: 'project-1',
      type: 'editor',
    });
    selectionStore.selectSingle('doc-1');

    layoutStore.toggleWorkspaceRightPaneVisibility();
    await nextTick();

    expect(selectionStore.selectedNodeIds.size).toBe(0);
    expect(selectionStore.lastSelectedNodeId).toBeNull();
    expect(layoutStore.state.activeDocument?.id).toBe('doc-1');

    layoutStore.toggleWorkspaceRightPaneVisibility();
    await nextTick();

    expect([...selectionStore.selectedNodeIds]).toEqual(['doc-1']);
    expect(selectionStore.lastSelectedNodeId).toBe('doc-1');
    expect(layoutStore.state.activeDocument?.id).toBe('doc-1');
  });

  it('文档在主区时收起右侧对话 pane 不会清掉文档 tab 选中态', async () => {
    const layoutStore = useLayoutStore();
    const selectionStore = useWorkspaceSelectionStore();

    layoutStore.openDocument({
      id: 'doc-main',
      projectId: 'project-1',
      type: 'editor',
    });
    selectionStore.selectSingle('doc-main');

    layoutStore.toggleWorkspaceRightPaneVisibility();
    await nextTick();

    expect([...selectionStore.selectedNodeIds]).toEqual(['doc-main']);
    expect(selectionStore.lastSelectedNodeId).toBe('doc-main');
    expect(layoutStore.state.activeDocument?.id).toBe('doc-main');
  });
});
