// src/renderer/extensions/interaction/commands/RemoveCommands.js
/**
 * RemoveCommands.js
 * 提供块的删除命令。
 * 核心职责：根据传入信息（ID或位置）定位块，执行删除，并在成功后触发事件。
 */
import { NodeFinder } from '../../position/NodeFinder'; // 用于 pos -> block 查找
import { emitBlockOperation, BlockAction } from '../../../shared/utils/blockEventUtils';
import { findBlockById as findBlockByIdQuery } from './BlockQueryCommands'; // 用于 id -> block 定位

/**
 * 内部辅助函数：执行删除并触发事件
 * @param {object} props - 命令属性 { editor, tr, dispatch }
 * @param {string} blockId - 要删除的块 ID
 * @param {number} pos - 块的起始位置
 * @param {number} nodeSize - 块的大小
 * @returns {boolean} - 操作是否成功 (对于 dispatch === true 的情况)
 */
function executeDeleteAndEmit(props, blockId, pos, nodeSize) {
  const { editor, tr, dispatch } = props;
  try {
    // 1. 标记删除范围
    tr.deleteRange(pos, pos + nodeSize);

    // 2. 分发事务
    if (dispatch) {
       // 检查是否有实际变化才 dispatch
       // （注意：即使文档未变，如果目标块确实是要删的那个，也可能需要发事件，
       //   取决于业务逻辑。这里保持之前的逻辑：文档改变才发事件）
       if (!tr.docChanged) {
           console.log(`[RemoveCommands] executeDeleteAndEmit: 事务未改变文档 (块 ${blockId} 可能已被删除)。`);
           return false; // 返回 false 表示没有成功执行新的删除
       }
      dispatch(tr);
      // 注意：这里不再手动发射 emitBlockOperation 事件。
      // 因为系统已经有 BlockLifecycleExtension 插件，它会监听 docChanged，
      // 自动对比前后的 rootBlock ID，并统一发射 BlockAction.DELETE 事件。
      // 避免重复发射导致批注等系统执行两次清理逻辑。
      console.log(`[RemoveCommands] executeDeleteAndEmit: 块 ${blockId} 已删除 (事件将由 BlockLifecycle 自动触发)。`);
      return true; // 返回 true 表示成功执行了删除
    } else {
      // 检查是否可执行
      // 只要能找到有效的 pos 和 nodeSize 就认为可执行
      return pos !== -1 && nodeSize > 0;
    }
  } catch (error) {
    console.error(`[RemoveCommands] executeDeleteAndEmit: 删除块 (ID: ${blockId}) 时出错:`, error);
    return false;
  }
}

/**
 * 删除指定ID的块
 * @param {String|Object} blockIdOrObject - 块ID或包含ID的对象
 * @returns {Function} - 命令函数
 */
export const deleteBlockById = (blockIdOrObject) => (props) => {
  const blockId = typeof blockIdOrObject === 'object' ? blockIdOrObject.id : blockIdOrObject;
  if (!blockId) return false;

  // 1. 使用查询命令根据 ID 定位节点 { node, pos }
  const nodeInfo = findBlockByIdQuery(blockId, 'rootBlock')(props);

  if (!nodeInfo) {
    console.warn(`[RemoveCommands] deleteBlockById: 未定位到 ID 为 ${blockId} 的 rootBlock 节点。`);
    return false; // 定位失败，无法执行
  }

  // 2. 执行删除和事件触发
  return executeDeleteAndEmit(props, blockId, nodeInfo.pos, nodeInfo.node.nodeSize);
};


/**
 * 删除指定位置所在的根块
 * 这是唯一需要根据位置确定 ID 的命令
 * @param {Number} pos - 块内的位置
 * @returns {Function} - 命令函数
 */
export const deleteBlock = (pos) => (props) => {
  const { editor } = props;
  let blockId = null;
  let blockPos = -1;
  let nodeSize = 0;

  console.log(`[RemoveCommands] deleteBlock: 开始尝试删除位置 ${pos} 的块`);
  
  // 根据位置确定rootBlock
  try {
      const resolvedPos = editor.state.doc.resolve(pos);
      console.log(`[RemoveCommands] 位置 ${pos} 解析为: depth=${resolvedPos.depth}`);
      
      // 记录位置处的所有节点层次
      for (let d = resolvedPos.depth; d >= 0; d--) {
          const node = resolvedPos.node(d);
          console.log(`[RemoveCommands] depth=${d}: 节点类型=${node.type.name}, ID=${node.attrs?.id || '无ID'}`);
          
          if (node.type.name === 'rootBlock') {
              blockId = node.attrs.id;
              blockPos = resolvedPos.start(d);
              nodeSize = node.nodeSize;
              console.log(`[RemoveCommands] 找到rootBlock: ID=${blockId}, 位置=${blockPos}, 大小=${nodeSize}`);
              break;
          }
      }
  } catch (error) {
      console.error(`[RemoveCommands] deleteBlock: 查找位置 ${pos} 的块时出错:`, error);
      return false;
  }

  if (!blockId || blockPos === -1) {
    console.warn(`[RemoveCommands] deleteBlock: 未能在位置 ${pos} 找到有效的 rootBlock。`);
    return false;
  }

  console.log(`[RemoveCommands] 准备删除块: ID=${blockId}, 位置=${blockPos}, 大小=${nodeSize}`); 

  // 执行删除和事件触发
  return executeDeleteAndEmit(props, blockId, blockPos, nodeSize);
};


/**
 * 批量删除多个块
 * @param {Array<string>} blocksToRemove - 要删除的块ID数组
 * @returns {Function} - 返回命令函数
 */
export const removeBlocks = (blocksToRemove) => (props) => {
  const { editor, tr, dispatch } = props;
  const validIdsToDelete = []; // 存储实际找到并准备删除的 ID
  const rangesToDelete = [];   // 存储这些 ID 对应的位置范围

  if (!Array.isArray(blocksToRemove) || blocksToRemove.length === 0) {
    return []; // 无效输入
  }

  try {
    // 1. 根据传入的 ID 定位所有有效块的位置
    for (const blockId of blocksToRemove) {
      if (!blockId) continue;
      const nodeInfo = findBlockByIdQuery(blockId, 'rootBlock')(props);
      if (nodeInfo) {
        validIdsToDelete.push(blockId); // 存 ID
        rangesToDelete.push({ from: nodeInfo.pos, to: nodeInfo.pos + nodeInfo.node.nodeSize }); // 存位置
      } else {
         console.warn(`[RemoveCommands] removeBlocks: 未定位到 ID ${blockId} 的 rootBlock 节点。`);
      }
    }

    if (rangesToDelete.length === 0) {
      console.log('[RemoveCommands] removeBlocks: 未找到任何可删除的块。');
      return []; // 没有找到任何块
    }

    // 2. 按位置降序排序并标记删除范围
    rangesToDelete.sort((a, b) => b.from - a.from);
    rangesToDelete.forEach(range => {
      tr.deleteRange(range.from, range.to);
    });

    // 3. 分发事务并检查成功
    if (dispatch) {
      if (!tr.docChanged) {
         console.log('[RemoveCommands] removeBlocks: 事务未改变文档。');
         return []; // 未实际删除
      }
      dispatch(tr);
      // 注意：这里不再手动发射 emitBlockOperation 事件。
      // 因为系统已经有 BlockLifecycleExtension 插件，它会监听 docChanged，
      // 自动对比前后的 rootBlock ID，并统一发射 BlockAction.DELETE 事件。
      // 避免重复发射导致批注等系统执行两次清理逻辑。
      console.log(`[RemoveCommands] removeBlocks: 块 ${validIdsToDelete.join(', ')} 已删除 (事件将由 BlockLifecycle 自动触发)。`);
      return validIdsToDelete; // 返回成功删除的 ID 数组
    } else {
      // 检查是否可执行
      return rangesToDelete.length > 0;
    }

  } catch (error) {
    console.error('[RemoveCommands] removeBlocks: 批量删除块时出错:', error);
    return []; // 出错则返回空数组
  }
};

// 兼容性别名
export const removeBlocksCommand = removeBlocks;

// 导出
export default {
  deleteBlock,
  deleteBlockById,
  removeBlocks,
  removeBlocksCommand
};
