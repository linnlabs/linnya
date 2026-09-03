// src/renderer/extensions/annotation/BlockEventHandler.js
/**
 * BlockEventHandler.js
 * 
 * 块操作事件处理器 - 负责监听块级别的操作事件，维护批注数据的完整性
 * 
 * 主要职责：
 * 1. 维护批注数据的完整性 (删除、复制、拆分、合并等操作)
 * 2. 处理与特定块操作相关的批注逻辑
 * 3. 保证 annotationStore 中数据与文档结构的一致性
 * 
 * 与 AnnoLayoutPlugin.js 的职责区分：
 * - BlockEventHandler: 处理具体的块操作事件，维护批注数据的增删改
 * - AnnoLayoutPlugin: 监听文档结构整体变化，仅处理批注位置的重新计算
 * 
 * 这两个模块协同工作：
 * - BlockEventHandler 确保批注数据的业务完整性 (数据层面)
 * - AnnoLayoutPlugin 确保批注面板的视觉正确性 (UI层面)
 */

import { BlockAction } from '../../shared/utils/blockEventUtils'; // 导入 Action 常量
import { deleteBlockAnnotations } from './commands/AnnoDeleteCommands'; // 导入批注删除命令

/**
 * 设置块操作事件监听器，用于协调批注状态。
 * 注意: 位置重新计算由 AnnoLayoutPlugin 自动处理，此处仅关注数据维护
 *
 * @param {object} editor - Tiptap 编辑器实例 (需要包含 eventBus)
 * @param {object} annotationStore - useAnnotationStore 返回的实例
 * @param {object} panelPositionManager - AnnoLayoutManager 返回的实例
 * @returns {Function|null} - 清理函数，用于取消事件监听，如果设置失败则返回 null
 */
export function setupBlockEventHandler(editor, annotationStore, panelPositionManager) {
  const eventBus = editor?.eventBus;

  if (!eventBus || !eventBus.on || !eventBus.off) {
    console.error('[BlockEventHandler] 设置失败：editor.eventBus 无效。');
    return null;
  }

  if (!annotationStore) {
    console.error('[BlockEventHandler] 设置失败：annotationStore 无效。');
    return null;
  }
   if (!panelPositionManager) {
    console.error('[BlockEventHandler] 设置失败：panelPositionManager 无效。');
    return null;
  }

  // 定义事件处理函数
  const handleBlockOperation = async (detail) => {
    if (!detail || !detail.action || !detail.blockIds) {
      console.warn('[BlockEventHandler] 收到无效的 block-operation 事件:', detail);
      return;
    }

    const { action, blockIds, payload } = detail;

    switch (action) {
      case BlockAction.DELETE:
        // 处理删除操作
        if (blockIds.length > 0) {
          // 对每个被删除的 blockId 调用批注清理
          for (const blockId of blockIds) {
            try {
              // 调用批注删除命令，传入必要的依赖
              // 注意：此处不仅更新位置，还会删除存储中的批注数据
              await deleteBlockAnnotations({
                blockId,
                annotationStore,
                panelPositionManager
              });
            } catch (error) {
              console.error(`[BlockEventHandler] 清理块 ${blockId} 批注时捕获到错误:`, error);
            }
          }
        }
        break;

      case BlockAction.MOVE:
        // 简化：不再处理移动操作的位置更新，这已由 AnnoLayoutPlugin 负责
        // 只记录日志，如有特殊批注数据维护需求，可在此添加
        if (blockIds.length > 0) {
          console.log(`[BlockEventHandler] 块移动事件，blockIds:`, blockIds);
          
          // 如果将来需要在块移动时进行特殊的数据处理（非位置计算），
          // 可以在这里添加相关代码
          // 例如：更新批注的引用关系、修改批注元数据等
        }
        break;

      case BlockAction.COPY:
        // TODO: 处理复制操作 - 根据 payload 复制批注
        // 这是 BlockEventHandler 独有的功能，AnnoLayoutPlugin 无法处理批注的复制逻辑
        console.log('[BlockEventHandler] TODO: 处理块复制事件', { blockIds, payload });
        // 示例: copyAnnotations(payload.originalBlockId, payload.newBlockId, annotationStore);
        break;

      case BlockAction.SPLIT:
         // TODO: 处理拆分操作 - 决定批注归属
         // 这是 BlockEventHandler 独有的功能，AnnoLayoutPlugin 无法处理批注的拆分归属
         console.log('[BlockEventHandler] TODO: 处理块拆分事件', { blockIds, payload });
        break;

       case BlockAction.MERGE:
         // 注意：合并操作通常也会触发被合并块的 'delete' 事件。
         // 如果需要对合并本身做特殊处理（比如合并批注内容），可以在这里添加逻辑。
         // 这是 BlockEventHandler 独有的功能，AnnoLayoutPlugin 无法处理批注的合并逻辑
         break;

      default:
        console.warn(`[BlockEventHandler] 未知的 block operation action: ${action}`);
    }
  };

  // 订阅事件
  eventBus.on('block-operation', handleBlockOperation);

  // 返回清理函数
  return () => {
    eventBus.off('block-operation', handleBlockOperation);
  };
}
