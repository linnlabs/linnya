// src/renderer/shared/extensions/position/NodeFinder.js

/**
 * 节点查找和遍历工具
 * 用于在文档中查找和操作节点
 */

import { PositionResolver } from './PositionResolver';

/**
 * 节点查找和遍历工具
 * 用于在文档中查找和操作节点
 */
export class NodeFinder {
  /**
   * 初始化节点查找器
   * @param {Editor} editor - Tiptap 编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.positionResolver = new PositionResolver(editor);
  }

  /**
   * 查找指定类型的所有节点
   * @param {string} nodeName - 节点类型名称
   * @returns {Array} 节点信息数组 [{node, pos}, ...]
   */
  findAllNodesOfType(nodeName) {
    const result = [];
    if (!this.editor || !this.editor.state) return result;
    const { doc } = this.editor.state;
    
    doc.descendants((node, pos) => {
      if (node.type.name === nodeName) {
        result.push({ node, pos });
      }
    });
    
    return result;
  }

  /**
   * 查找选区中的节点
   * @param {Function} predicate - 节点过滤函数
   * @returns {Array} 节点信息数组 [{node, pos}, ...]
   */
  findNodesInSelection(predicate) {
    const result = [];
    if (!this.editor || !this.editor.state) return result;
    const { selection, doc } = this.editor.state;
    const { from, to } = selection;
    
    doc.nodesBetween(from, to, (node, pos) => {
      if (predicate(node)) {
        result.push({ node, pos });
      }
    });
    
    return result;
  }

  /**
   * 获取选区中的文本
   * @returns {string} 选区中的文本
   */
  getTextInSelection() {
    if (!this.editor || !this.editor.state) return '';
    const { selection, doc } = this.editor.state;
    const { from, to } = selection;
    
    return doc.textBetween(from, to, ' ');
  }

  /**
   * 查找指定位置的块
   * @param {number} pos - 文档位置
   * @returns {Object|null} 块信息或 null
   */
  findBlockAt(pos) {
    const $pos = this.positionResolver.safeResolve(pos);
    if (!$pos) return null;
    
    // 从当前位置向上查找块
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      
      // 检查是否是块节点
      if (node.isBlock) {
        return {
          node,
          pos: depth === 0 ? 0 : $pos.before(depth), // 对 depth === 0 的特殊处理
          start: $pos.start(depth),
          end: $pos.end(depth),
          depth
        };
      }
    }
    
    return null;
  }

  /**
   * 查找指定位置的子节点索引
   * @param {number} pos - 文档位置
   * @returns {number|null} 子节点索引或 null
   */
  findChildIndexAt(pos) {
    const $pos = this.positionResolver.resolve(pos);
    if (!$pos || $pos.depth < 1) return null;
    const index = $pos.index($pos.depth - 1);
    return index;
  }

  /**
   * 获取指定父节点位置和索引的子节点
   * @param {number} parentPos - 父节点位置
   * @param {number} index - 子节点索引
   * @returns {Object|null} 子节点信息或 null
   */
  getChildNodeAt(parentPos, index) {
    const $pos = this.positionResolver.safeResolve(parentPos);
    if (!$pos) return null;
    
    // 获取父节点
    const parent = $pos.node();
    
    // 检查索引是否有效
    if (index < 0 || index >= parent.childCount) {
      return null;
    }
    
    // 计算子节点位置
    let pos = parentPos + 1; // 跳过父节点的开始标记
    
    for (let i = 0; i < index; i++) {
      pos += parent.child(i).nodeSize;
    }
    
    return {
      node: parent.child(index),
      pos
    };
  }

  /**
   * 根据ID查找节点
   * 
   * @param {string} id - 节点ID
   * @returns {Object|null} 找到的节点信息，包含节点和位置
   */
  findNodeById(id) {
    if (!id) return null;

    if (!this.editor || !this.editor.state) return null;
    const { doc } = this.editor.state;

    let foundNode = null;
    doc.descendants((node, pos) => {
      if (node.attrs?.id === id) {
        foundNode = { node, pos };
        return false;
      }
      if (foundNode) {
          return false;
      }
      return true;
    });

    return foundNode;
  }

  /**
   * 获取所有指定类型的节点
   * @param {string} type - 节点类型名称
   * @returns {Array} 节点数组，每个元素包含节点和位置
   */
  findAllNodesOfType(type) {
    const nodes = [];
    
    if (!this.editor || !this.editor.state) return nodes;
    const { doc } = this.editor.state;
    
    doc.descendants((node, pos) => {
      if (node.type.name === type) {
        nodes.push({ node, pos });
      }
      return true;
    });
    
    return nodes;
  }

  /**
   * 获取指定位置的节点
   * @param {number} pos - 文档位置
   * @returns {Object|null} 节点信息，包含节点和位置
   */
  findNodeAt(pos) {
    if (!this.editor || !this.editor.state) return null;
    const { doc } = this.editor.state;

    try {
      const $pos = doc.resolve(pos);
      const node = $pos.node($pos.depth);
      return node ? { node, pos } : null;
    } catch (error) {
      console.error(`[NodeFinder] findNodeAt(${pos}) 出错:`, error);
      return null;
    }
  }
} 