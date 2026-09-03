/* src/renderer/extensions/interaction/Keyboard/AiInteraction.js */
/**
 * AiInteraction.js
 * 
 * 提供处理 AI 交互相关快捷键的函数。
 */

/**
 * 处理空 BaseBlock 中的空格键，用于触发 AI Writing。
 * @param {object} context - 包含 view, event, $cursor, getPosUtils, getUIStore, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleSpaceForAI({ view, event, $cursor, getPosUtils, getUIStore, debugLog }) {

  if (event.key !== ' ' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }

  const uiStore = getUIStore();
  if (!uiStore) {
      return false;
  }
  if (uiStore.aiPromptVisible) {
    return false;
  }

  if (!$cursor) {
    return false;
  }

  const posUtils = getPosUtils();
  if (!posUtils) {
    return false;
  }
  const blockInfo = posUtils.getBlockInfoFromPos($cursor.pos);

  if (blockInfo?.contentBlock?.node?.type.name === 'baseBlock' &&
      blockInfo.contentBlock.node.content.size === 0) {

    event.preventDefault();

    const triggerPos = $cursor.pos;
    const rootBlockId = blockInfo.rootBlock?.node.attrs.id;

    if (!rootBlockId) {
      console.error('[AiInteraction Space] 无法获取 RootBlock ID');
      return true;
    }

    const blockElement = document.querySelector(`.root-block-outer[data-id="${rootBlockId}"]`);
    if (!blockElement) {
      console.error(`[AiInteraction Space] 无法找到 ID 为 ${rootBlockId} 的块元素`);
      return true;
    }

    const blockRect = blockElement.getBoundingClientRect();
    const position = {
        top: blockRect.bottom + 5,
    };

    uiStore.showAiPrompt({
      position,
      targetBlockId: rootBlockId,
      triggerPos: triggerPos
    });

    return true;
  } else {
    return false;
  }
}

/**
 * 处理 Ctrl/Cmd + J 快捷键，用于在当前块触发 AI Prompt。
 * @param {object} context - 包含 view, event, $cursor, getPosUtils, getUIStore, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleCtrlJ({ view, event, $cursor, getPosUtils, getUIStore, debugLog }) {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'j') {
    return false;
  }

  if (!$cursor) {
    return false;
  }

  event.preventDefault(); 

  const posUtils = getPosUtils();
  const cursorInfo = posUtils.getCursorInfo();

  if (!cursorInfo?.blockInfo?.rootBlock?.node.attrs.id) {
    console.error('[AiInteraction Ctrl+J] 无法获取当前光标的 rootBlock ID');
    return true; 
  }

  const rootBlockId = cursorInfo.blockInfo.rootBlock.node.attrs.id;
  const blockType = cursorInfo.blockInfo.contentBlock?.node.type.name; 

  const blockElement = document.querySelector(`.root-block-outer[data-id="${rootBlockId}"]`);
  if (!blockElement) {
    console.error(`[AiInteraction Ctrl+J] 无法找到 ID 为 ${rootBlockId} 的块元素`);
    return true;
  }

  const blockRect = blockElement.getBoundingClientRect();
  const position = {
    top: blockRect.bottom + 5, 
  };

  const uiStore = getUIStore();
  uiStore.showAiPrompt({ 
      position, 
      targetBlockId: rootBlockId,
      triggerPos: $cursor.pos 
  }); 

  return true; 
}
