import type { EditorMessageResolver } from '../../../definitions/editorMessages';

export interface TableBlockMenuOption {
  readonly value: string;
  readonly text: string;
  readonly icon?: string;
}

export const alignLeftIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="16" y2="12"></line>
            <line x1="3" y1="18" x2="14" y2="18"></line>
          </svg>`;

export const alignCenterIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="6" y1="12" x2="18" y2="12"></line>
            <line x1="5" y1="18" x2="19" y2="18"></line>
          </svg>`;

export const alignRightIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="10" y1="18" x2="21" y2="18"></line>
          </svg>`;

export function buildTableBlockInsertOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    { value: 'addRowBefore', text: editorMessage('editor.tableBlock.menu.insertRowBefore') },
    { value: 'addRowAfter', text: editorMessage('editor.tableBlock.menu.insertRowAfter') },
    { value: 'addColumnBefore', text: editorMessage('editor.tableBlock.menu.insertColumnBefore') },
    { value: 'addColumnAfter', text: editorMessage('editor.tableBlock.menu.insertColumnAfter') },
  ];
}

export function buildTableBlockDeleteOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    { value: 'deleteRow', text: editorMessage('editor.tableBlock.toolbar.deleteRow') },
    { value: 'deleteColumn', text: editorMessage('editor.tableBlock.toolbar.deleteColumn') },
  ];
}

export function buildTableBlockAiOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    { value: 'aiFill', text: editorMessage('editor.tableBlock.toolbar.aiFill') },
    { value: 'aiAnalyze', text: editorMessage('editor.tableBlock.menu.aiAnalyze') },
  ];
}

export function buildTableBlockAlignOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    {
      value: 'alignLeft',
      text: editorMessage('editor.tableBlock.menu.alignLeft'),
      icon: alignLeftIcon,
    },
    {
      value: 'alignCenter',
      text: editorMessage('editor.tableBlock.menu.alignCenter'),
      icon: alignCenterIcon,
    },
    {
      value: 'alignRight',
      text: editorMessage('editor.tableBlock.menu.alignRight'),
      icon: alignRightIcon,
    },
  ];
}

export function buildTableBlockDebugOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    { value: 'json', text: editorMessage('editor.tableBlock.menu.jsonFormat') },
    { value: 'csv', text: editorMessage('editor.tableBlock.menu.csvFormat') },
    { value: 'markdown', text: editorMessage('editor.tableBlock.menu.markdownTable') },
    { value: 'raw', text: editorMessage('editor.tableBlock.menu.rawData') },
  ];
}

export function buildTableBlockCellOptions(
  editorMessage: EditorMessageResolver,
): ReadonlyArray<TableBlockMenuOption> {
  return [
    { value: 'mergeCells', text: editorMessage('editor.tableBlock.toolbar.mergeCellsTitle') },
    { value: 'splitCell', text: editorMessage('editor.tableBlock.toolbar.splitCellTitle') },
  ];
}

export function formatTableBlockSizeDisplay(
  rows: number,
  cols: number,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.tableBlock.size.display', { rows, cols });
}

export function formatTableBlockReferenceTitle(
  reference: string,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.tableBlock.context.insertReference', { reference });
}

export function formatTableBlockSelectionRangeTitle(
  range: string,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.tableBlock.context.selectionRangeTitle', { range });
}
