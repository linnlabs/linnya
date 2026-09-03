// src/renderer/extensions/interaction/commands/ReplaceCommands.js

import { TextSelection } from 'prosemirror-state';
import { findParentNode } from '@tiptap/core';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';

/**
 * Replaces the current RootBlock with a new RootBlock containing a single specified content node.
 * Assumes the trigger text (if any) has already been deleted from the transaction.
 * Designed for smooth transitions, like Markdown input rules.
 *
 * @param {string} targetNodeType - The name of the content node type to create (e.g., 'listItemBlock', 'headingBlock').
 * @param {Object} targetNodeAttrs - Attributes for the new content node.
 * @returns {import('@tiptap/core').Command}
 */
export const replaceCurrentBlockWithNodeCmd = (targetNodeType, targetNodeAttrs = {}) => ({ state, dispatch }) => {
  const { schema, selection } = state;
  let tr = state.tr;

  // 1. Find the current RootBlock based on the CURRENT selection in the state
  const $pos = selection.$from;
  let rootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')($pos);

  if (!rootBlockInfo) {
    // Fallback: Resolve position explicitly if needed
    const $resolvedPos = state.doc.resolve(selection.from);
    rootBlockInfo = findParentNode(node => node.type.name === 'rootBlock')($resolvedPos);
    if (!rootBlockInfo) {
        console.warn('[replaceCurrentBlockWithNodeCmd] Cannot find parent RootBlock at current selection.');
        return false;
    }
  }

  // 2. Create the new content node
  const targetNodeConstructor = schema.nodes[targetNodeType];
  if (!targetNodeConstructor) {
      console.error(`[replaceCurrentBlockWithNodeCmd] Unknown node type: ${targetNodeType}`);
      return false;
  }
  const finalAttrs = {
      id: generateBlockId(),
      ...targetNodeAttrs
  };
  // 如果是 horizontalRuleBlock，确保 blockType 正确
  if (targetNodeType === 'horizontalRuleBlock' && !finalAttrs.blockType) {
       finalAttrs.blockType = 'horizontalRuleBlock';
   }
  const newContentNode = targetNodeConstructor.create(finalAttrs);

  // 3. Create a new RootBlock
  const newRootBlockNode = schema.nodes.rootBlock.create(
    { id: generateRootBlockId() },
    [newContentNode]
  );

  // 4. Get the range of the current RootBlock
  const rootBlockFrom = rootBlockInfo.pos;
  const rootBlockTo = rootBlockInfo.pos + rootBlockInfo.node.nodeSize;

  // 5. Replace the current RootBlock IN THE NEW TRANSACTION 'tr'
  tr.replaceWith(rootBlockFrom, rootBlockTo, newRootBlockNode);

  // 6. Set the cursor
  const newSelectionPos = rootBlockFrom + 2;
  if (newSelectionPos <= tr.doc.content.size) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(newSelectionPos), 1));
  } else {
      const fallbackPos = Math.min(rootBlockFrom + 1, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, fallbackPos));
  }

  // 7. Dispatch the transaction
  if (dispatch) {
    dispatch(tr.scrollIntoView());
    return true;
  }

  return false;
};

export default {
  replaceCurrentBlockWithNodeCmd,
};
