// src/renderer/shared/extensions/position/PositionResolver.js
/**
 * 位置解析增强工具 - 扩展了 ProseMirror 的 ResolvedPos 对象
 * 处理 pos+1、pos-1 等边界情况，并提供附加的位置信息和导航方法
 * 查找最近的 rootBlock 位置
 */
// import { NODE_GROUPS } from '../../../app/core/schema'; // --- 已移除 ---
import {
  SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY,
  SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY,
} from '../../shared/constants/editorStorageKeys'; // +++ 新增导入 +++

export class PositionResolver {
  /**
   * 初始化位置解析器
   * @param {Editor|Object} editor - Tiptap 编辑器实例或包含state的对象
   */
  constructor(editor) {
    this.editor = editor;
    this.view = editor.view;
    this.state = editor.state;

  }

  get rootBlockTypeName() {
    const name = this.editor.storage[SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY];
    if (typeof name !== 'string' || !name) {
      console.warn(
        '[PositionResolver] 未在 editor.storage 中找到有效的根块类型名称 (schemaRootBlockTypeName)，将回退到 "rootBlock"。请确保 SchemaProviderExtension 已正确加载并配置。'
      );
      return 'rootBlock'; // 回退值
    }
    return name;
  }

  get isBlockContentNode() {
    const predicate = this.editor.storage[SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY];
    if (typeof predicate !== 'function') {
      console.warn(
        '[PositionResolver] 未在 editor.storage 中找到有效的"块内容判断函数" (schemaIsBlockContentNodePredicate)，将回退到始终返回 false。请确保 SchemaProviderExtension 已正确加载并配置。'
      );
      // 回退函数
      return (nodeTypeName) => {
        // console.warn(`[PositionResolver] isBlockContentNode 回退判断: ${nodeTypeName}`);
        return false;
      };
    }
    return predicate;
  }

  /**
   * 解析文档位置
   * @param {number} pos - 文档中的位置索引
   * @returns {ResolvedPos|null} 解析后的位置对象，或在超出范围时返回 null
   */
  resolve(pos) {
    try {
      if (pos < 0 || pos > this.state.doc.content.size) {
        return null;
      }
      return this.state.doc.resolve(pos);
    } catch (error) {
      return null;
    }
  }

  /**
   * 安全解析文档位置，处理边界情况
   * @param {number} pos - 文档中的位置索引
   * @returns {ResolvedPos|null} 解析后的位置对象，或在超出范围时返回最近的有效位置
   */
  safeResolve(pos) {
    try {
      const docSize = this.state.doc.content.size;
      
      // 处理边界情况
      if (pos < 0) pos = 0;
      if (pos > docSize) pos = docSize;
      
      return this.state.doc.resolve(pos);
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析前一个位置
   * @param {number} pos - 文档中的位置索引
   * @returns {ResolvedPos|null} 前一个位置的解析对象
   */
  resolvePrevious(pos) {
    return this.safeResolve(Math.max(0, pos - 1));
  }

  /**
   * 解析后一个位置
   * @param {number} pos - 文档中的位置索引
   * @returns {ResolvedPos|null} 后一个位置的解析对象
   */
  resolveNext(pos) {
    const docSize = this.state.doc.content.size;
    return this.safeResolve(Math.min(docSize, pos + 1));
  }

  /**
   * 获取最近的 rootBlock 位置
   * @param {number} pos - 文档中的位置索引
   * @returns {Object|null} 包含位置和节点信息的对象
   */
  getNearestRootBlockPos(pos) {
    const $pos = this.resolve(pos);
    if (!$pos) return null;
    
    // 从当前位置向上查找 rootBlock
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (node.type.name === this.rootBlockTypeName) {
        return {
          pos: $pos.before(depth),
          node,
          depth
        };
      }
    }
    
    return null;
  }

  /**
   * 获取块信息
   * @param {ResolvedPos} $pos - 解析后的位置
   * @returns {Object|null} 块的详细信息或null
   */
  getBlockInfo($pos) {
    if (!$pos) {
      return null;
    }
    
    let contentBlock = null;
    let rootBlock = null;
    
    // 获取完整的节点路径
    const maxDepth = $pos.path.length / 3 | 0;
    
    // 遍历所有可能的深度层级
    for (let depth = 0; depth <= maxDepth; depth++) {
      const node = $pos.node(depth);
      if (!node) continue;
      
      const pos = depth === 0 ? 0 : $pos.start(depth);
      const end = depth === 0 ? this.state.doc.content.size : $pos.end(depth);
      
      // 使用 schema 中的 BLOCK_CONTENT 定义来检查节点类型
      if (this.isBlockContentNode(node.type.name) && !contentBlock) {
        contentBlock = { node, pos, end, depth };
      } else if (node.type.name === this.rootBlockTypeName && !rootBlock) {
        rootBlock = { node, pos, end, depth };
      }
      
      // 如果都找到了，就可以返回了
      if (contentBlock && rootBlock) {
        break;
      }
    }
    
    // 如果没有找到任何块，返回null
    if (!contentBlock && !rootBlock) {
      return null;
    }
    
    // 返回结果，同时保持向后兼容
    return { 
      baseBlock: contentBlock, // 为了向后兼容，保留 baseBlock
      contentBlock, // 新的命名方式
      rootBlock 
    };
  }

  /**
   * 从选区获取块信息
   * 类似BlockNote的getBlockInfoFromSelection函数
   * @returns {Object|null} - 块的详细信息或null
   */
  getBlockInfoFromSelection() {
    const { selection } = this.state;
    const blockPosInfo = this.getNearestRootBlockPos(selection.anchor);
    
    if (!blockPosInfo) {
      return null;
    }
    
    const $pos = this.resolve(blockPosInfo.pos);
    return this.getBlockInfo($pos);
  }

  /**
   * 从位置获取块信息 (恢复为使用 doc.forEach 的版本)
   * @param {number} pos - 文档中的位置
   * @returns {Object|null} - 块的详细信息或null
   */
  getBlockInfoFromPos(pos) {
    const $pos = this.resolve(pos);

    if (!$pos) {
      return null;
    }

    let contentBlock = null;
    let rootBlock = null;
    
    // 使用原始的 doc.forEach 逻辑
    const doc = $pos.doc;
    doc.forEach((node, offset) => {
      if (node.type.name === this.rootBlockTypeName) {
        const nodeEnd = offset + node.nodeSize;
        if (pos >= offset && pos <= nodeEnd) {
          rootBlock = { 
            node, 
            pos: offset, 
            end: nodeEnd,
            depth: 1 // rootBlock 总在 depth 1
          };
          if (node.childCount > 0) {
            const childNode = node.child(0);
            const childPos = offset + 1; 
            const childEnd = childPos + childNode.nodeSize;
            if (this.isBlockContentNode(childNode.type.name)) {
              contentBlock = { 
                node: childNode, 
                pos: childPos,
                end: childEnd,
                depth: 2 // contentBlock 总在 depth 2
              };
            }
          }
        }
      }
    });

    if (!rootBlock) { // 保持这个警告可能有用
      console.warn(`[PositionResolver] getBlockInfoFromPos(${pos}) could not find containing rootBlock using doc.forEach.`);
    }
    
    return {
      baseBlock: contentBlock, // 保持兼容
      contentBlock,
      rootBlock
    };
  }

  /**
   * 获取下一个位置
   * @param {number} pos - 当前位置
   * @returns {number|null} 下一个位置或null
   */
  nextPos(pos) {
    const $pos = this.resolve(pos);
    if (!$pos) return null;
    
    // 如果在文本节点内部，移动到下一个字符
    if ($pos.textOffset < $pos.parent.textContent.length) {
      return pos + 1;
    }
    
    // 如果在节点末尾，尝试移动到下一个节点
    const docSize = this.state.doc.content.size;
    if (pos < docSize) {
      return pos + 1;
    }
    
    return null;
  }

  /**
   * 获取上一个位置
   * @param {number} pos - 当前位置
   * @returns {number|null} 上一个位置或null
   */
  prevPos(pos) {
    if (pos <= 0) return null;
    return pos - 1;
  }

  /**
   * 获取位置的详细信息
   * @param {ResolvedPos} $pos - 解析后的位置
   * @returns {Object} 位置的详细信息
   */
  getPositionInfo($pos) {
    if (!$pos) return null;
    
    const parentInfo = {
      type: $pos.parent.type.name,
      isText: $pos.parent.isText,
      isBlock: $pos.parent.isBlock,
      isInline: $pos.parent.isInline,
    };
    
    return {
      pos: $pos.pos,
      depth: $pos.depth,
      parentOffset: $pos.parentOffset,
      parent: parentInfo,
      isAtStart: $pos.parentOffset === 0,
      isAtEnd: $pos.parentOffset === $pos.parent.content.size,
      nodeBefore: $pos.nodeBefore ? { type: $pos.nodeBefore.type.name } : null,
      nodeAfter: $pos.nodeAfter ? { type: $pos.nodeAfter.type.name } : null,
    };
  }

  /**
   * 检查位置是否在文本块内
   * @param {ResolvedPos} $pos - 解析后的位置
   * @returns {boolean} 是否在文本块内
   */
  isInTextBlock($pos) {
    if (!$pos) return false;
    return $pos.parent.isTextblock;
  }

  /**
   * 检查位置是否在块的开始
   * @param {ResolvedPos} $pos - 解析后的位置
   * @returns {boolean} 是否在块的开始
   */
  isAtBlockStart($pos) {
    if (!$pos) return false;
    return $pos.parentOffset === 0;
  }

  /**
   * 检查位置是否在块的结束
   * @param {ResolvedPos} $pos - 解析后的位置
   * @returns {boolean} 是否在块的结束
   */
  isAtBlockEnd($pos) {
    if (!$pos) return false;
    return $pos.parentOffset === $pos.parent.content.size;
  }

  /**
   * 遍历两个位置之间的所有节点
   * @param {number} from - 起始位置
   * @param {number} to - 结束位置
   * @param {Function} callback - 回调函数，接收 (node, pos, parent, index) 参数
   */
  forEachNodeBetween(from, to, callback) {
    this.state.doc.nodesBetween(from, to, callback);
  }

  /**
   * 查找指定类型的父节点
   * @param {string} nodeName - 节点类型名称
   * @returns {Object|null} 包含节点和位置的对象，或null
   */
  findParentNodeOfType(nodeName) {
    const { selection } = this.state;
    const { $from } = selection;
    
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === nodeName) {
        return {
          node,
          pos: $from.before(depth),
          depth
        };
      }
    }
    
    return null;
  }
} 