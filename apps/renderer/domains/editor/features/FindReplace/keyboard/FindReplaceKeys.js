/**
 * FindReplaceKeys.js
 *
 * 提供查找替换功能的键盘处理函数
 * 按照 KeyboardRegistry 标准实现
 */

/**
 * 处理 Mod+F (Ctrl/Cmd+F) 快捷键，打开查找替换面板
 * 注意：此函数现在主要由全局键盘监听器处理（AppLayout.vue）
 * 编辑器内的处理仅作为备用或特殊情况处理
 * @param {object} context - HandlerContext 对象
 * @returns {boolean} - 如果事件被处理则返回 true
 */
export function handleOpenFindReplace({ editor, event }) {
  // 防止浏览器默认的查找行为
  event.preventDefault()

  // 获取 store
  const store = editor.storage.findReplaceStore
  if (!store) {
    console.warn('[FindReplace] Store not found in editor.storage')
    return false
  }

  // 如果面板已打开，不重复处理
  if (store.isPanelVisible) {
    return true
  }

  // 显示面板
  store.showPanel()

  return true
}

/**
 * 处理 Mod+G 快捷键，跳转到下一个匹配
 * @param {object} context - HandlerContext 对象
 * @returns {boolean} - 如果事件被处理则返回 true
 */
export function handleFindNext({ editor, event }) {
  const store = editor.storage.findReplaceStore
  if (!store || !store.isPanelVisible || !store.hasMatches) {
    return false
  }

  event.preventDefault()

  // 执行查找下一个命令
  if (editor.commands.findNext) {
    editor.commands.findNext()
  }

  return true
}

/**
 * 处理 Shift+Mod+G 快捷键，跳转到上一个匹配
 * @param {object} context - HandlerContext 对象
 * @returns {boolean} - 如果事件被处理则返回 true
 */
export function handleFindPrev({ editor, event }) {
  const store = editor.storage.findReplaceStore
  if (!store || !store.isPanelVisible || !store.hasMatches) {
    return false
  }

  event.preventDefault()

  // 执行查找上一个命令
  if (editor.commands.findPrev) {
    editor.commands.findPrev()
  }

  return true
}

/**
 * 处理 Escape 键，关闭查找替换面板
 * @param {object} context - HandlerContext 对象
 * @returns {boolean} - 如果事件被处理则返回 true
 */
export function handleCloseFindReplace({ editor, event }) {
  const store = editor.storage.findReplaceStore
  if (!store || !store.isPanelVisible) {
    return false
  }

  event.preventDefault()

  // 隐藏面板并清除搜索
  store.hidePanel()
  store.reset()

  if (editor.commands.clearSearch) {
    editor.commands.clearSearch()
  }

  return true
}
