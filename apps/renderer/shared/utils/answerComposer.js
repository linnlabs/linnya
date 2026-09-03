/**
 * @file apps/renderer/shared/utils/answerComposer.js
 * @description 统一的“思考/答案”拼接状态机（Shared 层，无框架依赖、无副作用）
 *
 * 设计目标（Why）：
 * - 为 Agent 流式事件提供一致的“思考增量拼接 / 工具打断收敛 / 答案增量拼接”策略
 * - 可被 shared/utils（如 agentEventProcessor.js）与 features 层共同复用，避免重复实现与行为分叉
 *
 * 使用方式（How）：
 * - 创建实例：const composer = createAnswerComposer();
 * - 在 onThought 段落中调用 updateThought(currentContent, incoming, isIncremental)
 * - 在 onToolCall / onToolOutput / onFinalAnswer 时调用 finalizeThought() 以“打断思考并收敛”
 * - 在基于 final_answer_chunk 的答案流回调中调用 updateAnswer(currentContent, incoming, isIncremental)
 * - 在答案完成时调用 finalizeAnswer()
 */

/**
 * @typedef {Object} ThoughtUpdateResult
 * @property {boolean} shouldCreate - 是否需要创建一条新的“思考”消息
 * @property {string} mergedContent - 合并后的思考内容字符串
 */

/**
 * @typedef {Object} AnswerUpdateResult
 * @property {boolean} shouldCreate - 是否需要创建一条新的“答案”消息
 * @property {boolean} skipCreate - 是否跳过创建（例如：空白增量）
 * @property {string} mergedContent - 合并后的答案内容字符串
 */

class AnswerComposerInternal {
  constructor() {
    /** @private */ this.thoughtActive = false;
    /** @private */ this.answerActive = false;
  }

  /**
   * 更新“思考”内容
   * @param {string|null} currentContent - 现有思考内容（若无则为 null）
   * @param {string} incoming - 新增量/全量思考文本
   * @param {boolean} [isIncremental=true] - 是否按增量拼接
   * @returns {ThoughtUpdateResult}
   */
  updateThought(currentContent, incoming, isIncremental = true) {
    const prev = currentContent || '';
    const merged = isIncremental ? (prev + incoming) : incoming;
    const shouldCreate = !this.thoughtActive || currentContent == null;
    this.thoughtActive = true;
    return { shouldCreate, mergedContent: merged };
  }

  /** 结束当前“思考”阶段（工具打断或答案出现时调用） */
  finalizeThought() {
    this.thoughtActive = false;
  }

  /**
   * 更新“答案”内容
   * @param {string|null} currentContent - 现有答案内容（若无则为 null）
   * @param {string} incoming - 新增量/全量答案文本
   * @param {boolean} [isIncremental=true] - 是否按增量拼接
   * @returns {AnswerUpdateResult}
   */
  updateAnswer(currentContent, incoming, isIncremental = true) {
    const text = String(incoming || '');
    if (!this.answerActive && (!text || text.trim().length === 0)) {
      return { shouldCreate: false, skipCreate: true, mergedContent: '' };
    }
    const prev = currentContent || '';
    const merged = isIncremental ? (prev + incoming) : incoming;
    const shouldCreate = !this.answerActive || currentContent == null;
    this.answerActive = true;
    return { shouldCreate, skipCreate: false, mergedContent: merged };
  }

  /** 结束当前“答案”阶段（答案完成时调用） */
  finalizeAnswer() {
    this.answerActive = false;
  }

  /** 工具/最终答案到来，统一打断“思考”阶段 */
  onInterruptByToolOrFinal() {
    this.finalizeThought();
  }
}

/**
 * 工厂方法：创建 AnswerComposer 实例
 * @returns {AnswerComposerInternal}
 */
export function createAnswerComposer() {
  return new AnswerComposerInternal();
}

/** @deprecated 优先使用 createAnswerComposer() */
export const AnswerComposer = AnswerComposerInternal; 