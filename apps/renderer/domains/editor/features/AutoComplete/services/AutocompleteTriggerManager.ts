/**
 * @file AutocompleteTriggerManager.ts
 * @description 触发控制管理器
 *
 * 职责：
 * - 防抖控制
 * - 频率限制
 * - 触发条件检查
 * - 意图预测集成（阶段 B）
 */

import type { EditorView } from 'prosemirror-view';
import type { AiSettingsStoreMinimal } from '../types';
import type { BehaviorTracker } from './BehaviorTracker';
import { IntentPredictor } from './IntentPredictor';
import type { IntentPrediction } from './IntentPredictor';

/**
 * 轻量 debounce 实现（替代 lodash-es）
 * 根因说明（中文）：
 * - 该模块在渲染进程 TS 侧使用时，`lodash-es` 在当前工程配置下缺少类型声明会触发 lint error；
 * - 这里用最小实现满足本模块需求（只需要 trailing debounce + cancel）。
 */
type DebouncedCallback = (() => void) & { cancel: () => void };

function createDebouncedCallback(
  callback: () => void | Promise<void>,
  waitMs: number
): DebouncedCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (() => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void callback();
    }, waitMs);
  }) as DebouncedCallback;

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

export interface TriggerCheckResult {
  /** 是否允许触发 */
  allowed: boolean;
  /** 不允许的原因 */
  reason?: string;
  /**
   * 频率限制等场景下建议的重试时间（毫秒）
   * - 仅作为“建议”，调用方可以选择忽略
   * - 目前主要用于：用户拒绝补全后，希望在冷却结束时自动再试一次
   */
  retryAfterMs?: number;
  /** 意图预测结果（可选） */
  intentPrediction?: IntentPrediction;
}

export class AutocompleteTriggerManager {
  private debouncedCall: DebouncedCallback | null = null;
  private currentDebounceMs: number;
  private intentPredictor: IntentPredictor;
  private lastIntentCheckTimestamp: number = 0; // 用于额外冷却时间
  /**
   * 频率限制重试定时器：
   * - 解决“触发发生在冷却期内 → 本次直接被拦截 → 冷却结束后无后续事件导致永远不再触发”的体验问题
   * - 任何 cancel() 都会清理，确保用户继续编辑时不会出现“延迟补全突然冒出来”
   */
  private frequencyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 保存原始回调，提供“绕过 debounce 的立刻触发”
   * - 只在我们明确知道需要立即执行（例如频率冷却结束重试）时使用
   */
  private rawCallback: (() => void | Promise<void>) | null = null;

  constructor(
    private readonly defaultDebounceMs: number,
    private readonly aiSettingsStore: AiSettingsStoreMinimal | null,
    private readonly behaviorTracker?: BehaviorTracker
  ) {
    this.currentDebounceMs = aiSettingsStore?.autocompleteDebounceMs || defaultDebounceMs;
    this.createDebouncedCall = this.createDebouncedCall.bind(this);
    this.intentPredictor = new IntentPredictor();
  }

  /**
   * 创建防抖函数
   * @param callback 回调函数
   */
  createDebouncedCall(callback: () => void | Promise<void>): void {
    // 保存原始 callback，用于需要“立刻触发”的场景（比如频率冷却结束重试）
    this.rawCallback = callback;

    // 更新防抖延迟
    const newDebounceMs = this.aiSettingsStore?.autocompleteDebounceMs || this.defaultDebounceMs;

    // 如果延迟变化了，重新创建防抖函数
    if (newDebounceMs !== this.currentDebounceMs) {
      this.debouncedCall?.cancel();
      this.currentDebounceMs = newDebounceMs;
    }

    if (!this.debouncedCall) {
      this.debouncedCall = createDebouncedCallback(callback, this.currentDebounceMs);
    }
  }

  /**
   * 触发防抖调用
   */
  trigger(): void {
    if (this.debouncedCall) {
      this.debouncedCall();
    }
  }

  /**
   * 取消防抖调用
   */
  cancel(): void {
    this.debouncedCall?.cancel();
    if (this.frequencyRetryTimer) {
      clearTimeout(this.frequencyRetryTimer);
      this.frequencyRetryTimer = null;
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.cancel();
    this.debouncedCall = null;
    this.rawCallback = null;
  }

  /**
   * 立刻触发（绕过 debounce）
   * - 用于“频率冷却结束后重试”这类确定性场景
   */
  triggerImmediate(): void {
    if (this.rawCallback) {
      void this.rawCallback();
    }
  }

  /**
   * 在指定毫秒后立刻触发一次（绕过 debounce）
   * - 会覆盖掉已有的重试计时器
   * - cancel() 会清理，避免用户继续输入后突然弹出延迟补全
   */
  scheduleImmediateTriggerAfter(delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      this.triggerImmediate();
      return;
    }

    if (this.frequencyRetryTimer) {
      clearTimeout(this.frequencyRetryTimer);
    }

    this.frequencyRetryTimer = setTimeout(() => {
      this.frequencyRetryTimer = null;
      this.triggerImmediate();
    }, delayMs);
  }

  /**
   * 检查是否允许触发（全局开关）
   */
  checkGlobalEnabled(): TriggerCheckResult {
    if (!this.aiSettingsStore?.isAutocompleteEnabled) {
      return { allowed: false, reason: 'autocomplete disabled' };
    }
    if (this.aiSettingsStore?.isProgrammaticallyDisabled) {
      return { allowed: false, reason: 'programmatically disabled' };
    }
    return { allowed: true };
  }

  /**
   * 检查编辑器状态
   */
  checkEditorState(view: EditorView): TriggerCheckResult {
    if (!view || !view.state) {
      return { allowed: false, reason: 'invalid view' };
    }

    const { selection } = view.state;

    // 仅在光标状态时触发
    if (!selection.empty) {
      return { allowed: false, reason: 'not cursor selection' };
    }

    // 编辑器必须可编辑
    if (!view.editable) {
      return { allowed: false, reason: 'editor not editable' };
    }

    return { allowed: true };
  }

  /**
   * 检查段落内补全设置
   */
  checkIntraParagraph(view: EditorView): TriggerCheckResult {
    if (this.aiSettingsStore?.isIntraParagraphCompletionEnabled) {
      return { allowed: true };
    }

    const { selection } = view.state;
    const { $from } = selection;

    // 检查光标是否在当前文本块的末尾
    const isAtEndOfBlock = $from.parentOffset === $from.parent.content.size;
    if (!isAtEndOfBlock) {
      return { allowed: false, reason: 'not at end of block (intra-paragraph disabled)' };
    }

    return { allowed: true };
  }

  /**
   * 检查频率限制
   * @param lastTimestamp 上次建议显示的时间戳
   */
  checkFrequency(lastTimestamp: number | null): TriggerCheckResult {
    const minTimeMs = this.aiSettingsStore?.minTimeBetweenSuggestionsMs ?? 0;

    if (minTimeMs === 0) {
      return { allowed: true };
    }

    if (!lastTimestamp) {
      return { allowed: true };
    }

    const now = Date.now();
    const timeSinceLast = now - lastTimestamp;

    if (timeSinceLast < minTimeMs) {
      const retryAfterMs = minTimeMs - timeSinceLast;
      return {
        allowed: false,
        reason: `frequency limited (${timeSinceLast}ms < ${minTimeMs}ms)`,
        retryAfterMs,
      };
    }

    return { allowed: true };
  }

  /**
   * 检查意图预测（阶段 B）
   * @param view 编辑器视图
   */
  checkIntentPrediction(view: EditorView): TriggerCheckResult {
    // 如果没有 behaviorTracker，跳过意图预测
    if (!this.behaviorTracker) {
      return { allowed: true };
    }

    const { state } = view;
    const prediction = this.intentPredictor.predict(this.behaviorTracker, state);

    // 检查是否应该触发
    if (!prediction.policy.shouldTrigger) {
      return {
        allowed: false,
        reason: `intent: ${prediction.intent} (confidence: ${prediction.confidence.toFixed(2)})`,
        intentPrediction: prediction,
      };
    }

    // 检查额外的冷却时间
    if (prediction.policy.additionalCooldownMs) {
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastIntentCheckTimestamp;

      if (timeSinceLastCheck < prediction.policy.additionalCooldownMs) {
        return {
          allowed: false,
          reason: `intent cooldown: ${prediction.intent} (${timeSinceLastCheck}ms < ${prediction.policy.additionalCooldownMs}ms)`,
          intentPrediction: prediction,
        };
      }
    }

    // 更新时间戳
    this.lastIntentCheckTimestamp = Date.now();

    return { allowed: true, intentPrediction: prediction };
  }

  /**
   * 启用调试模式
   */
  enableIntentDebug(enabled: boolean): void {
    this.intentPredictor.enableDebug(enabled);
  }

  /**
   * 获取意图预测器（用于外部访问）
   */
  getIntentPredictor(): IntentPredictor {
    return this.intentPredictor;
  }

  /**
   * 综合检查所有触发条件
   * @param view 编辑器视图
   * @param lastTimestamp 上次建议显示的时间戳
   */
  checkAllConditions(
    view: EditorView,
    lastTimestamp: number | null
  ): TriggerCheckResult {
    // 1. 全局开关
    const globalCheck = this.checkGlobalEnabled();
    if (!globalCheck.allowed) return globalCheck;

    // 2. 编辑器状态
    const editorCheck = this.checkEditorState(view);
    if (!editorCheck.allowed) return editorCheck;

    // 3. 段落内补全
    const intraParagraphCheck = this.checkIntraParagraph(view);
    if (!intraParagraphCheck.allowed) return intraParagraphCheck;

    // 4. 频率限制
    const frequencyCheck = this.checkFrequency(lastTimestamp);
    if (!frequencyCheck.allowed) return frequencyCheck;

    // 5. 意图预测（阶段 B）
    const intentCheck = this.checkIntentPrediction(view);
    if (!intentCheck.allowed) return intentCheck;

    // 所有检查通过，返回意图预测结果
    return { allowed: true, intentPrediction: intentCheck.intentPrediction };
  }
}
