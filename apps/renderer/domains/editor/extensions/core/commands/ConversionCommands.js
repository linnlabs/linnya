// src/renderer/extensions/keyboard/commands/ConversionCommands.js

/**
 * ConversionCommands.js
 * 
 * 处理块类型转换命令（例如将 BaseBlock 转换为 HeadingBlock）
 */

import { generateBlockId } from '../../../../../shared/utils/idUtils';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { NODE_GROUPS } from '../schema';
import { useNotificationStore } from '@/app/notification';
import { useLatexEditorStore } from '../../../blocks/LatexBlock/store/latexEditor'; // ++ 新增导入
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

/**
 * 检查节点或其后代是否包含 TableBlock
 * @param {ProseMirrorNode} node - 要检查的节点
 * @returns {boolean}
 */
function containsTable(node) {
  if (!node) return false;
  if (node.type.name === 'table') {
    return true;
  }
  let hasTable = false;
  if (node.content && node.content.size > 0) {
    node.descendants(descendant => {
      if (descendant.type.name === 'table') {
        hasTable = true;
        return false; // 停止遍历
      }
      return true;
    });
  }
  return hasTable;
}

/**
 * 检查当前光标是否在表格内部
 * @param {EditorState} state - 编辑器状态
 * @returns {boolean} - 如果在表格内返回 true
 */
export const isInsideTable = (state) => {
  const { selection } = state;
  const { $from } = selection;
  
  // 从当前位置向上遍历所有父节点
  for (let i = $from.depth; i > 0; i--) {
    const node = $from.node(i);
    if (node.type.name === 'table') {
      return true;
    }
  }
  
  return false;
};

/**
 * 查找当前选区所在的块
 * @param {EditorState} state - 编辑器状态
 * @returns {Object|null} - 包含 blockPos, blockNode, relativePos 的对象，或 null
 */
const findCurrentBlock = (state) => {
  const { selection } = state;
  const { $from, $to } = selection;
  
  // 保存当前光标在块内的相对位置
  const relativePos = $from.parentOffset;
  
  // 查找当前块的位置
  let blockPos = -1;
  let blockNode = null;
  
  state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (blockPos !== -1) return false; // 已找到块，停止遍历
    
    if (NODE_GROUPS.BLOCK_CONTENT.split('|').includes(node.type.name)) {
      blockPos = pos;
      blockNode = node;
      return false; // 停止遍历
    }
    
    return true; // 继续遍历
  });
  
  if (blockPos === -1 || !blockNode) {
    console.error('未找到可转换的块');
    return null;
  }
  
  return { blockPos, blockNode, relativePos };
};

/**
 * 替换节点并设置光标位置
 * @param {Transaction} tr - 事务对象
 * @param {number} blockPos - 块位置
 * @param {Node} oldNode - 旧节点
 * @param {Node} newNode - 新节点
 * @param {number} relativePos - 相对位置
 * @returns {Transaction} - 更新后的事务对象
 */
const replaceNodeAndSetCursor = (tr, blockPos, oldNode, newNode, relativePos) => {
  // 替换节点
  tr.replaceWith(blockPos, blockPos + oldNode.nodeSize, newNode);
  
  // 计算新的光标位置
  // 确保相对位置不超过内容长度
  const newContentSize = newNode.content.size;
  const newRelativePos = Math.min(relativePos, newContentSize);
  
  // 设置光标位置
  const newPos = blockPos + 1 + newRelativePos; // +1 是为了进入节点内部
  tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
  
  return tr;
};

/**
 * 通用块转换函数
 * @param {string} targetType - 目标块类型 ('baseBlock', 'headingBlock', 'listItemBlock', 'quoteBlock')
 * @param {Object} attrs - 节点属性
 * @returns {Function} - 返回一个命令函数
 */
const convertBlockToType = (targetType, attrs = {}) => ({ state, dispatch, view }) => {
  // 检查是否在表格内，如果是则禁止转换
  if (isInsideTable(state)) {
    console.warn("convertBlockToType: 不能在表格内转换块类型");
    const notificationStore = useNotificationStore();
    notificationStore.show(resolveCurrentEditorMessage('editor.conversion.inTable.blockType'), 'warning', 2000);
    return false;
  }
  
  // 查找当前块
  const blockInfo = findCurrentBlock(state);
  if (!blockInfo) {
    console.warn("convertBlockToType: Could not find current block.");
    return false;
  }
  
  const { blockPos, blockNode, relativePos } = blockInfo;
  
  // 获取 schema 实例
  const schema = state.schema;
  
  // 创建新节点
  let newNode;
  if (targetType === 'baseBlock') {
    newNode = schema.nodes.baseBlock.create(
      { id: blockNode.attrs.id || generateBlockId(), ...attrs },
      blockNode.content
    );
  } else if (targetType === 'headingBlock') {
    newNode = schema.nodes.headingBlock.create(
      { 
        level: attrs.level || 1, 
        id: blockNode.attrs.id || generateBlockId(),
        placeholder: resolveCurrentEditorMessage('editor.placeholder.heading', { level: attrs.level || 1 }),
        ...attrs
      },
      blockNode.content
    );
  } else if (targetType === 'listItemBlock') {
    newNode = schema.nodes.listItemBlock.create(
      { 
        listType: attrs.listType || 'bullet',
        level: attrs.level || 0,
        id: blockNode.attrs.id || generateBlockId(),
        ...attrs
      },
      blockNode.content
    );
  } else if (targetType === 'quoteBlock') {
    newNode = schema.nodes.quoteBlock.create(
      { 
        id: blockNode.attrs.id || generateBlockId(),
        ...attrs
      },
      blockNode.content
    );
  } else {
    console.error(`未知的块类型: ${targetType}`);
    return false;
  }
  
  // 创建事务并替换节点
  const tr = state.tr;
  replaceNodeAndSetCursor(tr, blockPos, blockNode, newNode, relativePos);
  
  // 分发事务
  if (dispatch) {
    dispatch(tr);
  }
  
  return true;
};

/**
 * 设置块为基础块类型
 * @returns {Function} 返回一个命令函数
 */
export const setBaseBlock = () => ({ state, dispatch }) => {
  return convertBlockToType('baseBlock')({ state, dispatch });
};

/**
 * 将块转换为标题块
 * @param {Number} level - 标题级别，1-6
 * @returns {Function} - 返回一个命令函数
 */
export const convertToHeading = (level = 1) => ({ state, dispatch, view }) => {
  return convertBlockToType('headingBlock', { level })({ state, dispatch, view });
};

/**
 * 将块转换为列表项
 * @param {String} listType - 列表类型，bullet 或 ordered
 * @param {Object} [extraAttrs] - 额外属性（如 start：仅对 ordered 有意义）
 * @returns {Function} - 返回一个命令函数
 */
export const convertToListItem = (listType = 'bullet', extraAttrs = {}) => ({ state, dispatch, view }) => {
  // 检查是否在表格内，如果是则禁止转换
  if (isInsideTable(state)) {
    console.warn("convertToListItem: 不能在表格内转换为列表项");
    const notificationStore = useNotificationStore();
    notificationStore.show(resolveCurrentEditorMessage('editor.conversion.inTable.listItem'), 'warning', 2000);
    return false;
  }
  
  // 查找当前块
  const blockInfo = findCurrentBlock(state);
  if (!blockInfo) return false;
  
  const { blockPos, blockNode, relativePos } = blockInfo;
  
  // 检查当前节点是否已经是列表项
  const isListItem = blockNode.type.name === 'listItemBlock';
  const isSameType = isListItem && blockNode.attrs.listType === listType;
  
  if (isListItem && isSameType) {
    // 如果已经是相同类型的列表项，则转换为普通块
    return convertBlockToType('baseBlock')({ state, dispatch });
  }

  // 仅对 ordered 列表才允许传递 start；bullet 不带 start
  // 同时清洗：start 必须是正整数，否则置 null
  const safeStart = (() => {
    if (listType !== 'ordered') return null;
    const raw = extraAttrs && extraAttrs.start;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
    return Math.floor(raw);
  })();

  // 创建新的列表项节点
  const newNode = state.schema.nodes.listItemBlock.create(
    {
      listType: listType,
      level: 0, // 默认无缩进
      id: blockNode.attrs.id || generateBlockId(), // 可以保留 ID 或生成新的
      start: safeStart,
    },
    blockNode.content
  );
  
  // 创建事务并替换节点
  const tr = state.tr;
  replaceNodeAndSetCursor(tr, blockPos, blockNode, newNode, relativePos);
  
  // 分发事务
  if (dispatch) {
    dispatch(tr);
  }
  
  return true;
};

/**
 * 将块转换为引用块
 * @returns {Function} - 返回一个命令函数
 */
export const convertToQuoteBlock = () => ({ state, dispatch, view }) => {
  // 检查是否在表格内，如果是则禁止转换
  if (isInsideTable(state)) {
    console.warn("convertToQuoteBlock: 不能在表格内转换为引用块");
    const notificationStore = useNotificationStore();
    notificationStore.show(resolveCurrentEditorMessage('editor.conversion.inTable.quoteBlock'), 'warning', 2000);
    return false;
  }
  
  // 查找当前块
  const blockInfo = findCurrentBlock(state);
  if (!blockInfo) return false;
  
  const { blockPos, blockNode, relativePos } = blockInfo;
  
  // 检查当前节点是否已经是引用块
  const isQuoteBlock = blockNode.type.name === 'quoteBlock';
  
  if (isQuoteBlock) {
    // 如果已经是引用块，则转换为普通块
    return convertBlockToType('baseBlock')({ state, dispatch });
  }
  
  // 创建新的引用块节点
  const newNode = state.schema.nodes.quoteBlock.create(
    { 
      id: blockNode.attrs.id || generateBlockId(),
    },
    blockNode.content
  );
  
  // 创建事务并替换节点
  const tr = state.tr;
  replaceNodeAndSetCursor(tr, blockPos, blockNode, newNode, relativePos);
  
  // 分发事务
  if (dispatch) {
    dispatch(tr);
  }
  
  return true;
};

/**
 * 将块转换为代码块
 * @param {String} language - 代码语言
 * @returns {Function} - 返回一个命令函数
 */
export const convertToCodeBlock = (language = '') => ({ commands }) => {
  // 默认由setCodeBlock实现代码块转换, 这里返回false
  return false;
};

/**
 * 将当前块转换为 LaTeX 块
 * @param {Object} attrs - 属性，可以包含 latexSource
 * @returns {Function} - 返回一个命令函数
 */
export const convertToLatexBlock = (attrs = {}) => ({ state, dispatch }) => {
  // 检查是否在表格内，如果是则禁止转换
  if (isInsideTable(state)) {
    console.warn("convertToLatexBlock: 不能在表格内转换为 LaTeX 块");
    const notificationStore = useNotificationStore();
    notificationStore.show(resolveCurrentEditorMessage('editor.conversion.inTable.latexBlock'), 'warning', 2000);
    return false;
  }
  
  const blockInfo = findCurrentBlock(state);
  if (!blockInfo) {
    console.warn("convertToLatexBlock: Could not find current block.");
    return false;
  }

  const { blockPos, blockNode } = blockInfo;
  const schema = state.schema;

  // ++ 生成或保留节点ID ++
  const nodeId = blockNode.attrs.id || generateBlockId();

  // 创建新的 LatexBlock 节点
  const newNode = schema.nodes.latexBlock.create({
      id: nodeId, // 使用保留或生成的ID
      blockType: 'latex',
      latexSource: attrs.latexSource || '' // Default to empty string for initial input state
  });

  const tr = state.tr;
  // 替换旧节点
  tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, newNode);
  // 选中新节点
  tr.setSelection(NodeSelection.create(tr.doc, blockPos));
  tr.scrollIntoView();

  if (dispatch) {
      dispatch(tr);
      
      // ++ 如果是空的LaTeX块，设置待打开标志 ++
      if (!attrs.latexSource || attrs.latexSource === '') {
        const latexStore = useLatexEditorStore();
        latexStore.setPendingOpenNodeId(nodeId);
      }
  }
  return true;
};

/**
 * 通用块转换命令
 * @param {String} blockType - 目标块类型
 * @param {Object} attrs - 块属性
 * @returns {Function} - 返回一个命令函数
 */
export const convertBlock = (blockType, attrs = {}) => ({ commands, editor }) => {
  switch (blockType) {
    case 'baseBlock':
      return commands.setBaseBlock();
    case 'headingBlock':
      return commands.convertToHeading(attrs.level || 1);
    case 'listItem':
      return commands.convertToListItem(attrs.listType, { start: attrs.start });
    case 'codeBlock':
      return commands.convertToCodeBlock(attrs.language);
    case 'blockquote':
      return commands.convertToBlockquote();
    case 'quoteBlock':
      return commands.convertToQuoteBlock();
    case 'latexBlock':
      return commands.convertToLatexBlock(attrs);
    default:
      console.error(`未知的块类型: ${blockType}`);
      return false;
  }
};

export default {
  setBaseBlock,
  convertToHeading,
  convertToListItem,
  convertToQuoteBlock,
  convertToLatexBlock,
  convertBlock,
  isInsideTable
};
