/**
 * AnnotationKeys.js
 * 
 * 提供处理批注相关快捷键的函数。
 */

/**
 * 处理创建批注的快捷键。
 * 假设此函数被调用时，正确的快捷键组合 (macOS: Cmd+Option+A, Win/Linux: Ctrl+Alt+M)
 * 已经被 KeyboardRegistry 验证和匹配。
 * @param {object} context - 包含 event, $cursor, editor, getPosUtils, getAnnotationStore, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleAnnotationCreate({ event, $cursor, editor, getPosUtils, getAnnotationStore, debugLog }) {
  // 内部的修饰键和特定按键检查可以移除，因为 KeyboardRegistry 已处理
  debugLog('批注创建快捷键触发 (由 KeyboardRegistry 调度)');
  event.preventDefault(); // 阻止默认行为

  if (!$cursor) {
    console.warn('[AnnotationKeys] 没有光标位置，无法创建批注');
    return true; // 阻止默认行为
  }

  const posUtils = getPosUtils();
  const blockInfo = posUtils.getBlockInfoFromPos($cursor.pos);

  if (!blockInfo?.rootBlock?.node.attrs.id) {
    console.error('[AnnotationKeys] 无法获取当前光标的 rootBlock ID');
    return true; // 阻止默认行为
  }

  const rootBlockId = blockInfo.rootBlock.node.attrs.id;

  const annotationStore = getAnnotationStore();
  if (!annotationStore) {
    console.error('[AnnotationKeys] 无法访问 annotationStore。');
    return true; 
  }
  
  const existingAnnotations = annotationStore.getAnnotationsByBlockId(rootBlockId);
  if (existingAnnotations && existingAnnotations.length > 0) {
    // TODO: 未来可以添加聚焦到现有批注的逻辑
    return true; // 阻止创建新批注
  }

  try {
    let createAnnotationFn = null;
    if (typeof editor.triggerAnnotationCreate === 'function') {
      createAnnotationFn = editor.triggerAnnotationCreate;
    } else {
       const appInstance = window.__APP_INSTANCE__;
       if (appInstance && typeof appInstance.config.globalProperties.$triggerAnnotationCreate === 'function') {
         createAnnotationFn = appInstance.config.globalProperties.$triggerAnnotationCreate;
       } 
    }

    if (createAnnotationFn) {
      debugLog(`[AnnotationKeys] 调用 triggerAnnotationCreate 函数 for block ${rootBlockId}`);
      createAnnotationFn(rootBlockId); 
    } else {
      console.error('[AnnotationKeys] 无法访问批注创建函数。请确保 $triggerAnnotationCreate 已正确挂载。');
    }
  } catch (error) {
    console.error('[AnnotationKeys] 触发批注创建时出错:', error);
  }

  return true; 
} 