// src/renderer/extensions/position/PositionUtils.js
import { PositionResolver } from './PositionResolver';
import { PositionCoordMapper } from './PositionCoordMapper';
import { NodeFinder } from './NodeFinder';
import { calculateTargetIndex } from '../interaction/drag/DragPositionUtils';
import { getBlockPosIndex } from './blockPosIndex';

export function findContentBlockInRoot(rootBlock) {
  if (!rootBlock || !rootBlock.node) return null;
  
  // 尝试获取第一个子节点
  if (rootBlock.node.content?.content?.length > 0) {
    const firstChild = rootBlock.node.content.content[0];
    // 检查节点类型，确保是预期的内容块类型
    const expectedContentTypes = ['baseBlock', 'headingBlock', 'table', 'imageBlock', 'audioBlock', 'codeBlock', 'latexBlock', 'quoteBlock', 'listItemBlock'];
    if (firstChild && expectedContentTypes.includes(firstChild.type.name)) {
      return {
        node: firstChild,
        pos: rootBlock.pos + 1, // 父节点位置 + 1
      };
    }
  }
  
  return null;
}

/**
 * 位置工具集合 - 提供统一的接口访问所有位置相关工具
 */
export class PositionUtils {
  /**
   * 初始化位置工具集
   * @param {Editor} editor - Tiptap 编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.resolver = new PositionResolver(editor);
    this.mapper = new PositionCoordMapper(editor);
    this.finder = new NodeFinder(editor);
  }

  /**
   * 获取当前选区信息的增强版本
   * @returns {Object} 增强的选区信息
   */
  getSelectionInfo() {
    const { selection } = this.editor.state;
    const { from, to, empty } = selection;
    
    // 检查 $from 和 $to 的解析
    const $from = this.resolver.resolve(from);
    const $to = this.resolver.resolve(to);
    
    return {
      from,
      to,
      empty,
      $from,
      $to,
      text: empty ? '' : this.editor.state.doc.textBetween(from, to, ' '),
      fromInfo: this.resolver.getPositionInfo($from),
      toInfo: this.resolver.getPositionInfo($to)
    };
  }

  /**
   * 获取光标信息
   * @returns {Object} 光标信息
   */
  getCursorInfo() {
    const { selection } = this.editor.state;
    
    if (!selection.empty) {
      return null;
    }
    
    const { $head } = selection;
    const posInfo = this.resolver.getPositionInfo($head);
    const coords = this.mapper.coordsAtPos($head.pos);
    
    return {
      pos: $head.pos,
      posInfo,
      coords,
      blockInfo: this.resolver.getBlockInfo($head)
    };
  }

  /**
   * 根据ID查找根块（通过 blockPosIndex 缓存实现 O(1) 查找）
   * @param {string} id - 根块ID
   * @returns {Object|null} 根块信息或null
   */
  findRootBlockById(id) {
    const index = getBlockPosIndex(this.editor.state.doc);
    const pos = index.get(id);
    if (pos === undefined) return null;

    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'rootBlock') return null;

    return { node, pos };
  }

  /**
   * 获取节点路径
   * @param {number} pos - 文档位置
   * @returns {Array|null} 节点路径或null
   */
  getNodePath(pos) {
    const $pos = this.resolver.resolve(pos);
    if (!$pos) return null;
    
    const path = [];
    
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      path.push({
        depth,
        type: node.type.name,
        pos: $pos.before(depth),
        node
      });
    }
    
    return path;
  }

  /**
   * 检查位置是否在空块中
   * @param {number} pos - 文档位置
   * @returns {boolean} 是否在空块中
   */
  isInEmptyBlock(pos) {
    const blockInfo = this.resolver.getBlockInfoFromPos(pos);
    if (!blockInfo || !blockInfo.blockContent) return false;
    
    const { node } = blockInfo.blockContent;
    return node.content.size === 0;
  }

  /**
   * 查找前一个兄弟节点
   * @param {number} pos - 文档位置
   * @returns {Object|null} 前一个兄弟节点信息或null
   */
  findPreviousSibling(pos) {
    // console.log(`[PositionUtils] findPreviousSibling called with pos: ${pos}`);
    const $pos = this.resolver.resolve(pos);
    if (!$pos) {
      // console.log('[PositionUtils] findPreviousSibling: Could not resolve pos');
      return null;
    }
    // console.log('[PositionUtils] findPreviousSibling resolved $pos:', $pos);

    if ($pos.depth < 1) {
        // console.log(`[PositionUtils] findPreviousSibling: Depth ${$pos.depth} is less than 1, cannot have siblings.`);
        return null;
    }
    
    const parentDepth = $pos.depth - 1;
    const index = $pos.index(parentDepth);
    // const parentNode = $pos.node(parentDepth);
    
    if (index === 0) {
      return null;
    }
    
    const parentNodeContentStartPos = parentDepth === 0 ? 0 : $pos.before(parentDepth);
    
    const result = this.finder.getChildNodeAt(parentNodeContentStartPos, index - 1);
    return result;
  }

  /**
   * 查找后一个兄弟节点
   * @param {number} pos - 文档位置
   * @returns {Object|null} 后一个兄弟节点信息或null
   */
  findNextSibling(pos) {
    const $pos = this.resolver.resolve(pos);
    if (!$pos) {
      return null;
    }
    
     if ($pos.depth < 1) {
        return null;
    }
    
    const parentDepth = $pos.depth -1;
    const parentNode = $pos.node(parentDepth);
    const index = $pos.index(parentDepth);
    
    if (index >= parentNode.childCount - 1) {
      return null;
    }
    
    const parentNodeContentStartPos = parentDepth === 0 ? 0 : $pos.before(parentDepth);   
    const result = this.finder.getChildNodeAt(parentNodeContentStartPos, index + 1);
    return result;
  }

  /**
   * 获取所有兄弟节点
   * @param {number} pos - 文档位置
   * @returns {Array} 兄弟节点数组
   */
  getSiblings(pos) {
    const $pos = this.resolver.resolve(pos);
    if (!$pos || $pos.depth === 0) return [];
    
    const siblings = [];
    const parent = $pos.node($pos.depth - 1);
    const parentPos = $pos.before($pos.depth - 1);
    const currentIndex = $pos.index($pos.depth - 1);
    
    // 收集所有兄弟节点
    let nodePos = parentPos + 1; // 跳过父节点的开始标记
    
    for (let i = 0; i < parent.childCount; i++) {
      const node = parent.child(i);
      
      siblings.push({
        node,
        pos: nodePos,
        isCurrent: i === currentIndex
      });
      
      nodePos += node.nodeSize;
    }
    
    return siblings;
  }

  /**
   * 获取位置对应的块信息
   * @param {number} pos - 文档位置
   * @returns {Object|null} 块信息或null
   */
  getBlockInfoFromPos(pos) {
    return this.resolver.getBlockInfoFromPos(pos);
  }

  /**
   * 计算拖拽目标索引
   * 根据鼠标位置计算拖拽块的目标插入位置索引
   * 
   * @param {MouseEvent} event - 鼠标事件
   * @returns {number|null} 目标索引或 null
   */
  calculateDragTargetIndex(event) {
    return calculateTargetIndex(this.editor, event);
  }

  /**
   * 查找根块内的内容块
   * @param {Object} rootBlock - 根块信息 {node, pos}
   * @returns {Object|null} 内容块信息 {node, pos} 或 null
   */
  findContentBlockInRoot(rootBlock) {
    return findContentBlockInRoot(rootBlock);
  }

  /**
   * 查找指定ID节点的上一个同类型节点
   * @param {string} currentId - 当前节点的ID
   * @param {string} nodeType - 要查找的节点类型 (e.g., 'rootBlock')
   * @returns {{node: ProseMirrorNode, pos: number}|null}
   */
  findPreviousNode(currentId, nodeType) {
    const allNodes = this.finder.findAllNodesOfType(nodeType);
    const currentIndex = allNodes.findIndex(item => item.node.attrs.id === currentId);

    if (currentIndex > 0) {
      return allNodes[currentIndex - 1];
    }
    return null;
  }

  /**
   * 查找指定ID节点的下一个同类型节点
   * @param {string} currentId - 当前节点的ID
   * @param {string} nodeType - 要查找的节点类型 (e.g., 'rootBlock')
   * @returns {{node: ProseMirrorNode, pos: number}|null}
   */
  findNextNode(currentId, nodeType) {
    const allNodes = this.finder.findAllNodesOfType(nodeType);
    const currentIndex = allNodes.findIndex(item => item.node.attrs.id === currentId);

    if (currentIndex !== -1 && currentIndex < allNodes.length - 1) {
      return allNodes[currentIndex + 1];
    }
    return null;
  }

  /**
   * 定位光标到指定块的内容末尾
   * @param {string} blockId - 块ID
   * @returns {boolean} 是否成功定位
   */
  positionCursorAtBlockEnd(blockId) {
    const rootBlock = this.findRootBlockById(blockId);
    if (!rootBlock) return false;
    
    const contentBlock = this.findContentBlockInRoot(rootBlock);
    if (!contentBlock) {
      // 无法找到内容块，至少聚焦编辑器
      this.editor.commands.focus();
      return false;
    }
    
    // 计算内容块末尾位置
    const endPos = contentBlock.pos + contentBlock.node.nodeSize - 1;
    
    // 设置光标并聚焦
    this.editor.commands.focus();
    this.editor.commands.setTextSelection(endPos);
    return true;
  }
} 
