import { generateBlockId } from '../../../../../shared/utils/idUtils';
import { findParentNode } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';

/**
 * 插入带有内容的LaTeX块，并自动在其后创建一个空块
 * @param {string} content - LaTeX公式内容
 * @returns {Function} - 返回命令函数
 */
export function insertLatexBlockWithContent(content) {
  return ({ editor, commands }) => {
    console.log('[LatexCommands] insertLatexBlockWithContent called. Content preview:', content?.substring(0, 30));
    const { state } = editor;
    const { selection } = state;
    const { $from, from, to } = selection;
    const docSize = state.doc.content.size;

    console.log('[LatexCommands] Current selection:', { from, to, empty: selection.empty, anchor: selection.anchor, head: selection.head });
    console.log('[LatexCommands] Current $from:', { pos: $from.pos, parentOffset: $from.parentOffset, depth: $from.depth, nodeBefore: $from.nodeBefore?.type.name, nodeAfter: $from.nodeAfter?.type.name });
    console.log('[LatexCommands] Document size:', docSize);

    // --- 检查当前是否在文档末尾的空 BaseBlock 中 ---
    let shouldReplace = false;
    let replacePos = -1;
    let replaceNodeSize = 0;

    const parentBaseBlockInfo = findParentNode(node => node.type.name === 'baseBlock')(selection);
    console.log('[LatexCommands] parentBaseBlockInfo:', parentBaseBlockInfo ? { name: parentBaseBlockInfo.node.type.name, pos: parentBaseBlockInfo.pos, size: parentBaseBlockInfo.node.content.size } : null);

    if (
      parentBaseBlockInfo &&
      parentBaseBlockInfo.node.content.size === 0 // 是空块
    ) {
      console.log('[LatexCommands] Found an empty parent baseBlock.');
      const parentRootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);
      console.log('[LatexCommands] parentRootBlockInfo for empty baseBlock:', parentRootBlockInfo ? { name: parentRootBlockInfo.node.type.name, pos: parentRootBlockInfo.pos, nodeSize: parentRootBlockInfo.node.nodeSize } : null);

      if (parentRootBlockInfo) {
        const rootBlockEndPos = parentRootBlockInfo.pos + parentRootBlockInfo.node.nodeSize;
        console.log('[LatexCommands] Calculated rootBlockEndPos:', rootBlockEndPos, 'Doc size for comparison:', docSize);
        // 确保这个 rootBlock 确实是文档的最后一个节点
        if (rootBlockEndPos === docSize) {
           shouldReplace = true;
           replacePos = parentRootBlockInfo.pos;
           replaceNodeSize = parentRootBlockInfo.node.nodeSize;
           console.log(`[LatexCommands] Detected empty block at the end of the document. Will perform replacement. Position: ${replacePos}, NodeSize: ${replaceNodeSize}`);
        } else {
          console.log('[LatexCommands] Empty baseBlock found, but its rootBlock is not the last node of the document.');
        }
      }
    } else {
      console.log('[LatexCommands] No empty parent baseBlock found, or parentBaseBlockInfo is null.');
    }
    // --- 结束检查 ---
    console.log('[LatexCommands] After check, shouldReplace:', shouldReplace, 'replacePos:', replacePos);

    try {
      // 生成唯一ID
      const blockId = generateBlockId();
      const baseBlockId = generateBlockId();
      
      // 创建需要插入/替换的节点
      const latexNode = editor.schema.nodes.latexBlock.create({
        id: blockId,
        latexSource: content || ''
      });
      const baseNode = editor.schema.nodes.baseBlock.create({
        id: baseBlockId
      });
      const latexRootNode = editor.schema.nodes.rootBlock.create({}, [latexNode]);
      const baseRootNode = editor.schema.nodes.rootBlock.create({}, [baseNode]);
      
      console.log('[LatexCommands] Nodes created. LatexRootNode size:', latexRootNode.nodeSize, 'BaseRootNode size:', baseRootNode.nodeSize);
      
      // 创建事务
      const tr = state.tr;

      if (shouldReplace && replacePos !== -1) {
        // --- 执行替换逻辑 ---
        console.log(`[LatexCommands] Executing replacement logic. Replacing from ${replacePos} to ${replacePos + replaceNodeSize}`);
        tr.replaceWith(replacePos, replacePos + replaceNodeSize, latexRootNode);
        
        // 在替换后的 LaTeX 块之后插入新的空块
        const insertPos = replacePos + latexRootNode.nodeSize;
        console.log(`[LatexCommands] Inserting new baseRootNode after replacement at: ${insertPos}`);
        tr.insert(insertPos, baseRootNode);
        
        // 设置光标到新的空块内
        const finalCursorPos = insertPos + 1 + 1; // +1 for rootBlock, +1 for baseBlock start tag
        console.log(`[LatexCommands] Setting selection after replacement to: ${finalCursorPos}`);
        tr.setSelection(TextSelection.near(tr.doc.resolve(finalCursorPos), 1)); // Bias towards forward
        
        console.log('[LatexCommands] Replacement and insertion of subsequent block completed.');

      } else {
        // --- 执行原来的末尾插入逻辑 ---
        let currentInsertionPos = $from.pos; // Default, might be overridden
        console.log(`[LatexCommands GEN-INSERT] ------ General Insertion Logic Start ------`);
        console.log(`[LatexCommands GEN-INSERT] Initial $from.pos: ${$from.pos}, $from.parent.type: ${$from.parent.type.name}, $from.parentOffset: ${$from.parentOffset}`);
        console.log(`[LatexCommands GEN-INSERT] $from.nodeBefore: ${$from.nodeBefore?.type.name}, $from.nodeAfter: ${$from.nodeAfter?.type.name}`);


        // 尝试找到当前选区所在的 rootBlock
        const currentRootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);
        console.log(`[LatexCommands GEN-INSERT] currentRootBlockInfo:`, currentRootBlockInfo ? { pos: currentRootBlockInfo.pos, nodeSize: currentRootBlockInfo.node.nodeSize, childCount: currentRootBlockInfo.node.childCount, firstChildType: currentRootBlockInfo.node.firstChild?.type.name } : null);

        if (currentRootBlockInfo) {
            const currentBaseBlockNode = currentRootBlockInfo.node.firstChild; // Assuming rootBlock > baseBlock structure
            const currentBaseBlockContentSize = currentBaseBlockNode?.content?.size || 0;
            const isCurrentBaseBlockEmpty = currentBaseBlockNode?.type.name === 'baseBlock' && currentBaseBlockContentSize === 0;
            // Condition: 光标是否在空 baseBlock 的开头 ($from.pos === rootBlock.pos + 1 for root, +1 for baseBlock start tag)
            // The resolved position for $from.pos is inside the baseBlock.
            // currentRootBlockInfo.pos is the start of the rootBlock.
            // So, $from.pos should be currentRootBlockInfo.pos + 1 (for rootBlock's open tag) + 1 (for baseBlock's open tag) = currentRootBlockInfo.pos + 2
            // Let's be more robust: check if $from is at the very start of the baseBlock's content area.
            // $from.parentOffset === 0 means cursor is at the start of its parent (baseBlock).
            const isCursorAtStartOfEmptyBaseBlock = isCurrentBaseBlockEmpty && $from.parent.type.name === 'baseBlock' && $from.parentOffset === 0;

            console.log(`[LatexCommands GEN-INSERT] currentBaseBlockNode type: ${currentBaseBlockNode?.type.name}, contentSize: ${currentBaseBlockContentSize}, isCurrentBaseBlockEmpty: ${isCurrentBaseBlockEmpty}`);
            console.log(`[LatexCommands GEN-INSERT] isCursorAtStartOfEmptyBaseBlock check: ($from.parent.type: ${$from.parent.type.name}, $from.parentOffset: ${$from.parentOffset}) -> ${isCursorAtStartOfEmptyBaseBlock}`);

            if (isCursorAtStartOfEmptyBaseBlock) {
                 console.log(`[LatexCommands GEN-INSERT] Path A: Current block is an empty baseBlock at pos ${currentRootBlockInfo.pos}. Replacing it.`);
                 tr.replaceWith(currentRootBlockInfo.pos, currentRootBlockInfo.pos + currentRootBlockInfo.node.nodeSize, latexRootNode);
                 currentInsertionPos = currentRootBlockInfo.pos; // The start of the replaced content
                 tr.insert(currentInsertionPos + latexRootNode.nodeSize, baseRootNode);
                 const finalCursorPos = currentInsertionPos + latexRootNode.nodeSize + 1 + 1; // +1 root, +1 base
                 tr.setSelection(TextSelection.near(tr.doc.resolve(finalCursorPos), 1));
                 console.log(`[LatexCommands GEN-INSERT] Path A: Replaced current empty block. New cursor at ${finalCursorPos}. Transaction:`, tr.steps);
            } else {
                // 在当前 rootBlock 之后插入
                currentInsertionPos = currentRootBlockInfo.pos + currentRootBlockInfo.node.nodeSize;
                console.log(`[LatexCommands GEN-INSERT] Path B: Not an empty baseBlock at cursor start OR baseBlock not empty. Inserting AFTER current rootBlock. Target insertion position: ${currentInsertionPos}`);
                tr.insert(currentInsertionPos, latexRootNode);
                console.log(`[LatexCommands GEN-INSERT] Path B: After inserting latexRootNode. Transaction:`, tr.steps);
                tr.insert(currentInsertionPos + latexRootNode.nodeSize, baseRootNode);
                console.log(`[LatexCommands GEN-INSERT] Path B: After inserting baseRootNode. Transaction:`, tr.steps);
                const finalCursorPos = currentInsertionPos + latexRootNode.nodeSize + 1 + 1; // +1 root, +1 base
                tr.setSelection(TextSelection.near(tr.doc.resolve(finalCursorPos), 1));
                console.log(`[LatexCommands GEN-INSERT] Path B: Inserted after current block. New cursor at ${finalCursorPos}. Transaction:`, tr.steps);
            }
        } else {
            // Fallback: 如果找不到当前 rootBlock
            currentInsertionPos = $from.pos;
            console.warn(`[LatexCommands GEN-INSERT] Path C (Fallback): Could not find parent rootBlock. Inserting at $from.pos: ${currentInsertionPos}`);
            tr.insert(currentInsertionPos, latexRootNode);
            tr.insert(currentInsertionPos + latexRootNode.nodeSize, baseRootNode);
            const finalCursorPos = currentInsertionPos + latexRootNode.nodeSize + 1 + 1;
            tr.setSelection(TextSelection.near(tr.doc.resolve(finalCursorPos), 1));
            console.log(`[LatexCommands GEN-INSERT] Path C: Fallback insertion. New cursor at ${finalCursorPos}. Transaction:`, tr.steps);
        }
        console.log(`[LatexCommands GEN-INSERT] ------ General Insertion Logic End ------`);
      }
      
      // 执行事务
      console.log('[LatexCommands] Dispatching transaction.');
      editor.view.dispatch(tr);
      console.log('[LatexCommands] Transaction dispatched. Returning true.');
      return true;
    } catch (error) {
      console.error('[LatexCommands] Error inserting/replacing LaTeX block:', error);
      return false;
    }
  };
}

// 导出所有LaTeX相关命令
export default {
  insertLatexBlockWithContent
};
