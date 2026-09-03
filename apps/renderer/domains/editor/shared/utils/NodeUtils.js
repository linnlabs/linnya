/**
 * DocumentDebugUtils.js
 * 
 * 提供文档结构和节点信息的调试工具函数
 */

import { PositionUtils } from '../../extensions/position/PositionUtils';

/**
 * 打印文档结构
 * @param {Editor} editor - 编辑器实例
 */
export const logDocumentStructure = (editor) => {
  if (!editor) return;
  const positionUtils = new PositionUtils(editor);
  console.log('------------------------');
  console.log('文档结构:');
  let blockCount = 0;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'rootBlock') {
      blockCount++;
      const positionInfo = positionUtils.getBlockInfoFromPos(pos);
      
      if (positionInfo) {
        const { rootBlock, contentBlock } = positionInfo;
        console.log(`[块 ${blockCount}]`);
        console.log(`根块: ${rootBlock.node.type.name}`);
        console.log(`- ID: ${rootBlock.node.attrs.id}`);
        console.log(`- 位置范围: ${rootBlock.pos}-${rootBlock.end}`);
        
        if (contentBlock) {
          console.log(`内容块: ${contentBlock.node.type.name}`);
          console.log(`- ID: ${contentBlock.node.attrs.id}`);
          console.log(`- 位置范围: ${contentBlock.pos}-${contentBlock.end}`);
          if (contentBlock.node.type.name === 'headingBlock') {
            console.log(`- 级别: ${contentBlock.node.attrs.level || 1}`);
          }
          console.log(`- 内容: "${contentBlock.node.textContent}"`);
        }
        console.log('------------------------');
      }
    }
    return true;
  });

  console.log(`总计 ${blockCount} 个根块`);
  console.log('------------------------');
};

/**
 * 打印当前节点信息
 * @param {Editor} editor - 编辑器实例
 */
export const logCurrentNode = (editor) => {
  if (!editor) return;
  const positionUtils = new PositionUtils(editor);
  const { state } = editor;
  const { selection } = state;
  const { from } = selection;
  
  let node = null;
  state.doc.nodesBetween(from, from, (n, pos) => {
    if (!node) node = n;
    return false;
  });
  
  if (node) {
    const posInfo = positionUtils.getBlockInfoFromPos(from);
    console.log('当前节点信息:');
    if (posInfo) {
      const { rootBlock, contentBlock } = posInfo;
      console.log(`根块: ${rootBlock.node.type.name}`);
      console.log(`- ID: ${rootBlock.node.attrs.id}`);
      console.log(`- 位置范围: ${rootBlock.pos}-${rootBlock.end}`);
      
      if (contentBlock) {
        console.log(`内容块: ${contentBlock.node.type.name}`);
        console.log(`- ID: ${contentBlock.node.attrs.id}`);
        console.log(`- 位置范围: ${contentBlock.pos}-${contentBlock.end}`);
        if (contentBlock.node.type.name === 'headingBlock') {
          console.log(`- 级别: ${contentBlock.node.attrs.level || 1}`);
        }
        console.log(`- 内容: "${contentBlock.node.textContent}"`);
      }
    }
  } else {
    console.log('未找到节点');
  }
}; 