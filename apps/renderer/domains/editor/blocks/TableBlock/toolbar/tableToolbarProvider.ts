import { CellSelection } from '@tiptap/pm/tables';
import type { ToolbarProvider, ToolbarContext, ToolbarButton } from '../../../features/floating-toolbar/types';
import TableSimpleToolbar from './TableSimpleToolbar.vue';

export const tableToolbarProvider: ToolbarProvider = {
  name: 'table-toolbar',
  weight: 90,
  override: true,

  shouldShow: (context: ToolbarContext) => {
    const { selection } = context.editor.state;
    return selection instanceof CellSelection;
  },

  getItems: (context: ToolbarContext): ToolbarButton[] => {
    return [
      {
        id: 'table-simple-toolbar',
        component: TableSimpleToolbar,
        props: {
          editor: context.editor,
        },
      },
    ];
  },
};
