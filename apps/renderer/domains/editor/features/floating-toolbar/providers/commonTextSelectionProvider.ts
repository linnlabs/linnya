import { TextSelection, AllSelection } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';
import type { ToolbarProvider, ToolbarContext, ToolbarButton } from '../types';
import TextSelectionToolbar from '../ui/TextSelectionToolbar.vue';

export const commonTextSelectionProvider: ToolbarProvider = {
  name: 'common-text-selection',
  weight: 50,

  shouldShow: (context: ToolbarContext) => {
    const { selection } = context.editor.state;

    // 不在表格单元格多选时才显示
    if (selection instanceof CellSelection) return false;

    // 只在非空的文本选区时显示
    if (selection.empty) return false;

    return selection instanceof TextSelection || selection instanceof AllSelection;
  },

  getItems: (context: ToolbarContext): ToolbarButton[] => {
    return [
      {
        id: 'common-text-toolbar',
        component: TextSelectionToolbar,
        props: {
          editor: context.editor,
        },
      },
    ];
  },
};

