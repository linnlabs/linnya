/* src/renderer/shared/keyboard/handlers/BlockEditing.js */
/**
 * BlockEditing.js
 * 
 * 提供处理核心块编辑操作（例如：Enter, Backspace, Delete）的函数。
 */
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { findParentNode } from '@tiptap/core';
import { joinForward, selectNodeForward } from 'prosemirror-commands';

/**
 * 分析拆分操作的位置特性 (从原 splitUtils.js 移入)
 * 判断拆分位置是否在块的开始、结束或中间
 * 
 * @param {number} pos - 拆分位置
 * @param {import('prosemirror-state').EditorState} state - 编辑器状态
 * @returns {Object} 包含位置特性的对象 (isAtStart, isAtEnd, isInMiddle, node, parentOffset)
 */
const analyzeSplitOperation = (pos, state) => {
  const $pos = state.doc.resolve(pos);
  
  const node = $pos.parent;
  const parentOffset = $pos.parentOffset;
  
  const isAtStart = parentOffset === 0;
  const isAtEnd = parentOffset === node.content.size;
  const isInMiddle = !isAtStart && !isAtEnd;
  
  return {
    isAtStart,
    isAtEnd,
    isInMiddle,
    node,
    parentOffset
  };
};

/**
 * 处理 Enter 键。
 * - 在空列表项中：将其转换为基础块 (baseBlock)。
 * - 在空引用块中：将其转换为基础块 (baseBlock)。
 * - 在块首：在前面插入一个新的基础块 (baseBlock)。
 * - 在块中间或末尾：调用通用的块拆分命令 (splitBlock)。
 * @param {object} context - 包含 event, $cursor, editor, state, dispatch 等上下文信息的对象。
 * @returns {boolean} - 如果事件已被处理则返回 true，否则返回 false。
 */
export function handleEnter({ event, $cursor, editor, state, dispatch }) { // 移除了 debugLog，如果需要可以加回来
  if (event.key !== 'Enter' || event.shiftKey) {
    // 如果按下的不是 Enter键，或者同时按下了 Shift键（通常用于插入软换行），则不处理
    return false;
  }

  // 注意：CodeBlock 中的 Enter 键通常由其自身的键盘处理逻辑 (如 CodeBlockKeys.js) 优先处理，
  // 这里不再重复判断，假设 CodeBlock 的处理已在调用此函数之前或更高优先级完成。

  // --- 处理在空列表项 (listItemBlock) 中按回车的情况 ---
  if ($cursor && $cursor.parent.type.name === 'listItemBlock' && $cursor.parent.content.size === 0) {
    console.log('[BlockEditing] 处理空列表项');
    event.preventDefault(); // 阻止默认的 Enter 行为 (如创建新列表项或跳出列表)
    if (!editor.commands.setBaseBlock()) {
        // 如果转换为基础块的命令执行失败，记录警告
        console.warn('Enter 处理：将空列表项转换为基础块的操作失败。');
    }
    return true; // 事件已处理
  }

  // --- 处理在空引用块 (quoteBlock) 中按回车的情况 ---
  if ($cursor && $cursor.parent.type.name === 'quoteBlock' && $cursor.parent.content.size === 0) {
    console.log('[BlockEditing] 处理空引用块');
    event.preventDefault(); // 阻止默认的 Enter 行为
    if (!editor.commands.setBaseBlock()) {
        // 如果转换为基础块的命令执行失败，记录警告
        console.warn('Enter 处理：将空引用块转换为基础块的操作失败。');
    }
    return true; // 事件已处理
  }

  // --- 处理在块首按回车的情况：在前面插入新的基础块 ---
  if ($cursor && $cursor.parentOffset === 0) {
    event.preventDefault();
    
    // 获取当前光标位置
    const currentPos = $cursor.pos;
    
    // console.log('[BlockEditing] 当前光标位置:', currentPos);
    
    // 使用InsertCommands中的createRootBlock命令
    // 关键: 设置 focusNewBlock: false
    // 这会在当前块之前插入一个新块，但保持光标在原来的块中（即现在下方的块）。
    // 这解决了批注（annotation）跟随内容移动的问题，因为原块的ID没有改变。
    const success = editor.commands.createRootBlock({
      position: 'before',
      referencePos: currentPos,
      focusNewBlock: false, // 核心改动
    });
    
    if (!success) {
      console.warn('Enter 处理：创建新rootBlock失败。');
    }
    
    return true; // 事件已处理
  }


  // --- 通用回车键处理：在当前光标位置拆分块 ---
  console.log('[BlockEditing] 执行拆分逻辑');
  event.preventDefault(); // 总是阻止默认的 Enter 行为，交由我们的 splitBlock 命令处理
  
  const { from } = editor.state.selection; // 获取当前选区的起始位置作为拆分点
  if (!editor.commands.splitBlockCommand(from)) { 
    // 如果拆分块的命令执行失败或因某些验证未执行，记录警告
    console.warn('Enter 处理：调用 splitBlockCommand 命令失败或未执行。');
  }
  return true; // 事件已处理（无论 splitBlock 是否成功，我们都接管了 Enter 行为）
}

/**
 * 处理在块首按 Backspace 键的情况。
 * 行为优先级如下:
 * 1. 列表项 (ListItemBlock): 
 *    - 如果 level > 0 (有缩进层级)，则减少 level (提升一级)。
 *    - 如果 level === 0 (无缩进)，则将其转换为基础块 (baseBlock)。
 * 2. 引用块 (QuoteBlock): 将其转换为基础块 (baseBlock)。
 * 3. 基础块 (BaseBlock) 或标题块 (HeadingBlock) (如果它们有 indent 属性且大于0):
 *    - 减少 indent 属性值 (减少缩进)。
 * 4. 其他非基础块类型的块 (且无特殊处理，如 CodeBlock 可能有自己的处理逻辑):
 *    - 将其转换为基础块 (baseBlock)。
 * 5. 基础块 (BaseBlock) (无 indent 属性或 indent 为0):
 *    - 检查前方紧邻的是否为水平分割线 (HorizontalRuleBlock)，如果是，则选中该水平分割线。
 *    - 否则，允许默认行为 (通常是尝试向上与前一个块合并，即 ProseMirror 的 joinBackward)。
 * @param {object} context - 包含 view, event, state, dispatch, selection, doc, $cursor, editor 等上下文信息的对象。
 * @returns {boolean} - 如果事件已被处理则返回 true，否则返回 false。
 */
export function handleBackspace({ view, event, state, dispatch, selection, doc, $cursor, editor }) {
  if (event.key !== 'Backspace') {
    return false;
  }

  // 如果选区是 NodeSelection (例如，选中了整个 HorizontalRuleBlock)
  if (selection instanceof NodeSelection && selection.node.type.name === 'horizontalRuleBlock') {
    // 允许默认行为，这将删除节点
    return false; // 不处理，允许默认行为
  }
  
  // 如果光标 ($cursor) 无效，或者光标不在其父节点内容的起始位置 (parentOffset !== 0)
  if (!$cursor || $cursor.parentOffset !== 0) {
    // console.debug('Backspace 处理：光标不在块首，允许默认行为删除字符。');
    return false; // 不处理，光标不在块首，执行常规字符删除
  }

  // 获取当前光标所在的内容块节点及其属性
  const currentContentNode = $cursor.parent;
  const currentIndent = currentContentNode.attrs.indent || 0;
  const currentLevel = currentContentNode.attrs.level; // 主要用于列表项

  // 1. 处理列表项 (listItemBlock)
  if (currentContentNode.type.name === 'listItemBlock') {
    event.preventDefault(); // 接管 Backspace 行为
    if (currentLevel > 0) {
      // console.debug(`Backspace 处理：在列表项 (level ${currentLevel}) 的开头，减少缩进层级。`);
      const newLevel = currentLevel - 1;
      // 找到当前列表项节点以便修改其属性
      const listItemInfo = findParentNode(node => node.type.name === 'listItemBlock')(selection);
      if (listItemInfo) {
        const { node, pos } = listItemInfo;
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: newLevel });
        dispatch(tr);
      }
    } else {
      // console.debug('Backspace 处理：在列表项 (level 0) 的开头，转换为基础块。');
      if(!editor.commands.setBaseBlock()) {
        console.warn('Backspace 处理：将列表项 (level 0) 转换为基础块失败。');
      }
    }
    return true; // 事件已处理
  }

  // 2. 处理引用块 (quoteBlock)
  if (currentContentNode.type.name === 'quoteBlock') {
    event.preventDefault(); // 接管 Backspace 行为
    // console.debug('Backspace 处理：在引用块的开头，转换为基础块。');
    if(!editor.commands.setBaseBlock()){
        console.warn('Backspace 处理：将引用块转换为基础块失败。');
    }
    return true; // 事件已处理
  }

  // 3. 处理带缩进的基础块或标题块
  if (currentIndent > 0 && (currentContentNode.type.name === 'baseBlock' || currentContentNode.type.name === 'headingBlock')) {
    event.preventDefault(); // 接管 Backspace 行为
    // console.debug(`Backspace 处理：在有缩进的 ${currentContentNode.type.name} 块的开头，减少缩进。`);
    const newIndent = Math.max(currentIndent - 1, 0);
    if (!editor.commands.updateAttributes) {
         console.error('[BlockEditing Backspace] updateAttributes 命令未在编辑器中注册!');
         return true; // 即使命令未注册，也已尝试处理
    }
    if (!editor.commands.updateAttributes(currentContentNode.type.name, { indent: newIndent })) {
        console.warn('[BlockEditing Backspace] 调用 updateAttributes 命令减少缩进失败。');
    }
    return true; // 事件已处理
  }
  
  // 4. 处理其他非基础块 (且无缩进或未被上述逻辑处理的块)
  // 例如：一个自定义块，在块首按 Backspace 希望它变回普通段落
  if (currentContentNode.type.name !== 'baseBlock') {
    // 此条件确保我们不会对已经是 baseBlock 的块再次执行 setBaseBlock
    // 也排除了已经被 indent 或 listItem 逻辑处理的 headingBlock
    event.preventDefault(); // 接管 Backspace 行为
    // console.debug(`Backspace 处理：在 ${currentContentNode.type.name} 块 (无缩进或非特殊处理类型) 的开头，转换为基础块。');
    if(!editor.commands.setBaseBlock()){
        console.warn(`Backspace 处理：将 ${currentContentNode.type.name} 块转换为基础块失败。`);
    }
    return true; // 事件已处理
  }
  
  // 5. 处理无缩进的基础块 (baseBlock)
  if (currentContentNode.type.name === 'baseBlock') {
    // console.debug('Backspace 处理：在无缩进的基础块的开头。');
    // 查找当前基础块所属的根块 (rootBlock)
    const rootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);
  
    if (rootBlockInfo) {
        const currentRootBlockPos = rootBlockInfo.pos;
        let prevRootBlockNode = null;
        let prevRootBlockPos = -1;

        // 查找当前根块之前最近的一个根块
        if (currentRootBlockPos > 0) {
             state.doc.nodesBetween(0, currentRootBlockPos, (node, pos) => {
                if (node.type.name === 'rootBlock' && pos < currentRootBlockPos) {
                    // 记录最后一个在当前根块之前的根块
                    prevRootBlockNode = node;
                    prevRootBlockPos = pos;
                }
                return true; // 继续遍历直到 currentRootBlockPos
             });
        }

        // 如果前一个根块存在，并且其内容是水平分割线
        if (prevRootBlockNode && prevRootBlockPos !== -1 && prevRootBlockNode.content?.firstChild?.type?.name === 'horizontalRuleBlock') {
            event.preventDefault(); // 接管 Backspace 行为
            // console.debug('Backspace 处理：前方是水平分割线块，选中该水平分割线。');
            // 创建一个节点选区选中该水平分割线所在的根块（或直接选中水平分割线本身，取决于 schema 和期望行为）
            const tr = state.tr.setSelection(NodeSelection.create(doc, prevRootBlockPos));
            dispatch(tr);
            return true; // 事件已处理
        }
    }
    // console.debug('Backspace 处理：在无缩进基础块的开头，且前方无特殊情况（如水平分割线），允许默认向上合并 (joinBackward)。');
    return false; // 未在此处处理，允许 ProseMirror 的默认 joinBackward 等行为
  }

  // 默认情况下，不处理事件，允许其他键盘处理器或浏览器的默认行为
  return false;
}

/**
 * 处理在空块末尾按 Delete 键的情况。
 * 主要逻辑是尝试向前合并 (joinForward)，或者如果前方是特定类型的节点（如水平分割线），则选中它。
 * @param {object} context - 包含 state, dispatch, editor 等上下文信息的对象。
 * @returns {boolean} - 如果事件已被处理则返回 true，否则返回 false。
 */
export function handleDeleteOnEmptyBlock({ state, dispatch, editor }) {
  const { selection, doc } = state;
  // 此处理仅针对文本光标 (TextSelection) 且光标是折叠的 (没有选中文本范围)
  if (!(selection instanceof TextSelection && selection.empty)) {
    return false;
  }

  const { $from } = selection; // 获取选区起始点（对于折叠光标，即光标位置）
  // 光标必须精确位于其父节点内容的末尾
  if ($from.parentOffset !== $from.parent.content.size) {
    return false;
  }
  
  // 父节点（通常是 contentBlock，如 baseBlock）必须是空的
  if ($from.parent.content.size !== 0) {
    // console.debug('handleDeleteOnEmptyBlock: 当前块非空，不处理。');
    return false;
  }

  // console.debug('handleDeleteOnEmptyBlock: 在空块的末尾检测到 Delete。');

  // 1. 尝试向前合并 (joinForward)
  // 这是 ProseMirror 的标准命令，尝试将当前块与下一个块合并（如果类型兼容）
  if (joinForward(state, dispatch)) {
    // console.debug('handleDeleteOnEmptyBlock: joinForward 命令成功执行。');
    return true; // 事件已处理
  }

  // 2. 如果向前合并失败 (例如，下一个块是水平分割线或不兼容的类型)，
  //    则尝试选中下一个节点。这对于删除空块后，光标能方便地操作后续的特殊节点（如HR）很有用。
  //    ProseMirror 的 selectNodeForward 命令通常能处理这种情况。
  const currentRootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);
  if (currentRootBlockInfo) {
    const afterCurrentRootBlockPos = currentRootBlockInfo.pos + currentRootBlockInfo.node.nodeSize;
    if (afterCurrentRootBlockPos < doc.content.size) {
      const nextNode = doc.nodeAt(afterCurrentRootBlockPos);
      // 特别检查下一个节点是否为包含水平分割线的根块
      if (nextNode && nextNode.type.name === 'rootBlock' && 
          nextNode.content && nextNode.content.firstChild && 
          nextNode.content.firstChild.type.name === 'horizontalRuleBlock') {
        // console.debug('handleDeleteOnEmptyBlock: 下一个块是水平分割线，尝试使用 selectNodeForward 选中它。');
        if (selectNodeForward(state, dispatch)) {
          return true; // 事件已处理
        }
      }
    }
  }
  
  // console.debug('handleDeleteOnEmptyBlock: joinForward 和针对水平分割线的 selectNodeForward 均未处理或不适用。');
  // 如果上述操作都未处理事件（例如，已在文档末尾，或下一个节点无法合并也非特殊可选节点），则不处理
  return false;
}

// 移除 Extension 定义
// export const BlockEditingExtension = Extension.create(...);
// export default BlockEditingExtension;
