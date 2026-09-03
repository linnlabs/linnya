// @vitest-environment jsdom

import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Node } from '@tiptap/core';
import { Editor as VueTiptapEditor } from '@tiptap/vue-3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '../types';
import { blockActionMenuService } from '../service';
import {
  clearAllProviders,
  registerCommonMenuProvider,
} from '../registry';
import {
  openBlockActionMenuForRootBlockId,
  type OpenBlockActionMenuForRootBlockIdInput,
} from './openBlockActionMenuForRootBlockId';

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

function createInput(
  patch: Partial<OpenBlockActionMenuForRootBlockIdInput> = {}
): OpenBlockActionMenuForRootBlockIdInput {
  return {
    editor: createEditor(),
    rootBlockId: 'block-a',
    anchorElement: document.createElement('button'),
    mode: 'open',
    ...patch,
  };
}

afterEach(() => {
  blockActionMenuService.close();
  clearAllProviders();
  vi.restoreAllMocks();
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe('openBlockActionMenuForRootBlockId', () => {
  it('按 blockId 构造上下文并打开菜单', async () => {
    registerCommonMenuProvider({
      name: 'test-provider',
      getItems: (): MenuItem[] => [
        {
          id: 'duplicate',
          label: '创建副本',
        },
      ],
    });

    const input = createInput({
      hasAnnotations: true,
    });
    const result = await openBlockActionMenuForRootBlockId(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('opened');
    expect(blockActionMenuService.state.isOpen).toBe(true);
    expect(blockActionMenuService.state.anchorElement).toBe(input.anchorElement);
    expect(blockActionMenuService.state.context?.rootBlockNode.attrs.id).toBe('block-a');
    expect(blockActionMenuService.state.context?.hasAnnotations).toBe(true);
  });

  it('toggle 模式点击同一个锚点时关闭菜单', async () => {
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
    const anchorElement = document.createElement('button');

    await openBlockActionMenuForRootBlockId({
      editor,
      rootBlockId: 'block-a',
      anchorElement,
      mode: 'open',
    });
    const result = await openBlockActionMenuForRootBlockId({
      editor,
      rootBlockId: 'block-a',
      anchorElement,
      mode: 'toggle',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('closed');
    expect(blockActionMenuService.state.isOpen).toBe(false);
  });

  it('没有菜单项时保持关闭并返回 skipped', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input = createInput();
    const result = await openBlockActionMenuForRootBlockId(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('skipped');
    expect(blockActionMenuService.state.isOpen).toBe(false);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('找不到 blockId 时不上屏菜单并返回明确原因', async () => {
    registerCommonMenuProvider({
      name: 'test-provider',
      getItems: (): MenuItem[] => [
        {
          id: 'duplicate',
          label: '创建副本',
        },
      ],
    });

    const input = createInput({
      rootBlockId: 'missing-block',
    });
    const result = await openBlockActionMenuForRootBlockId(input);

    expect(result).toEqual({
      ok: false,
      reason: 'block-not-found',
      rootBlockId: 'missing-block',
    });
    expect(blockActionMenuService.state.isOpen).toBe(false);
  });
});
