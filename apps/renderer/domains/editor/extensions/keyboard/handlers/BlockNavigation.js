import { TextSelection, NodeSelection } from 'prosemirror-state';

/**
 * 将光标安全地设置到指定位置。
 * @param {object} context - 包含 dispatch, state, event 的上下文对象
 * @param {number} position - 目标位置
 */
function setCursor(context, position) {
  const { dispatch, state, event } = context;
  try {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView();
    dispatch(tr);
    event.preventDefault();
    return true;
  } catch (e) {
    console.error(`[BlockNavigation] Error setting selection to pos ${position}:`, e);
    return false;
  }
}

/**
 * 处理向下箭头在块边界的导航。
 * @param {object} context
 * @returns {boolean}
 */
export function handleBlockArrowDown(context) {
  const { state, getPosUtils, view, editor, dispatch } = context;
  const { selection } = state;

  // 情况一：当前是 NodeSelection (已选中一个块)
  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    if (selectedNode.type.name === 'rootBlock') {
      const posUtils = getPosUtils();
      const nextBlock = posUtils.findNextNode(selectedNode.attrs.id, 'rootBlock');

      if (nextBlock) {
        const nextContentBlock = nextBlock.node.firstChild;
        if (!nextContentBlock) return false;

        // 检查下一个块是否有专用导航器 (如表格)
        const registry = editor.storage.crossBlockNavigatorRegistry;
        if (registry) {
          const navigator = registry.getNavigator(nextContentBlock.type.name);
          if (navigator?.onEnter) {
            const blockInfo = { contentNode: nextContentBlock, nodePos: nextBlock.pos + 1 };
            return navigator.onEnter(context, blockInfo, 'start');
          }
        }
        
        // 否则，检查是否是原子块
        if (nextContentBlock.type.isAtom) {
          const nodeSelection = NodeSelection.create(state.doc, nextBlock.pos);
          dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
        } else {
          // 最后，作为普通文本块处理
          const textSelection = TextSelection.create(state.doc, nextBlock.pos + 2);
          dispatch(state.tr.setSelection(textSelection).scrollIntoView());
        }
        return true;
      }
    }
  }

  // 情况二：当前是 TextSelection (光标状态)
  if (selection instanceof TextSelection && selection.empty) {
    const { $cursor } = context;
    if (!$cursor || !view.endOfTextblock("down")) {
      return false;
    }
    
    const posUtils = getPosUtils();
    const currentBlockInfo = posUtils.resolver.getBlockInfoFromPos($cursor.pos);
    if (!currentBlockInfo?.rootBlock) return false;
    
    const nextBlock = posUtils.findNextNode(currentBlockInfo.rootBlock.node.attrs.id, 'rootBlock');
    if (!nextBlock) return false;

    const nextContentBlock = nextBlock.node.firstChild;
    if (!nextContentBlock) return false;

    // 如果下一个块是原子节点，则选中它
    if (nextContentBlock.type.isAtom) {
      const nodeSelection = NodeSelection.create(state.doc, nextBlock.pos);
      dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
      return true;
    }

    // 如果是其他复杂节点（如表格），走定制化导航逻辑
    const registry = editor.storage.crossBlockNavigatorRegistry;
    if (registry) {
      const navigator = registry.getNavigator(nextContentBlock.type.name);
      if (navigator?.onEnter) {
        const blockInfo = { contentNode: nextContentBlock, nodePos: nextBlock.pos + 1 };
        return navigator.onEnter(context, blockInfo, 'start');
      }
    }
  }

  return false;
}

/**
 * 处理向上箭头在块边界的导航。
 * @param {object} context
 * @returns {boolean}
 */
export function handleBlockArrowUp(context) {
  const { state, getPosUtils, view, editor, dispatch } = context;
  const { selection } = state;

  // 情况一：当前是 NodeSelection (已选中一个块)
  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    if (selectedNode.type.name === 'rootBlock') {
      const posUtils = getPosUtils();
      const prevBlock = posUtils.findPreviousNode(selectedNode.attrs.id, 'rootBlock');

      if (prevBlock) {
        const prevContentBlock = prevBlock.node.firstChild;
        if (!prevContentBlock) return false;

        // 检查上一个块是否有专用导航器 (如表格)
        const registry = editor.storage.crossBlockNavigatorRegistry;
        if (registry) {
          const navigator = registry.getNavigator(prevContentBlock.type.name);
          if (navigator?.onEnter) {
            const blockInfo = { contentNode: prevContentBlock, nodePos: prevBlock.pos + 1 };
            return navigator.onEnter(context, blockInfo, 'end');
          }
        }
        
        // 否则，检查是否是原子块
        if (prevContentBlock.type.isAtom) {
          const nodeSelection = NodeSelection.create(state.doc, prevBlock.pos);
          dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
        } else {
          // 最后，作为普通文本块处理
          const endPos = prevBlock.pos + prevBlock.node.nodeSize - 2;
          const textSelection = TextSelection.create(state.doc, endPos);
          dispatch(state.tr.setSelection(textSelection).scrollIntoView());
        }
        return true;
      }
    }
  }
  
  // 情况二：当前是 TextSelection (光标状态)
  if (selection instanceof TextSelection && selection.empty) {
    const { $cursor } = context;
    if (!$cursor || !view.endOfTextblock("up")) {
      return false;
    }
    
    const posUtils = getPosUtils();
    const currentBlockInfo = posUtils.resolver.getBlockInfoFromPos($cursor.pos);
    if (!currentBlockInfo?.rootBlock) return false;
    
    const prevBlock = posUtils.findPreviousNode(currentBlockInfo.rootBlock.node.attrs.id, 'rootBlock');
    if (!prevBlock) return false;

    const prevContentBlock = prevBlock.node.firstChild;
    if (!prevContentBlock) return false;

    // 如果上一个块是原子节点，则选中它
    if (prevContentBlock.type.isAtom) {
      const nodeSelection = NodeSelection.create(state.doc, prevBlock.pos);
      dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
      return true;
    }
    
    // 如果是其他复杂节点（如表格），走定制化导航逻辑
    const registry = editor.storage.crossBlockNavigatorRegistry;
    if (registry) {
      const navigator = registry.getNavigator(prevContentBlock.type.name);
      if (navigator?.onEnter) {
        const blockInfo = { contentNode: prevContentBlock, nodePos: prevBlock.pos + 1 };
        return navigator.onEnter(context, blockInfo, 'end');
      }
    }
  }

  return false;
} 

/**
 * 处理向右箭头在块边界的导航。
 * @param {object} context
 * @returns {boolean}
 */
export function handleBlockArrowRight(context) {
  const { state, getPosUtils, editor, dispatch } = context;
  const { selection } = state;

  // 情况一：当前是 NodeSelection
  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    if (selectedNode.type.name === 'rootBlock') {
      const posUtils = getPosUtils();
      const nextBlock = posUtils.findNextNode(selectedNode.attrs.id, 'rootBlock');

      if (nextBlock) {
        const nextContentBlock = nextBlock.node.firstChild;
        if (!nextContentBlock) return false;

        const registry = editor.storage.crossBlockNavigatorRegistry;
        if (registry) {
          const navigator = registry.getNavigator(nextContentBlock.type.name);
          if (navigator?.onEnter) {
            const blockInfo = { contentNode: nextContentBlock, nodePos: nextBlock.pos + 1 };
            return navigator.onEnter(context, blockInfo, 'start');
          }
        }
        
        if (nextContentBlock.type.isAtom) {
          const nodeSelection = NodeSelection.create(state.doc, nextBlock.pos);
          dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
        } else {
          const textSelection = TextSelection.create(state.doc, nextBlock.pos + 2);
          dispatch(state.tr.setSelection(textSelection).scrollIntoView());
        }
        return true;
      }
    }
  }

  // 情况二：当前是 TextSelection
  if (selection instanceof TextSelection && selection.empty) {
    const { $cursor } = context;
    if (!$cursor || $cursor.parentOffset < $cursor.parent.content.size) {
      return false;
    }

    const posUtils = getPosUtils();
    const currentBlockInfo = posUtils.resolver.getBlockInfoFromPos($cursor.pos);
    if (!currentBlockInfo?.rootBlock) return false;

    const nextBlock = posUtils.findNextNode(currentBlockInfo.rootBlock.node.attrs.id, 'rootBlock');
    if (!nextBlock) return false;

    const nextContentBlock = nextBlock.node.firstChild;
    if (!nextContentBlock) return false;

    if (nextContentBlock.type.isAtom) {
      const nodeSelection = NodeSelection.create(state.doc, nextBlock.pos);
      dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
      return true;
    }
    
    const registry = editor.storage.crossBlockNavigatorRegistry;
    if (registry) {
      const navigator = registry.getNavigator(nextContentBlock.type.name);
      if (navigator?.onEnter) {
        const blockInfo = { contentNode: nextContentBlock, nodePos: nextBlock.pos + 1 };
        return navigator.onEnter(context, blockInfo, 'start');
      }
    }
  }

  return false;
}

/**
 * 处理向左箭头在块边界的导航。
 * @param {object} context
 * @returns {boolean}
 */
export function handleBlockArrowLeft(context) {
  const { state, getPosUtils, editor, dispatch } = context;
  const { selection } = state;

  // 情况一：当前是 NodeSelection
  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    if (selectedNode.type.name === 'rootBlock') {
      const posUtils = getPosUtils();
      const prevBlock = posUtils.findPreviousNode(selectedNode.attrs.id, 'rootBlock');

      if (prevBlock) {
        const prevContentBlock = prevBlock.node.firstChild;
        if (!prevContentBlock) return false;

        const registry = editor.storage.crossBlockNavigatorRegistry;
        if (registry) {
          const navigator = registry.getNavigator(prevContentBlock.type.name);
          if (navigator?.onEnter) {
            const blockInfo = { contentNode: prevContentBlock, nodePos: prevBlock.pos + 1 };
            return navigator.onEnter(context, blockInfo, 'end');
          }
        }
        
        if (prevContentBlock.type.isAtom) {
          const nodeSelection = NodeSelection.create(state.doc, prevBlock.pos);
          dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
        } else {
          const endPos = prevBlock.pos + prevBlock.node.nodeSize - 2;
          const textSelection = TextSelection.create(state.doc, endPos);
          dispatch(state.tr.setSelection(textSelection).scrollIntoView());
        }
        return true;
      }
    }
  }

  // 情况二：当前是 TextSelection
  if (selection instanceof TextSelection && selection.empty) {
    const { $cursor } = context;
    if (!$cursor || $cursor.parentOffset > 0) {
      return false;
    }

    const posUtils = getPosUtils();
    const currentBlockInfo = posUtils.resolver.getBlockInfoFromPos($cursor.pos);
    if (!currentBlockInfo?.rootBlock) return false;

    const prevBlock = posUtils.findPreviousNode(currentBlockInfo.rootBlock.node.attrs.id, 'rootBlock');
    if (!prevBlock) return false;

    const prevContentBlock = prevBlock.node.firstChild;
    if (!prevContentBlock) return false;
    
    if (prevContentBlock.type.isAtom) {
      const nodeSelection = NodeSelection.create(state.doc, prevBlock.pos);
      dispatch(state.tr.setSelection(nodeSelection).scrollIntoView());
      return true;
    }

    const registry = editor.storage.crossBlockNavigatorRegistry;
    if (registry) {
      const navigator = registry.getNavigator(prevContentBlock.type.name);
      if (navigator?.onEnter) {
        const blockInfo = { contentNode: prevContentBlock, nodePos: prevBlock.pos + 1 };
        return navigator.onEnter(context, blockInfo, 'end');
      }
    }
  }
  
  return false;
} 