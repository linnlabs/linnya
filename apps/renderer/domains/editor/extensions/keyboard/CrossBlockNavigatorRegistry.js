/**
 * @typedef {Object} HandlerContext
 * @property {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @property {import('@tiptap/pm/state').Transaction} transaction - ProseMirror 事务
 */

/**
 * @typedef {object} BlockInfo
 * @property {import('prosemirror-model').Node} contentNode - 块的内容节点 (e.g., table)
 * @property {number} nodePos - 内容节点在文档中的起始位置
 */

/**
 * @typedef {object} Navigator
 * @property {(context: HandlerContext, blockInfo: BlockInfo) => boolean} onEnter - 从前一个块进入此块时的处理器
 * @property {(context: HandlerContext, blockInfo: BlockInfo) => boolean} onExit - 从此块退出到后一个块时的处理器
 */

export class CrossBlockNavigatorRegistry {
  /**
   * @private
   * @type {Map<string, Navigator>}
   */
  #navigators = new Map();

  /**
   * 注册一个节点的跨块导航处理器。
   * @param {string} nodeTypeName - 节点类型名称 (e.g., 'table')
   * @param {Partial<Navigator>} navigator - 包含 onEnter 和/或 onExit 处理器的对象
   */
  register(nodeTypeName, navigator) {
    if (!this.#navigators.has(nodeTypeName)) {
      this.#navigators.set(nodeTypeName, {});
    }
    const existing = this.#navigators.get(nodeTypeName);
    this.#navigators.set(nodeTypeName, { ...existing, ...navigator });
  }

  /**
   * 注销一个节点的跨块导航处理器。
   * @param {string} nodeTypeName - 节点类型名称
   */
  unregister(nodeTypeName) {
    this.#navigators.delete(nodeTypeName);
  }

  /**
   * 获取指定节点的导航处理器。
   * @param {string} nodeTypeName - 节点类型名称
   * @returns {Navigator | undefined}
   */
  getNavigator(nodeTypeName) {
    return this.#navigators.get(nodeTypeName);
  }
} 