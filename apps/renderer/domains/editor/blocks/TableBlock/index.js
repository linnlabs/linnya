/**
 * TableBlock 特性的主入口和导出文件
 */

// 核心表格节点
export { TableBlock } from './TableBlock';
export { TableCellContentBlock } from './TableCellContentBlock';
export { CustomTableCell, CustomTableHeader } from './TableCell';

// 扩展
// export { TableBlockExtension } from './extensions/TableBlockExtension';
export { TableCellInteractionExtension } from './extensions/TableCellInteractionExtension';
export { TableColumnResizeExtension } from './extensions/TableColumnResizeExtension';
export { handleEnterKey, handleTabKey, handleShiftTabKey } from './tableKeys';
export { TableKeyboardExtension } from './extensions/TableKeyboardExtension';
export { TableSelectionDecoratorExtension } from './extensions/TableSelectionDecoratorExtension';
export {
  createTableVerticalNavStatePlugin,
  TableVerticalNavigationStateExtension,
} from './extensions/TableVerticalNavigationState';
export { TablePasteExtension } from './extensions/TablePasteExtension';

// 工具栏和UI（在新的 Provider 架构下，统一从 toolbar 目录导出）
export { default as TableFloatingToolbar } from './toolbar/TableSimpleToolbar.vue';
