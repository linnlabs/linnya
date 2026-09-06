// src/renderer/share/extensions/interaction/drag/dragUtils.js

/**
 * dragUtils.js
 *
 * 块级别的拖拽工具函数集
 * 主要负责处理单个块（rootBlock）的拖拽开始和结束逻辑
 *
 * 工作流程：
 * 1. handleDragStart: 
 *    - 当用户开始拖拽块时触发
 *    - 将被拖拽块信息发布到 rootBlockDragState
 *    - 设置拖拽视觉状态
 * 
 * 2. handleDragEnd:
 *    - 当拖拽结束时触发
 *    - 获取目标位置
 *    - 执行块移动操作
 *    - 清理拖拽状态
 */

import { PositionUtils } from '../../position/PositionUtils';
import { getBlockPosIndex } from '../../position/blockPosIndex';
import {
  getRootBlockDragStateSnapshot,
  publishRootBlockDragEnd,
  publishRootBlockDragStart,
} from './rootBlockDragState';

const DRAG_ACTION_PERF_HISTORY_LIMIT = 80;
const dragActionPerfHistory = [];

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function publishDragActionPerf(sample) {
  dragActionPerfHistory.push({
    ...sample,
    timestamp: nowMs(),
  });
  if (dragActionPerfHistory.length > DRAG_ACTION_PERF_HISTORY_LIMIT) {
    dragActionPerfHistory.splice(0, dragActionPerfHistory.length - DRAG_ACTION_PERF_HISTORY_LIMIT);
  }

  if (typeof window !== 'undefined' && !window.__EDITOR_DRAG_ACTION_PERF__) {
    window.__EDITOR_DRAG_ACTION_PERF__ = {
      getLast: () => dragActionPerfHistory[dragActionPerfHistory.length - 1] ?? null,
      getHistory: () => [...dragActionPerfHistory],
      clear: () => {
        dragActionPerfHistory.length = 0;
      },
    };
  }
}

function clearDragDomState(event) {
  const currentTarget = event?.currentTarget;
  const blockElement = typeof Element !== 'undefined' && currentTarget instanceof Element
    ? currentTarget.closest('.root-block-outer')
    : null;
  if (blockElement) {
    blockElement.removeAttribute('data-dragging');
  }
  document.body.removeAttribute('data-dragging');
  document.body.removeAttribute('data-dragging-id');
}

export function resolveRootBlockDragSource(state, rootBlockId) {
  if (typeof rootBlockId !== 'string' || rootBlockId.length === 0) {
    return {
      valid: false,
      message: '缺少源块 ID',
    };
  }

  const blockPosIndex = getBlockPosIndex(state.doc);
  const sourcePos = blockPosIndex.get(rootBlockId);
  const sourceNode = typeof sourcePos === 'number' ? state.doc.nodeAt(sourcePos) : null;
  if (!sourceNode || sourceNode.type.name !== 'rootBlock') {
    return {
      valid: false,
      message: '未找到源块',
      sourceId: rootBlockId,
    };
  }

  return {
    valid: true,
    sourceId: rootBlockId,
    sourceNode,
    sourcePos,
    sourceType: sourceNode.type.name,
  };
}

export function handleDragStartByRootBlockId(event, options) {
  const startedAt = nowMs();
  const sourceId = options?.rootBlockId;
  let publishedSourceBlockId = null;
  try {
    const source = resolveRootBlockDragSource(options.editor.state, sourceId);
    if (!source.valid) {
      console.error(`[BlockDrag ${sourceId ?? 'unknown'}] 处理拖拽开始事件失败: ${source.message}`);
      return false;
    }

    // 配置 dataTransfer 对象：使用自定义 MIME，避免浏览器把所选文本当作拖拽数据
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';

      // 关键：仅设置一个自定义数据类型。
      // 因为此时文本选择已被JS禁用，浏览器不会自动填充 text/plain 类型，
      // 从而避免了文本复制和“地球”图标的问题。
      event.dataTransfer.setData('application/x-prosemirror-block', source.sourceId);
    }

    // 设置拖拽视觉状态。拖拽事实源由 rootBlockDragState 维护，避免业务流程依赖 DOM / sessionStorage。
    document.body.setAttribute('data-dragging', 'true');
    document.body.setAttribute('data-dragging-id', source.sourceId);
    publishRootBlockDragStart(source.sourceId, {
      type: source.sourceType,
      pos: source.sourcePos,
    });
    publishedSourceBlockId = source.sourceId;

    // 触发编辑器的 blockDragStart 事件
    if (options.editor) {
      options.editor.emit('blockDragStart', {
        event,
        id: source.sourceId,
        type: source.sourceType,
        position: { pos: source.sourcePos },
      });
    }

    event.stopPropagation();
    const durationMs = nowMs() - startedAt;
    if (durationMs > 8) {
      publishDragActionPerf({
        kind: 'dragstart',
        durationMs: Math.round(durationMs * 10) / 10,
      });
    }
    return true;
  } catch (error) {
    if (publishedSourceBlockId) {
      clearDragDomState(event);
      publishRootBlockDragEnd(publishedSourceBlockId);
    }
    console.error(`[BlockDrag ${sourceId ?? 'unknown'}] 处理拖拽开始事件失败:`, error.message);
    return false;
  }
}

/**
 * 处理块拖拽开始事件
 *
 * @param {DragEvent} event - 拖拽事件对象
 * @param {Object} props - 块组件的属性
 * @param {Object} props.editor - 编辑器实例
 * @param {Object} props.node - 当前块节点
 * @param {Function} props.getPos - 获取当前块位置的函数
 */
export function handleDragStart(event, props) {
  return handleDragStartByRootBlockId(event, {
    editor: props.editor,
    rootBlockId: props.node.attrs.id,
  });
}

/**
 * 验证块移动操作
 * 
 * @param {Object} state - 编辑器状态
 * @param {String} sourceId - 源块ID
 * @param {Number} targetIndex - 目标位置索引
 * @returns {Object} - 返回包含验证结果和数据的对象
 */
export function validateMoveOperation(state, sourceId, targetIndex) {
  const rootBlocks = state.doc.content.content;
  const blockPosIndex = getBlockPosIndex(state.doc);
  
  // 查找源块
  const sourcePos = blockPosIndex.get(sourceId);
  const sourceNode = typeof sourcePos === 'number' ? state.doc.nodeAt(sourcePos) : null;
  if (!sourceNode || sourceNode.type.name !== 'rootBlock') {
    return {
      valid: false,
      message: '未找到源块'
    };
  }
  
  // 获取源块索引
  const sourceIndex = rootBlocks.findIndex(block => block.attrs.id === sourceId);
  if (sourceIndex < 0) {
    return {
      valid: false,
      message: '未找到源块索引'
    };
  }
  
  // 检查是否需要移动（源目标相同）
  if (sourceIndex === targetIndex || sourceIndex + 1 === targetIndex) {
    return { 
      valid: true,
      needsMove: false,
      sourceBlock: {
        node: sourceNode,
        pos: sourcePos,
      }
    };
  }
  
  // 计算插入位置
  let insertPos;
  if (targetIndex < rootBlocks.length) {
    const targetBlock = rootBlocks[targetIndex];
    insertPos = blockPosIndex.get(targetBlock.attrs.id);
    if (typeof insertPos !== 'number') {
      return {
        valid: false,
        message: '未找到目标块位置'
      };
    }
  } else {
    const lastBlock = rootBlocks[rootBlocks.length - 1];
    const lastBlockPos = blockPosIndex.get(lastBlock.attrs.id);
    if (typeof lastBlockPos !== 'number') {
      return {
        valid: false,
        message: '未找到末尾块位置'
      };
    }
    insertPos = lastBlockPos + lastBlock.nodeSize;
  }
  
  // 验证插入位置
  if (insertPos < 0 || insertPos > state.doc.content.size) {
    return {
      valid: false,
      message: '插入位置超出文档范围'
    };
  }
  
  return { 
    valid: true,
    needsMove: true,
    sourceBlock: {
      node: sourceNode,
      pos: sourcePos,
    },
    insertPos,
    sourceIndex,
    targetIndex
  };
}

/**
 * 处理块拖拽结束事件
 * 
 * @param {DragEvent} event - 拖拽事件对象
 * @param {Object} props - 块组件的属性
 * @param {Object} props.editor - 编辑器实例
 * @param {Object} props.node - 当前块节点
 */
export function handleDragEndForEditor(event, options) {
  const startedAt = nowMs();
  const fallbackBlockId = options?.fallbackBlockId ?? 'unknown';
  const dragInfo = getRootBlockDragStateSnapshot().draggingRootBlockInfo;
  const sourceId = dragInfo?.id ?? null;
  try {
    if (!sourceId) {
      console.error(`[BlockView ${fallbackBlockId}] 无法获取源块信息`);
      return;
    }
    
    // 创建位置工具实例
    const targetStartedAt = nowMs();
    const posUtils = new PositionUtils(options.editor);
    
    // 计算目标插入位置的索引
    const targetIndex = posUtils.calculateDragTargetIndex(event);
    const targetMs = nowMs() - targetStartedAt;
    
    if (targetIndex === null) {
      // 中文说明：松手位置离开编辑器或有效 rootBlock 时，拖拽应按取消处理；
      // 视觉层已经在 dragleave / dragend 清理，不把正常取消误报成错误。
      return;
    }

    // 使用验证函数验证移动操作
    const validationStartedAt = nowMs();
    const validationResult = validateMoveOperation(options.editor.state, sourceId, targetIndex);
    const validationMs = nowMs() - validationStartedAt;
    
    if (!validationResult.valid) {
      console.error(`[BlockDrag ${fallbackBlockId}] 移动验证失败: ${validationResult.message}`);
      return;
    }

    try {
      if (!validationResult.needsMove) {
        return;
      }

      // 发出请求移动块的事件
      const emitStartedAt = nowMs();
      options.editor.emit('requestBlockMove', {
        sourceId,
        targetIndex,
        validationResult
      });
      const emitMs = nowMs() - emitStartedAt;
      const durationMs = nowMs() - startedAt;
      if (durationMs > 8) {
        publishDragActionPerf({
          kind: 'dragend',
          durationMs: Math.round(durationMs * 10) / 10,
          targetMs: Math.round(targetMs * 10) / 10,
          validationMs: Math.round(validationMs * 10) / 10,
          emitMs: Math.round(emitMs * 10) / 10,
          needsMove: validationResult.needsMove,
        });
      }

    } catch (transactionError) {
      console.error(`[BlockDrag ${fallbackBlockId}] 执行移动块事务时出错:`, transactionError.message);
      
      // 触发错误事件
      options.editor.emit('blockDragEnd', {
        id: sourceId ?? fallbackBlockId,
        success: false,
        error: transactionError.message
      });
    }
  } catch (error) {
    console.error(`[BlockView ${fallbackBlockId}] 处理拖拽结束事件失败:`, error.message);
    
    try {
      clearDragDomState(event);
      
      if (options.editor) {
        options.editor.emit('blockDragEnd', {
          id: sourceId ?? fallbackBlockId,
          success: false,
          error: error.message
        });
      }
    } catch (cleanupError) {
      console.error(`[BlockView] 清理全局拖拽状态失败:`, cleanupError.message);
    }
  } finally {
    clearDragDomState(event);
    publishRootBlockDragEnd(sourceId ?? fallbackBlockId);
  }
}

/**
 * 处理块拖拽结束事件
 *
 * @param {DragEvent} event - 拖拽事件对象
 * @param {Object} props - 块组件的属性
 * @param {Object} props.editor - 编辑器实例
 * @param {Object} props.node - 当前块节点
 */
export function handleDragEnd(event, props) {
  handleDragEndForEditor(event, {
    editor: props.editor,
    fallbackBlockId: props?.node?.attrs?.id ?? 'unknown',
  });
}
