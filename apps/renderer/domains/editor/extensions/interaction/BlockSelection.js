// src/renderer/extensions/interaction/BlockSelection.js
/**
 * BlockSelection.js
 * 
 * 块级选区管理工具
 * 提供选区数据的保存和恢复功能，将ProseMirror内部位置转换为块ID+块内偏移的形式
 */

import { TextSelection } from 'prosemirror-state';
import { PositionResolver } from '../../../extensions/position/PositionResolver';
import { NodeFinder } from '../../../extensions/position/NodeFinder';

/**
 * 获取块级选区数据
 * 将ProseMirror内部位置转换为块ID+块内偏移的形式
 * 
 * @param {Editor} editor - 编辑器实例
 * @returns {Object|null} 块级选区数据对象，如果无法获取则返回null
 */
export function getBlockSelectionData(editor) {
  try {
    if (!editor || !editor.state) {
      console.error('[BlockSelection] 获取选区数据失败: 编辑器实例无效');
      return null;
    }
    
    const { state } = editor;
    const { selection } = state;
    const { anchor, head } = selection;
    
    // 初始化选区数据对象
    const selectionData = {
      type: 'text', // 默认为文本选区
      anchor,
      head,
      anchorBlockId: null,
      headBlockId: null,
      anchorOffset: null,
      headOffset: null
    };
    
    // 创建位置解析器和节点查找器
    const positionResolver = new PositionResolver({ state });
    const nodeFinder = new NodeFinder({ state });
    
    // 处理不同类型的选区
    if (selection instanceof NodeSelection) {
      selectionData.type = 'node';
    } else if (selection.constructor.name === 'CellSelection') {
      selectionData.type = 'cell';
      // 表格单元格选区需要额外处理
      selectionData.anchorCell = selection.$anchorCell ? selection.$anchorCell.pos : null;
      selectionData.headCell = selection.$headCell ? selection.$headCell.pos : null;
    }
    
    // 解析锚点位置
    const $anchor = state.doc.resolve(anchor);
    const anchorBlockInfo = positionResolver.getNearestRootBlockPos(anchor);
    
    if (anchorBlockInfo) {
      const { node: anchorBlock, pos: anchorBlockPos } = anchorBlockInfo;
      selectionData.anchorBlockId = anchorBlock.attrs.id;
      // 计算相对于块起始位置的偏移量
      selectionData.anchorOffset = anchor - anchorBlockPos;
      
      // 如果是范围选区，还需要处理头部位置
      if (anchor !== head) {
        const headBlockInfo = positionResolver.getNearestRootBlockPos(head);
        
        if (headBlockInfo) {
          const { node: headBlock, pos: headBlockPos } = headBlockInfo;
          selectionData.headBlockId = headBlock.attrs.id;
          // 计算相对于块起始位置的偏移量
          selectionData.headOffset = head - headBlockPos;
        } else {
          console.warn('[BlockSelection] 无法获取头部块信息');
        }
      } else {
        // 如果是光标选区，头部和锚点相同
        selectionData.headBlockId = selectionData.anchorBlockId;
        selectionData.headOffset = selectionData.anchorOffset;
      }
    } else {
      console.warn('[BlockSelection] 无法获取锚点块信息');
      return null;
    }
    
    // 记录选区类型的额外信息
    if (selectionData.type === 'node') {
      const nodeBlock = nodeFinder.findBlockAt(selection.from);
      if (nodeBlock) {
        selectionData.nodeType = nodeBlock.node.type.name;
        selectionData.nodeId = nodeBlock.node.attrs.id;
      }
    }
    
    console.log('[BlockSelection] 已获取块级选区数据:', selectionData);
    return selectionData;
  } catch (error) {
    console.error('[BlockSelection] 获取选区数据出错:', error);
    return null;
  }
}

/**
 * 根据块级选区数据更新编辑器选区
 * 
 * @param {Editor} editor - 编辑器实例
 * @param {Object} selectionData - 块级选区数据对象
 * @returns {boolean} 是否成功更新选区
 */
export function updateBlockSelectionFromData(editor, selectionData) {
  try {
    if (!editor || !editor.state || !editor.view) {
      console.error('[BlockSelection] 更新选区失败: 编辑器实例无效');
      return false;
    }
    
    if (!selectionData) {
      console.error('[BlockSelection] 更新选区失败: 选区数据无效');
      return false;
    }
    
    console.log('[BlockSelection] 开始根据块级选区数据更新编辑器选区:', selectionData);
    
    const { state, view } = editor;
    const nodeFinder = new NodeFinder({ state });
    
    // 查找锚点块
    let anchorBlock = null;
    if (selectionData.anchorBlockId) {
      // 使用NodeFinder查找指定ID的块
      const blocks = nodeFinder.findAllNodesOfType('rootBlock');
      const matchingBlocks = blocks.filter(block => block.node.attrs.id === selectionData.anchorBlockId);
      
      if (matchingBlocks.length > 1) {
        console.warn(`[BlockSelection] 找到多个ID为 ${selectionData.anchorBlockId} 的块，使用第一个`);
        // 使用第一个找到的块
        anchorBlock = matchingBlocks[0];
      } else if (matchingBlocks.length === 1) {
        anchorBlock = matchingBlocks[0];
      }
    }
    
    if (!anchorBlock) {
      console.error('[BlockSelection] 更新选区失败: 找不到锚点块', selectionData.anchorBlockId);
      // 使用当前选区作为备选
      const currentSelection = editor.state.selection;
      const tr = state.tr.setSelection(currentSelection);
      view.dispatch(tr);
      return false;
    }
    
    // 计算新的锚点位置
    let newAnchor = anchorBlock.pos;
    if (selectionData.anchorOffset !== undefined && selectionData.anchorOffset !== null) {
      newAnchor += selectionData.anchorOffset;
    }
    
    let newHead = newAnchor; // 默认头部和锚点相同
    
    // 如果是范围选区，还需要计算头部位置
    if (selectionData.type === 'text' && selectionData.headBlockId && selectionData.headBlockId !== selectionData.anchorBlockId) {
      // 查找头部块
      const blocks = nodeFinder.findAllNodesOfType('rootBlock');
      const matchingBlocks = blocks.filter(block => block.node.attrs.id === selectionData.headBlockId);
      
      let headBlock = null;
      if (matchingBlocks.length > 1) {
        console.warn(`[BlockSelection] 找到多个ID为 ${selectionData.headBlockId} 的块，使用第一个`);
        headBlock = matchingBlocks[0];
      } else if (matchingBlocks.length === 1) {
        headBlock = matchingBlocks[0];
      }
      
      if (headBlock) {
        newHead = headBlock.pos;
        if (selectionData.headOffset !== undefined && selectionData.headOffset !== null) {
          newHead += selectionData.headOffset;
        }
      } else {
        console.warn('[BlockSelection] 找不到头部块，将使用锚点作为头部');
      }
    } else if (selectionData.type === 'text' && selectionData.headOffset !== selectionData.anchorOffset) {
      // 同一个块内的范围选区
      if (selectionData.headOffset !== undefined && selectionData.headOffset !== null) {
        newHead = anchorBlock.pos + selectionData.headOffset;
      }
    }
    
    // 确保选区位置有效
    newAnchor = Math.min(Math.max(0, newAnchor), state.doc.content.size);
    newHead = Math.min(Math.max(0, newHead), state.doc.content.size);
    
    // 创建新的选区
    let newSelection;
    
    if (selectionData.type === 'node') {
      // 节点选区
      try {
        if (selectionData.nodeId) {
          const nodeBlocks = nodeFinder.findAllNodesOfType(selectionData.nodeType || 'rootBlock');
          const nodeBlock = nodeBlocks.find(block => block.node.attrs.id === selectionData.nodeId);
          
          if (nodeBlock) {
            // 使用 setNodeSelection 命令
            editor.commands.setNodeSelection(nodeBlock.pos);
            console.log('[BlockSelection] 使用 setNodeSelection 命令设置节点选区');
            return true;
          } else {
            console.warn('[BlockSelection] 找不到节点块，将创建文本选区');
            newSelection = TextSelection.create(state.doc, newAnchor, newHead);
          }
        } else {
          newSelection = TextSelection.create(state.doc, newAnchor);
        }
      } catch (nodeSelectionError) {
        console.warn('[BlockSelection] 创建节点选区失败:', nodeSelectionError.message);
        // 降级为文本选区
        newSelection = TextSelection.create(state.doc, newAnchor, newHead);
      }
    } else if (selectionData.type === 'cell') {
      // 表格单元格选区需要特殊处理
      console.warn('[BlockSelection] 表格单元格选区暂不支持恢复');
      newSelection = TextSelection.create(state.doc, newAnchor, newHead);
    } else {
      // 文本选区
      try {
        newSelection = TextSelection.create(state.doc, newAnchor, newHead);
      } catch (textSelectionError) {
        console.warn('[BlockSelection] 创建文本选区失败:', textSelectionError.message, '使用默认选区');
        // 使用当前选区
        newSelection = state.selection;
      }
    }
    
    // 应用新选区
    const tr = state.tr.setSelection(newSelection);
    view.dispatch(tr);
    
    console.log('[BlockSelection] 已成功更新编辑器选区');
    return true;
  } catch (error) {
    console.error('[BlockSelection] 更新选区出错:', error);
    return false;
  }
}

// 导出所有函数
export default {
  getBlockSelectionData,
  updateBlockSelectionFromData
}; 