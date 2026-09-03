// src/renderer/extensions/interaction/commands/InsertCommands.js
/**
 * InsertCommands.js
 * 
 * 提供块的创建命令
 * 这些命令专门用于在文档中的不同位置创建新块
 */

import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';
import { PositionUtils } from '../../position/PositionUtils';
import { NodeSelection, TextSelection } from 'prosemirror-state';

export function setSelectionForInsertedContentBlock(tr, rootBlockPos, contentNode) {
  const contentNodePos = rootBlockPos + 1;

  if (contentNode.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, contentNodePos + 1));
    return true;
  }

  if (NodeSelection.isSelectable(contentNode)) {
    tr.setSelection(NodeSelection.create(tr.doc, contentNodePos));
    return true;
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(contentNodePos), 1));
  return true;
}

/**
 * 创建新块
 * @param {Object} options - 创建选项
 * @param {String} options.position - 位置类型：'start'|'end'|'before'|'after'
 * @param {Number} [options.referencePos] - 参考位置，在'before'和'after'模式下需要
 * @param {String} [options.blockType='baseBlock'] - 要创建的块类型
 * @param {Object} [options.attrs={}] - 块的属性
 * @returns {Function} - 返回命令函数
 */
export const createBlock = (options = {}) => (props) => {
  const { state, dispatch, editor } = props;
  
  // 默认选项
  const {
    position = 'end',
    referencePos = null,
    blockType = 'baseBlock',
    attrs = {}
  } = options;
  
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 生成块ID
  const blockId = attrs.id || generateBlockId();
  
  // 创建新块节点
  const newBlockNode = editor.schema.nodes[blockType].create({
    id: blockId,
    ...attrs
  });
  
  // 根据位置类型确定插入位置
  let insertPos;
  
  if (position === 'start') {
    // 在文档开头插入
    insertPos = 0;
  } else if (position === 'end') {
    // 在文档末尾插入
    insertPos = state.doc.content.size;
  } else if (position === 'before' || position === 'after') {
    // 需要参考位置
    if (referencePos === null) {
      return false;
    }
    
    // 查找参考位置所在的块
    const blockInfo = posUtils.getBlockInfoFromPos(referencePos);
    
    if (!blockInfo || !blockInfo.contentBlock) {
      return false;
    }
    
    // 根据位置类型确定插入位置
    if (position === 'before') {
      insertPos = blockInfo.contentBlock.pos;
    } else { // after
      insertPos = blockInfo.contentBlock.pos + blockInfo.contentBlock.node.nodeSize;
    }
  } else {
    return false;
  }
  
  // 执行插入操作
  if (dispatch) {
    const tr = state.tr.insert(insertPos, newBlockNode);
    dispatch(tr);
  }
  
  return true;
};

/**
 * 在指定块前或后插入新块
 * @param {Array} blocksToInsert - 要插入的块数组
 * @param {String|Object} referenceBlock - 参考块ID或包含ID的对象
 * @param {String} [placement='before'] - 放置位置：'before'|'after'
 * @returns {Function} - 返回命令函数
 */
export const insertBlocks = (blocksToInsert, referenceBlock, placement = 'before') => (props) => {
  const { state, dispatch, editor } = props;
  
  // 获取参考块ID
  const id = typeof referenceBlock === 'string' ? referenceBlock : referenceBlock.id;
  
  // 初始化PositionUtils
  const posUtils = new PositionUtils(editor);
  
  // 查找参考块
  const blockInfo = posUtils.finder.findBlockById(id);
  
  if (!blockInfo) {
    return false;
  }
  
  // 创建要插入的节点数组
  const nodesToInsert = [];
  
  for (const blockSpec of blocksToInsert) {
    // 确保每个块都有ID
    const blockId = blockSpec.id || generateBlockId();
    
    // 创建节点
    const blockType = blockSpec.type || 'baseBlock';
    const node = editor.schema.nodes[blockType].create({
      id: blockId,
      ...blockSpec.attrs
    }, blockSpec.content);
    
    nodesToInsert.push(node);
  }
  
  // 确定插入位置
  let insertPos;
  
  if (placement === 'before') {
    insertPos = blockInfo.pos;
  } else if (placement === 'after') {
    insertPos = blockInfo.pos + blockInfo.node.nodeSize;
  } else {
    return false;
  }
  
  // 执行插入操作
  if (dispatch) {
    const tr = state.tr.insert(insertPos, nodesToInsert);
    dispatch(tr);
  }
  
  return true;
};

/**
 * 批量插入多个块的命令别名
 * 为了兼容性提供的别名
 */
export const insertBlocksCommand = insertBlocks;

/**
 * 创建新 rootBlock（包含一个内容块）
 * @param {Object} options - 创建选项
 * @param {String} options.position - 位置类型：'start'|'end'|'before'|'after'
 * @param {Number} [options.referencePos] - 参考位置，在'before'和'after'模式下需要
 * @param {Object} [options.rootAttrs={}] - rootBlock 的属性
 * @param {Object} [options.blockAttrs={}] - 内容块（如 baseBlock / table 等）的属性
 * @param {String} [options.contentType='baseBlock'] - 内容块类型（schema 节点名称）
 * @param {boolean} [options.focusNewBlock=true] - 是否将光标聚焦到新创建的块中。为 `false` 时，光标位置不变。
 * @param {Array} [options.contentChildren] - 可选：作为内容块子节点的 children 数组（例如 table 的 rows）
 * @returns {Function} - 返回命令函数
 */
export const createRootBlock = (options = {}) => (props) => {
  const { state, dispatch, editor } = props;
  // console.log('[InsertCommands] Available node types in schema:', Object.keys(editor.schema.nodes)); // Keep for now if still needed
  
  const {
    position = 'end',
    referencePos = null,
    rootAttrs = {},
    blockAttrs = {}, // blockAttrs can now receive an id
    contentType = 'baseBlock',
    focusNewBlock = true, // 新增参数，默认为 true
  } = options;
  
  const rootId = rootAttrs.id || generateRootBlockId();
  // Prefer passed id for contentNode, otherwise generate a new one.
  const contentNodeId = blockAttrs.id || generateBlockId(); 

  let schemaResolvedContentType = contentType; 
  if (!editor.schema.nodes[schemaResolvedContentType]) {
    const camelCaseContentType = contentType.charAt(0).toLowerCase() + contentType.slice(1);
    if (editor.schema.nodes[camelCaseContentType]) {
      schemaResolvedContentType = camelCaseContentType;
    } else {
      const lowerCaseContentType = contentType.toLowerCase();
      if (editor.schema.nodes[lowerCaseContentType]) {
        schemaResolvedContentType = lowerCaseContentType;
      }
    }
  }
  // console.log(`[InsertCommands] Original contentType: "${contentType}", Resolved schema contentType: "${schemaResolvedContentType}"`);

  // Prepare attributes for the content node, ensuring our specific id is used.
  const contentNodeSpecificAttrs = {
    ...blockAttrs, // Spread incoming attrs first
    id: contentNodeId // Override/set our specific id
  };
  
  const nodeTypeDefinition = editor.schema.nodes[schemaResolvedContentType]; 
  if (!nodeTypeDefinition) {
    // console.error(`[InsertCommands] Node type definition for "${schemaResolvedContentType}" not found in schema. Original was "${contentType}".`);
    return false; 
  }

  const newContentNode = nodeTypeDefinition.create(
    contentNodeSpecificAttrs, 
    options.contentChildren || undefined
  );
  
  const newRootBlock = editor.schema.nodes.rootBlock.create(
    { id: rootId, ...rootAttrs },
    newContentNode
  );
  
  // 根据位置类型确定插入位置
  let insertPos;
  
  if (position === 'start') {
    // 在文档开头插入
    insertPos = 0;
  } else if (position === 'end') {
    // 在文档末尾插入
    insertPos = state.doc.content.size;
  } else if (position === 'before' || position === 'after') {
    // 需要参考位置
    if (referencePos === null) {
      // console.error('在before/after模式下需要提供referencePos');
      return false;
    }
    
    // 初始化PositionUtils
    const posUtils = new PositionUtils(editor);
    
    // 查找参考位置所在的rootBlock
    const rootBlockInfo = posUtils.resolver.getBlockInfoFromPos(referencePos)?.rootBlock;
    
    if (!rootBlockInfo) {
      // console.error('无法在指定位置找到rootBlock');
      return false;
    }
    
    // 根据位置类型确定插入位置
    if (position === 'before') {
      insertPos = rootBlockInfo.pos;
    } else { // after
      insertPos = rootBlockInfo.pos + rootBlockInfo.node.nodeSize;
    }
  } else {
    // console.error('不支持的位置类型:', position);
    return false;
  }
  
  // 执行插入操作
  if (dispatch) {
    const tr = state.tr.insert(insertPos, newRootBlock);
    
    if (focusNewBlock) {
      setSelectionForInsertedContentBlock(tr, insertPos, newContentNode);
    }
    
    dispatch(tr.scrollIntoView());
  }
  
  return true;
};

// 导出所有命令
export default {
  createBlock,
  insertBlocks,
  insertBlocksCommand,
  createRootBlock,
};
