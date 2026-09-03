// @vitest-environment jsdom

import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Node } from '@tiptap/core';
import { Editor as VueTiptapEditor } from '@tiptap/vue-3';
import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockActionMenuService } from '../../features/blockActionMenu/service';
import {
  clearAllProviders,
  registerCommonMenuProvider,
} from '../../features/blockActionMenu/registry';
import type { BlockMenuContext, MenuItem } from '../../features/blockActionMenu/types';
import { useBlockDragAndMenu } from './useBlockDragAndMenu';

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
  clearAllProviders();
  vi.restoreAllMocks();

  while (scopes.length > 0) {
    scopes.pop()?.stop();
  }

  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe('useBlockDragAndMenu', () => {
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
