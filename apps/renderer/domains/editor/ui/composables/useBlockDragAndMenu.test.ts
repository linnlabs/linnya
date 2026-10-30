// @vitest-environment jsdom

import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Node } from '@tiptap/core';
import { Editor as VueTiptapEditor } from '@tiptap/vue-3';
import { computed, createApp, effectScope, h, nextTick, ref, type App, type EffectScope } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockActionMenuService } from '../../features/blockActionMenu/service';
import {
  clearAllProviders,
  registerCommonMenuProvider,
} from '../../features/blockActionMenu/registry';
import type { BlockMenuContext, MenuItem } from '../../features/blockActionMenu/types';
import { PositionUtils } from '../../extensions/position/PositionUtils';
import { useBlockDragAndMenu } from './useBlockDragAndMenu';
import BlockLeftHandleGroup from '../components/BlockLeftHandleGroup.vue';

const RootBlock = Node.create({
  name: 'rootBlock',
  group: 'block',
  content: 'paragraph?',

  addAttributes() {
    return {
      id: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-id': HTMLAttributes.id }, 0];
  },
});

const editors: VueTiptapEditor[] = [];
const scopes: EffectScope[] = [];
const mountedHandles: { app: App; host: HTMLElement }[] = [];

function createEditor(): VueTiptapEditor {
  const editor = new VueTiptapEditor({
    extensions: [
      Document.extend({
        content: 'rootBlock*',
      }),
      RootBlock,
      Paragraph,
      Text,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'block-a' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'alpha' }],
            },
          ],
        },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

function requireNode<T>(node: T | null | undefined, label: string): T {
  if (!node) throw new Error(`测试夹具缺少节点：${label}`);
  return node;
}

function createMenuContext(editor: VueTiptapEditor): BlockMenuContext {
  const rootBlockNode = requireNode(editor.state.doc.firstChild, 'rootBlock');
  const contentBlockNode = requireNode(rootBlockNode.firstChild, 'contentBlock');

  return {
    editor,
    rootBlockNode,
    rootBlockPos: 0,
    contentBlockType: contentBlockNode.type.name,
    contentBlockNode,
    contentBlockPos: 1,
  };
}

afterEach(() => {
  blockActionMenuService.close();
  vi.useRealTimers();
  clearAllProviders();
  vi.restoreAllMocks();

  for (const { app, host } of mountedHandles.splice(0)) {
    app.unmount();
    host.remove();
  }

  while (scopes.length > 0) {
    scopes.pop()?.stop();
  }

  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe('useBlockDragAndMenu', () => {
  it('快速关闭菜单会取消待注册的外部监听，重新打开仍能点击外部关闭', async () => {
    vi.useFakeTimers();
    registerCommonMenuProvider({
      name: 'listener-lifecycle-provider',
      getItems: (): MenuItem[] => [{ id: 'duplicate', label: '创建副本' }],
    });
    const editor = createEditor();
    const anchor = document.createElement('button');
    const context = createMenuContext(editor);
    await blockActionMenuService.open(context, anchor);
    blockActionMenuService.close();
    const addListener = vi.spyOn(document, 'addEventListener');

    await vi.runOnlyPendingTimersAsync();
    expect(addListener.mock.calls.filter(([type]) => (
      type === 'click' || type === 'contextmenu'
    ))).toEqual([]);

    await blockActionMenuService.open(context, anchor);
    await vi.runOnlyPendingTimersAsync();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(blockActionMenuService.state.isOpen).toBe(false);
  });

  it.each(['Enter', ' '])('块菜单按钮通过 %s 打开正确的菜单，保持编辑器原选区', async (key) => {
    registerCommonMenuProvider({
      name: 'keyboard-menu-provider',
      getItems: (): MenuItem[] => [{ id: 'duplicate', label: '创建副本' }],
    });
    const editor = createEditor();
    const selection = editor.state.selection;
    const dragHandleRef = ref<HTMLElement | null>(null);
    const scope = effectScope();
    scopes.push(scope);
    const dragState = scope.run(() => useBlockDragAndMenu({
      props: { editor, rootBlockId: computed(() => 'block-a') },
      dragHandleRef,
      hasAnnotations: computed(() => false),
      setBlockSelected: vi.fn(),
    }));
    if (!dragState) throw new Error('Missing drag state');

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () => h(BlockLeftHandleGroup, {
        blockId: 'block-a',
        hasHistory: false,
        onRegisterDragHandle: (element: HTMLElement) => { dragHandleRef.value = element; },
        onMenuOpen: dragState.handleDragHandleKeyboardOpen,
      }),
    });
    app.use(createPinia());
    app.mount(host);
    mountedHandles.push({ app, host });

    const handle = requireNode(dragHandleRef.value, 'menu trigger');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(blockActionMenuService.state.isOpen).toBe(true));

    expect(blockActionMenuService.state.anchorElement).toBe(handle);
    expect(blockActionMenuService.state.context?.rootBlockNode.attrs.id).toBe('block-a');
    expect(editor.state.selection).toBe(selection);
    expect(dragState.isDragging.value).toBe(false);
  });

  it('拖拽结束后释放旧 BlockChrome 手柄产生的临时选中态', () => {
    const editor = createEditor();
    const dragHandle = document.createElement('button');
    const dragHandleRef = ref<HTMLElement | null>(dragHandle);
    const setBlockSelected = vi.fn<(selected: boolean, fromHandle?: boolean) => void>();
    const scope = effectScope();
    scopes.push(scope);
    let dragState: ReturnType<typeof useBlockDragAndMenu> | undefined;

    scope.run(() => {
      dragState = useBlockDragAndMenu({
        props: {
          editor,
          rootBlockId: computed(() => 'block-a'),
        },
        dragHandleRef,
        hasAnnotations: computed(() => false),
        setBlockSelected,
      });
    });

    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
      types: [],
    };
    const dragStart = new Event('dragstart') as DragEvent;
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    dragState?.onDragStart(dragStart);
    expect(dragState?.isDragging.value).toBe(true);

    vi.spyOn(PositionUtils.prototype, 'calculateDragTargetIndex').mockReturnValue(1);
    const dragEnd = new Event('dragend') as DragEvent;
    Object.defineProperties(dragEnd, {
      clientX: { value: -1 },
      clientY: { value: -1 },
    });
    dragState?.onDragEnd(dragEnd);

    expect(dragState?.isDragging.value).toBe(false);
    expect(setBlockSelected).toHaveBeenLastCalledWith(false, true);
    dragState?.cleanupDropIndicator();
  });

  it('菜单关闭后释放旧 BlockChrome 拖拽柄的视觉选中态', async () => {
    registerCommonMenuProvider({
      name: 'test-provider',
      getItems: (): MenuItem[] => [
        {
          id: 'duplicate',
          label: '创建副本',
        },
      ],
    });

    const editor = createEditor();
    const dragHandle = document.createElement('button');
    const dragHandleRef = ref<HTMLElement | null>(dragHandle);
    const setBlockSelected = vi.fn<(selected: boolean, fromHandle?: boolean) => void>();
    const scope = effectScope();
    scopes.push(scope);

    scope.run(() => {
      useBlockDragAndMenu({
        props: {
          editor,
          rootBlockId: computed(() => 'block-a'),
        },
        dragHandleRef,
        hasAnnotations: computed(() => false),
        setBlockSelected,
      });
    });

    await blockActionMenuService.open(createMenuContext(editor), dragHandle);
    await nextTick();
    expect(setBlockSelected).not.toHaveBeenCalledWith(false, true);

    blockActionMenuService.close();
    await nextTick();

    expect(setBlockSelected).toHaveBeenCalledWith(false, true);
  });
});
