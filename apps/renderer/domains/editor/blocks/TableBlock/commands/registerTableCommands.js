/**
 * 表格命令注册模块
 * 
 * 本文件负责将所有表格相关命令注册到编辑器实例上
 * TableBlock.js 不再直接导入和注册命令，而是调用本模块提供的注册函数
 */

import {
  insertTableCustom,
  addRowBeforeCustom,
  addRowAfterCustom,
  addColumnBeforeCustom,
  addColumnAfterCustom
} from './tableCoreOperations';

/**
 * 注册表格核心命令
 * 
 * @param {Object} parentCommands - 父级命令（如果有）
 * @returns {Object} 包含所有注册命令的对象
 */
export function registerCoreTableCommands(parentCommands = {}) {
  // 保存原始命令工厂函数（一次性创建，供后续使用）
  const originalCommandFactoryFromAddColumnBefore = addColumnBeforeCustom(); 
  const originalCommandFactoryFromAddColumnAfter = addColumnAfterCustom();

  // 返回注册的命令
  return {
    ...parentCommands,
    insertTable: (options) => insertTableCustom(options),
    addRowAfter: addRowAfterCustom,
    addRowBefore: addRowBeforeCustom,

    addColumnBefore: () => { 
      return (props) => { 
        if (!props || typeof props.tr === 'undefined') {
          return false; 
        }
        
        const result = originalCommandFactoryFromAddColumnBefore(props); 
        return result;
      };
    },

    addColumnAfter: () => { 
      return (props) => { 
        if (!props || typeof props.tr === 'undefined') {
          return false;
        }

        const result = originalCommandFactoryFromAddColumnAfter(props);
        return result;
      };
    },
    
    // 使用默认的splitCell命令，不再覆盖
    // splitCell: splitCellCustom,
  };
}

/**
 * 注册其他表格命令（如删除、合并等）
 * 
 * 未来可以扩展此函数，注册更多命令
 * @param {Object} commands - 已有的命令对象
 * @returns {Object} 增强后的命令对象
 */
export function registerExtendedTableCommands(commands = {}) {
  // 这里可以注册更多命令
  return {
    ...commands,
    // 示例：
    // deleteTableCommand: deleteTableCustom,
  };
}

/**
 * 注册所有表格命令的便捷函数
 * 
 * @param {Object} parentCommands - 父级命令（如果有）
 * @returns {Object} 包含所有表格命令的对象
 */
export function registerAllTableCommands(parentCommands = {}) {
  const coreCommands = registerCoreTableCommands(parentCommands);
  return registerExtendedTableCommands(coreCommands);
} 