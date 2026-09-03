/**
 * PasteRegistry.js
 * 
 * 粘贴处理器注册中心
 * 管理所有粘贴和拖放操作的处理器，按优先级顺序执行
 * 
 * 参考 KeyboardRegistry 的设计模式
 */

/**
 * 粘贴处理器类型定义
 * @typedef {Object} PasteHandler
 * @property {string} name - 处理器名称（用于调试和日志）
 * @property {number} priority - 优先级（数值越大优先级越高）
 * @property {Function} canHandle - 判断是否可以处理该事件的函数
 * @property {Function} handle - 实际处理函数
 */

/**
 * 优先级常量定义
 */
export const PastePriority = {
  HIGHEST: 1000,  // 最高优先级（如特殊的富文本处理）
  HIGH: 500,      // 高优先级（如表格、HTML内容）
  NORMAL: 100,    // 普通优先级（如图片、文件）
  LOW: 50,        // 低优先级（如纯文本）
  LOWEST: 10      // 最低优先级（兜底处理）
};

export class PasteRegistry {
  constructor() {
    /** @type {PasteHandler[]} */
    this.handlers = [];
    this.debugMode = false; // 可以通过外部设置为 true 来开启调试日志
  }

  /**
   * 注册一个粘贴处理器
   * @param {PasteHandler} handler - 处理器对象
   */
  register(handler) {
    if (!handler.name || typeof handler.handle !== 'function') {
      console.error('[PasteRegistry] 注册失败：处理器必须包含 name 和 handle 方法', handler);
      return;
    }

    // 设置默认优先级和 canHandle 函数
    handler.priority = handler.priority ?? PastePriority.NORMAL;
    handler.canHandle = handler.canHandle ?? (() => true);

    this.handlers.push(handler);
    
    // 按优先级降序排序（优先级高的排在前面）
    this.handlers.sort((a, b) => b.priority - a.priority);

    if (this.debugMode) {
      console.log(`[PasteRegistry] 已注册处理器: ${handler.name} (优先级: ${handler.priority})`);
      console.log('[PasteRegistry] 当前处理器顺序:', this.handlers.map(h => `${h.name}(${h.priority})`));
    }
  }

  /**
   * 注销一个处理器
   * @param {string} name - 处理器名称
   */
  unregister(name) {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      if (this.debugMode) {
        console.log(`[PasteRegistry] 已注销处理器: ${name}`);
      }
    }
  }

  /**
   * 分发粘贴事件到各个处理器
   * @param {ClipboardEvent} event - 粘贴事件
   * @param {Object} context - 上下文对象，包含 view, state, dispatch 等
   * @returns {boolean} - 如果事件被处理则返回 true
   */
  dispatchPaste(event, context) {
    if (this.debugMode) {
      console.log('[PasteRegistry] 🔥 粘贴事件触发，开始分发...');
      console.log('[PasteRegistry] 剪贴板类型:', event.clipboardData?.types);
    }

    for (const handler of this.handlers) {
      try {
        // 检查该处理器是否可以处理此事件
        if (!handler.canHandle(event, context)) {
          if (this.debugMode) {
            console.log(`[PasteRegistry] ⏭️  ${handler.name} 跳过（canHandle 返回 false）`);
          }
          continue;
        }

        if (this.debugMode) {
          console.log(`[PasteRegistry] 🎯 尝试使用 ${handler.name} 处理...`);
        }

        // 调用处理器
        const handled = handler.handle(event, context);
        
        if (handled) {
          if (this.debugMode) {
            console.log(`[PasteRegistry] ✅ ${handler.name} 成功处理了粘贴事件`);
          }
          return true;
        }

        if (this.debugMode) {
          console.log(`[PasteRegistry] ⏭️  ${handler.name} 未处理（返回 false）`);
        }
      } catch (error) {
        console.error(`[PasteRegistry] ❌ ${handler.name} 处理时出错:`, error);
      }
    }

    if (this.debugMode) {
      console.log('[PasteRegistry] ℹ️  所有处理器都未处理该事件，交给默认处理器');
    }

    return false; // 没有处理器处理该事件
  }

  /**
   * 分发拖放事件到各个处理器
   * @param {DragEvent} event - 拖放事件
   * @param {Object} context - 上下文对象
   * @returns {boolean} - 如果事件被处理则返回 true
   */
  dispatchDrop(event, context) {
    if (this.debugMode) {
      console.log('[PasteRegistry] 🔥 拖放事件触发，开始分发...');
    }

    // 使用相同的处理器列表，因为拖放和粘贴在很多情况下是相似的
    for (const handler of this.handlers) {
      try {
        // 如果处理器定义了 handleDrop 方法，则使用它；否则跳过
        if (typeof handler.handleDrop !== 'function') {
          continue;
        }

        // 对于拖放事件，优先使用 canHandleDrop（如果定义了），否则使用 canHandle
        const canHandleFunc = handler.canHandleDrop || handler.canHandle;
        if (canHandleFunc && !canHandleFunc(event, context)) {
          if (this.debugMode) {
            console.log(`[PasteRegistry] ⏭️  ${handler.name} 跳过拖放（canHandle 返回 false）`);
          }
          continue;
        }

        if (this.debugMode) {
          console.log(`[PasteRegistry] 🎯 尝试使用 ${handler.name} 处理拖放...`);
        }

        const handled = handler.handleDrop(event, context);
        
        if (handled) {
          if (this.debugMode) {
            console.log(`[PasteRegistry] ✅ ${handler.name} 成功处理了拖放事件`);
          }
          return true;
        }

        if (this.debugMode) {
          console.log(`[PasteRegistry] ⏭️  ${handler.name} 未处理拖放（返回 false）`);
        }
      } catch (error) {
        console.error(`[PasteRegistry] ❌ ${handler.name} 处理拖放时出错:`, error);
      }
    }

    if (this.debugMode) {
      console.log('[PasteRegistry] ℹ️  所有处理器都未处理拖放事件');
    }

    return false;
  }

  /**
   * 获取所有已注册的处理器列表
   * @returns {PasteHandler[]}
   */
  getHandlers() {
    return [...this.handlers];
  }

  /**
   * 清空所有处理器
   */
  clear() {
    this.handlers = [];
    if (this.debugMode) {
      console.log('[PasteRegistry] 已清空所有处理器');
    }
  }

  /**
   * 设置调试模式
   * @param {boolean} enabled
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    console.log(`[PasteRegistry] 调试模式: ${enabled ? '开启' : '关闭'}`);
  }
}

export default PasteRegistry;

