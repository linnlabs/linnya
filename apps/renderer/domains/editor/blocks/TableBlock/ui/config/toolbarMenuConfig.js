/**
 * toolbarMenuConfig.js
 * 
 * 此文件提供表格浮动工具栏的菜单配置
 * 包括各种菜单项的选项定义、图标等
 */

import { EDITOR_MESSAGE_FALLBACKS } from '../../../../definitions/editorMessageCatalog';

const tableBlockMessage = (key) => EDITOR_MESSAGE_FALLBACKS[key];

/**
 * 插入操作菜单选项
 */
export const insertOptions = [
  { value: 'addRowBefore', text: tableBlockMessage('editor.tableBlock.menu.insertRowBefore') },
  { value: 'addRowAfter', text: tableBlockMessage('editor.tableBlock.menu.insertRowAfter') },
  { value: 'addColumnBefore', text: tableBlockMessage('editor.tableBlock.menu.insertColumnBefore') },
  { value: 'addColumnAfter', text: tableBlockMessage('editor.tableBlock.menu.insertColumnAfter') }
];

/**
 * 删除操作菜单选项
 */
export const deleteOptions = [
  { value: 'deleteRow', text: tableBlockMessage('editor.tableBlock.toolbar.deleteRow') },
  { value: 'deleteColumn', text: tableBlockMessage('editor.tableBlock.toolbar.deleteColumn') }
];

/**
 * AI功能菜单选项
 */
export const aiOptions = [
  { value: 'aiFill', text: tableBlockMessage('editor.tableBlock.toolbar.aiFill') },
  { value: 'aiAnalyze', text: tableBlockMessage('editor.tableBlock.menu.aiAnalyze') }
];

/**
 * 对齐功能菜单选项
 */
export const alignOptions = [
  { 
    value: 'alignLeft', 
    text: tableBlockMessage('editor.tableBlock.menu.alignLeft'),
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="16" y2="12"></line>
            <line x1="3" y1="18" x2="14" y2="18"></line>
          </svg>`
  },
  { 
    value: 'alignCenter', 
    text: tableBlockMessage('editor.tableBlock.menu.alignCenter'),
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="6" y1="12" x2="18" y2="12"></line>
            <line x1="5" y1="18" x2="19" y2="18"></line>
          </svg>`
  },
  { 
    value: 'alignRight', 
    text: tableBlockMessage('editor.tableBlock.menu.alignRight'),
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="10" y1="18" x2="21" y2="18"></line>
          </svg>`
  }
];

/**
 * 调试功能菜单选项
 * 仅在开发环境下显示
 */
export const debugOptions = [
  { value: 'json', text: tableBlockMessage('editor.tableBlock.menu.jsonFormat') },
  { value: 'csv', text: tableBlockMessage('editor.tableBlock.menu.csvFormat') },
  { value: 'markdown', text: tableBlockMessage('editor.tableBlock.menu.markdownTable') },
  { value: 'raw', text: tableBlockMessage('editor.tableBlock.menu.rawData') }
];

/**
 * 单元格操作菜单选项
 */
export const cellOptions = [
  { value: 'mergeCells', text: tableBlockMessage('editor.tableBlock.toolbar.mergeCellsTitle') },
  { value: 'splitCell', text: tableBlockMessage('editor.tableBlock.toolbar.splitCellTitle') }
];

/**
 * 获取配置中的选项
 * @param {string} optionType - 选项类型
 * @returns {Array} 选项数组
 */
export const getMenuOptions = (optionType) => {
  switch(optionType) {
    case 'insert':
      return insertOptions;
    case 'delete':
      return deleteOptions;
    case 'ai':
      return aiOptions;
    case 'align':
      return alignOptions;
    case 'debug':
      return debugOptions;
    case 'cell':
      return cellOptions;
    default:
      return [];
  }
};

export default {
  insertOptions,
  deleteOptions,
  aiOptions,
  alignOptions,
  debugOptions,
  cellOptions,
  getMenuOptions
};
