// src/renderer/utils/DebugUtils.js

/**
 * DebugUtils.js
 * 
 * 提供编辑器调试工具函数，用于日志输出和结构分析
 */

/**
 * 递归打印节点结构
 * @param {Node} node - 要打印的节点
 * @param {string} prefix - 缩进前缀
 */
export const logNodeStructure = (node, prefix = '') => {
  if (!node) return;
  
  console.log(`${prefix}类型: ${node.type.name}`);
  
  if (node.attrs && Object.keys(node.attrs).length > 0) {
    console.log(`${prefix}属性:`, node.attrs);
  }
  
  console.log(`${prefix}节点大小: ${node.nodeSize}`);
  console.log(`${prefix}内容大小: ${node.content.size}`);
  
  if (node.isText) {
    console.log(`${prefix}文本: "${node.text}"`);
  } else if (node.childCount > 0) {
    console.log(`${prefix}子节点 (${node.childCount}):`);
    node.forEach((child, offset) => {
      console.group(`${prefix}子节点 #${offset}`);
      logNodeStructure(child, `${prefix}  `);
      console.groupEnd();
    });
  } else {
    console.log(`${prefix}无子节点`);
  }
};

/**
 * 打印节点基本信息
 * @param {Node} node - 要打印的节点
 * @param {string} prefix - 前缀标识
 */
export const logNodeInfo = (node, prefix = '') => {
  if (!node) {
    console.log(`${prefix}节点: null`);
    return;
  }
  
  console.log(`${prefix}节点类型: ${node.type.name}`);
  console.log(`${prefix}大小: ${node.nodeSize}`);
  console.log(`${prefix}子节点数: ${node.childCount}`);
  console.log(`${prefix}属性:`, node.attrs);
  console.log(`${prefix}内容大小: ${node.content.size}`);
  
  if (node.isText) {
    console.log(`${prefix}文本: "${node.text}"`);
  }
};

/**
 * 打印文档结构
 * @param {Editor} editor - 编辑器实例
 */
export const logDocumentStructure = (editor) => {
  console.group('文档结构');
  const doc = editor.state.doc;
  logNodeStructure(doc);
  console.groupEnd();
};

/**
 * 打印选区信息
 * @param {Editor} editor - 编辑器实例
 */
export const logSelectionInfo = (editor) => {
  const { selection } = editor.state;
  console.group('选区信息');
  console.log('从:', selection.from);
  console.log('至:', selection.to);
  console.log('是否为空:', selection.empty);
  console.log('锚点:', selection.$anchor.pos);
  console.log('活动点:', selection.$head.pos);
  console.groupEnd();
};

/**
 * 检测块是否为空
 * @param {Node} node - ProseMirror节点
 * @returns {boolean} - 节点是否为空
 */
export const isEmptyBlock = (node) => {
  if (!node) return true;
  
  // 块没有内容
  if (node.content.size === 0) return true;
  
  // 块只有一个空文本节点
  if (node.childCount === 1 && 
      node.firstChild.isText && 
      node.firstChild.text === '') {
    return true;
  }
  
  // 无文本内容
  if (node.textContent === '') return true;
  
  return false;
};

/**
 * 递归打印文档结构，显示节点类型、ID和深度
 * @param {Node} node - 要打印的节点
 * @param {number} depth - 当前深度
 * @param {Array} path - 节点路径
 */
export const logDocumentWithDepth = (node, depth = 0, path = []) => {
  const indent = '  '.repeat(depth);
  let info = `${indent}[深度 ${depth}] 类型: ${node.type.name}`;
  
  // 添加节点ID信息
  if (node.attrs && node.attrs.id) {
    info += ` (ID: ${node.attrs.id})`;
  }
  
  console.log(info);
  
  // 打印节点内容
  if (node.isText) {
    console.log(`${indent}  文本: "${node.text}"`);
  } else if (node.childCount > 0) {
    // 递归打印子节点
    node.forEach((child, offset) => {
      const childPath = [...path, offset];
      logDocumentWithDepth(child, depth + 1, childPath);
    });
  }
};

/**
 * 打印文档变化前后的结构对比
 * @param {Transaction} tr - ProseMirror事务
 * @param {string} title - 日志标题
 */
export const logDocumentChange = (tr, title = '文档结构变化') => {
  if (!tr.docChanged) return;
  
  console.group(title);
  console.log('变化前:');
  logDocumentWithDepth(tr.before);
  console.log('变化后:');
  logDocumentWithDepth(tr.doc);
  console.groupEnd();
};

/**
 * 调试拖拽手柄
 * 
 * @param {Object} options - 调试选项
 * @param {string} options.blockId - 块ID
 * @param {boolean} options.isRootBlock - 是否为根块
 * @param {boolean} options.isHovered - 是否悬停
 */
export function debugDragHandle(options) {
  // 在生产环境中禁用此功能
  if (!import.meta.env.DEV) return;
  
  // 禁用拖拽手柄调试日志
  return;
  
  // 以下代码不会执行
  console.log('拖拽手柄调试');
  console.log('当前时间:', new Date().toISOString());
  console.log('调试参数:', options);
  
  // 查找所有拖拽手柄
  const dragHandles = document.querySelectorAll('.drag-handle');
  console.log(`找到 ${dragHandles.length} 个拖拽手柄元素`);
  
  // 查找所有根块
  const rootBlocks = document.querySelectorAll('.root-block-outer');
  console.log(`找到 ${rootBlocks.length} 个根块元素`);
  
  // 收集块元素信息
  const blockElements = [];
  rootBlocks.forEach((block) => {
    const id = block.getAttribute('data-id');
    const isHovered = block.hasAttribute('data-hovered');
    const isDragging = block.hasAttribute('data-dragging');
    
    const dragHandle = block.querySelector('.drag-handle');
    let handleStyle = null;
    
    if (dragHandle) {
      const style = window.getComputedStyle(dragHandle);
      handleStyle = {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        position: style.position,
        left: style.left,
        top: style.top,
        zIndex: style.zIndex
      };
    }
    
    blockElements.push({
      id,
      isHovered,
      isDragging,
      handleStyle
    });
  });
  
  console.log('块元素信息:', blockElements);
}

export default {
  logNodeStructure,
  logNodeInfo,
  logDocumentStructure,
  logSelectionInfo,
  isEmptyBlock,
  logDocumentWithDepth,
  logDocumentChange,
  debugDragHandle
}; 