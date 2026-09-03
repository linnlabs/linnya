/**
 * @file Autocomplete.refactored.js
 * @description Tiptap 扩展 - 重构版本，使用模块化架构
 *
 * 重构要点：
 * - 使用 AutocompleteStateManager 管理状态
 * - 使用 AutocompleteAiService 处理 AI 请求
 * - 使用 AutocompleteTriggerManager 控制触发
 * - 使用 AutocompleteEventHandler 处理事件
 * - 使用 createSuggestionWidget 创建 UI
 * - 保持外部接口完全兼容
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import { Fragment } from 'prosemirror-model';

// Store
import { useAiSettingsStore } from '@/shared/stores/aiSettings';

// 工具
import { PositionCoordMapper } from '../../extensions/position/PositionCoordMapper';

// 常量
import { AUTOCOMPLETE_PROMPT_KEY } from '@app/schemas';
import { PLACEHOLDER_VISIBILITY_PREDICATES_KEY } from '../../shared/constants/editorStorageKeys';
import { AUTOCOMPLETE_CONFIG } from './types';

// 服务层
import { AutocompleteStateManager } from './services/AutocompleteStateManager';
import { AutocompleteAiService } from './services/AutocompleteAiService';
import { AutocompleteTriggerManager } from './services/AutocompleteTriggerManager';
import { rejectionTracker } from './services/RejectionTracker';
import { getBehaviorTracker } from './services/BehaviorTracker';
// 注意：渲染进程（Vite/ESM）环境没有 CommonJS 的 require，因此这里必须使用标准 import。
import { FeatureExtractor } from './services/FeatureExtractor';

// 事件处理
import { AutocompleteEventHandler } from './handlers/AutocompleteEventHandler';

// UI
import { createSuggestionWidget } from './ui/AutocompleteSuggestionWidget';
import { buildInlineNodesFromProjection } from '../../services/markdownRuntime';
import { parseAutocompleteMarkdownToInlineProjection } from './services/autocompleteMarkdownRuntime';
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage';

// 配置
const MIN_CONTEXT_LENGTH = AUTOCOMPLETE_CONFIG.trigger.minContextLength;
const DEFAULT_DEBOUNCE_MS = AUTOCOMPLETE_CONFIG.trigger.defaultDebounceMs;

export const AutocompletePluginKey = new PluginKey('autocomplete');

/**
 * 创建 Autocomplete 扩展实例（工厂函数）
 *
 * 根因说明（中文）：
 * - 直接在模块顶层执行 `Extension.create(...)` 会导致扩展在 import 阶段就被实例化；
 * - import 阶段发生在 `main.js` 执行 `app.use(pinia)` 之前（ESM 会先解析并执行依赖图）；
 * - 因此任何在 addStorage()/addOptions() 阶段触发的 Pinia store 调用都会报
 *   “getActivePinia() was called but there was no active Pinia”。
 *
 * 解决方案（中文）：
 * - 将扩展实例化推迟到 Editor 创建阶段（`getAllExtensions()` 调用时），确保 Pinia 已安装。
 */
export function createAutocompleteExtension() {
  return Extension.create({
  name: 'autocomplete',

  addOptions() {
    return {
      minContextLength: MIN_CONTEXT_LENGTH,
    };
  },

  addStorage() {
    // 注意：Tiptap 的生命周期中，addProseMirrorPlugins() 可能早于 onCreate() 执行。
    // 因此所有不依赖 editor 实例的服务，应在 addStorage() 阶段初始化，避免出现空指针。
    const aiSettingsStore = useAiSettingsStore();
    const stateManager = new AutocompleteStateManager();
    const behaviorTracker = getBehaviorTracker();
    const triggerManager = new AutocompleteTriggerManager(DEFAULT_DEBOUNCE_MS, aiSettingsStore, behaviorTracker);

    return {
      // 向后兼容：保留原有的字段结构
      isLoading: false,
      suggestion: null,
      suggestionPos: null,
      error: null,
      abortController: null,
      aiSettingsStore,
      lastSuggestionShownTimestamp: null,
      placeholderPredicateRef: null,

      // 新增：服务实例
      stateManager,
      triggerManager,
      behaviorTracker,
    };
  },

  onCreate() {
    // 初始化 Placeholder 谓词
    this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] =
      this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] || [];

    const shouldHidePlaceholderForAutocomplete = (pmState) => {
      if (!AutocompletePluginKey) return false;
      try {
        const autocompletePluginState = AutocompletePluginKey.getState(pmState);
        return !!(autocompletePluginState && autocompletePluginState.find().length > 0);
      } catch (error) {
        return false;
      }
    };

    this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY].push(
      shouldHidePlaceholderForAutocomplete
    );
    this.storage.placeholderPredicateRef = shouldHidePlaceholderForAutocomplete;

    // 注册 Tab 键处理器
    if (this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry.register({
        keys: 'Tab',
        handler: (context) => {
          const pluginState = AutocompletePluginKey.getState(context.state);
          if (pluginState && pluginState.find().length > 0) {
            return context.editor.commands.acceptAutocompleteSuggestion();
          }
          return false;
        },
        phase: 'pre',
        priority: 120,
        id: 'autocomplete-tab-accept',
      });
    }
  },

  onDestroy() {
    // 清理 Placeholder 谓词
    const predicateRef = this.storage.placeholderPredicateRef;
    if (predicateRef && this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY]) {
      this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] =
        this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY].filter((p) => p !== predicateRef);
    }
    this.storage.placeholderPredicateRef = null;

    // 🔥 销毁服务实例
    this.storage.triggerManager?.destroy();
  },

  addCommands() {
    return {
      acceptAutocompleteSuggestion:
        () =>
        ({ editor, tr }) => {
          const { view, state } = editor;
          const { selection } = state;
          const stateManager = editor.storage.autocomplete?.stateManager;
          const behaviorTracker = editor.storage.autocomplete?.behaviorTracker;

          if (!stateManager) return false;

          const currentState = stateManager.getState();
          const { isLoading, suggestion, suggestionPos } = currentState;

          if (isLoading || !suggestion || suggestionPos !== selection.from) {
            return false;
          }

          // 验证 Decoration 存在
          const pluginState = AutocompletePluginKey.getState(state);
          const decorationExists =
            pluginState &&
            pluginState.find(suggestionPos, suggestionPos, (spec) => spec.key === 'autocomplete')
              .length > 0;

          if (!decorationExists) return false;

          // 🔥 记录行为事件：接受建议
          if (behaviorTracker) {
            // 注意：这里的 deltaChars 应以“最终插入到文档的纯文本长度”为准，
            // 因为我们可能会把 `**bold**` 转成 marks 后插入（语法符号不会进入文档）。
            const insertedPlainText = currentState.suggestionProjection?.plainText ?? suggestion;

            behaviorTracker.addEvent({
              type: 'accept_suggestion',
              from: suggestionPos,
              to: suggestionPos,
              deltaChars: insertedPlainText.length,
              contentSample: insertedPlainText.slice(0, 50),
              source: 'keyboard',
            });
          }

          const suggestionProjection = currentState.suggestionProjection;
          if (!suggestionProjection) {
            tr.insertText(suggestion, suggestionPos);
          } else {
            const { schema } = state;
            const nodes = buildInlineNodesFromProjection(suggestionProjection, schema);

            if (nodes.length === 0) {
              tr.insertText(suggestionProjection.plainText || suggestion, suggestionPos);
              tr.setSelection(
                TextSelection.create(
                  tr.doc,
                  suggestionPos + (suggestionProjection.plainText || suggestion).length
                )
              );
            } else {
              const fragment = Fragment.fromArray(nodes);
              tr.insert(suggestionPos, fragment);

              // 显式把光标移动到插入内容末尾，避免不同插入路径导致的选区映射差异
              tr.setSelection(TextSelection.create(tr.doc, suggestionPos + fragment.size));
            }
          }
          tr.setMeta(AutocompletePluginKey, { action: 'clearSuggestion' });

          // 清理状态
          stateManager.clearSuggestion();

          // 向后兼容：同步到 storage
          editor.storage.autocomplete.suggestion = null;
          editor.storage.autocomplete.suggestionPos = null;
          editor.storage.autocomplete.isLoading = false;
          editor.storage.autocomplete.error = null;

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;
    const editor = extensionThis.editor;

    // 获取服务实例
    const stateManager = extensionThis.storage.stateManager;
    const triggerManager = extensionThis.storage.triggerManager;
    const aiSettingsStore = extensionThis.storage.aiSettingsStore;
    const behaviorTracker = extensionThis.storage.behaviorTracker;

    // 🔥 核心：AI 请求处理函数
    const handleAutocompleteRequest = async () => {
      const { view, state } = editor;
      if (!view || !state) return;

      // 1. 检查触发条件
      const checkResult = triggerManager.checkAllConditions(
        view,
        stateManager.getLastSuggestionTimestamp()
      );

      if (!checkResult.allowed) {
        // 说明（中文）：
        // - 频率限制是“暂时不允许”，并不代表要清空建议或彻底停止；
        // - 用户左右移动光标会触发一次新的补全，但若此时处于冷却期，
        //   本次会被拦截，且如果没有后续输入事件就不会再触发，用户感知为“不再生成”；
        // - 因此这里在频率限制场景下，会安排一个“冷却结束后立刻重试”的触发。
        const isFrequencyLimited = typeof checkResult.reason === 'string' && checkResult.reason.startsWith('frequency limited');

        if (isFrequencyLimited && typeof checkResult.retryAfterMs === 'number' && checkResult.retryAfterMs > 0) {
          // 预留 20ms 的缓冲，避免边界时刻 clock/jitter 导致再次命中冷却
          const retryAfterMs = checkResult.retryAfterMs + 20;
          console.debug('[Autocomplete] frequency limited, will retry after', retryAfterMs, 'ms');
          triggerManager.scheduleImmediateTriggerAfter(retryAfterMs);
        }

        // 非频率限制原因：通常意味着当前状态不适合补全（不可编辑、未启用、结构编辑等），直接清理。
        if (!isFrequencyLimited) {
          stateManager.clearWithDispatch(view, AutocompletePluginKey);
        }
        return;
      }

      // 2. 验证上下文
      const hasValidContext = await AutocompleteAiService.validateContext(
        editor,
        extensionThis.options.minContextLength
      );

      if (!hasValidContext) {
        stateManager.setLoading(false);
        syncStateToStorage();
        return;
      }

      // 3. 准备请求
      stateManager.reset();
      stateManager.setLoading(true);

      const controller = new AbortController();
      stateManager.setAbortController(controller);
      syncStateToStorage();

      try {
        // 4. 请求 AI（使用意图预测结果调整补全长度）
        let completionLengthHint =
          aiSettingsStore?.completionLengthPromptHint || 'Output 2-3 sentences.';

        // 如果有意图预测结果，根据建议的长度调整
        if (checkResult.intentPrediction?.policy.suggestedLength) {
          const lengthMap = {
            1: 'Output exactly 1 short sentence.',
            2: 'Output 2-3 sentences.',
            3: 'Output a full paragraph.',
          };
          completionLengthHint = lengthMap[checkResult.intentPrediction.policy.suggestedLength] || completionLengthHint;
        }

        const recentRejections = rejectionTracker.getRejectionsForApi();

        // 🔥 准备行为摘要（阶段 C）
        let behaviorSummary = undefined;
        if (behaviorTracker && checkResult.intentPrediction) {
          const summary = behaviorTracker.getSummary();
          // 根因修复：不要在浏览器端使用 require（会触发 ReferenceError: require is not defined）
          const rhythm = FeatureExtractor.extractTypingRhythm(behaviorTracker);
          const structural = FeatureExtractor.extractStructuralEditingFeatures(behaviorTracker, state);

          behaviorSummary = {
            totalEvents: summary.totalEvents,
            totalInsertedChars: summary.totalInsertedChars,
            totalDeletedChars: summary.totalDeletedChars,
            recentDeletedChars: structural.recentDeletedChars,
            hasLargeRecentDelete: structural.hasLargeRecentDelete,
            typingSpeedCps: rhythm.typingSpeedCps,
          };
        }

        const response = await AutocompleteAiService.requestSuggestion(
          editor,
          {
            completionLengthHint,
            recentRejections,
            intentPrediction: checkResult.intentPrediction, // 🔥 传递意图预测
            behaviorSummary, // 🔥 传递行为摘要
          },
          controller.signal
        );

        // 5. 处理响应
        if (controller.signal.aborted) {
          stateManager.setLoading(false);
          syncStateToStorage();
          return;
        }

        if (response.generatedText && response.generatedText.trim().length > 0) {
          const { selection } = state;
          const suggestionProjection = await parseAutocompleteMarkdownToInlineProjection(
            response.generatedText,
            { operation: 'autocompleteSuggestion' }
          );

          if (controller.signal.aborted) {
            stateManager.setLoading(false);
            syncStateToStorage();
            return;
          }

          stateManager.setSuggestion(response.generatedText, selection.from, suggestionProjection);
          stateManager.setLoading(false);
          syncStateToStorage();

          // 显示建议
          view.dispatch(
            state.tr.setMeta(AutocompletePluginKey, {
              action: 'addSuggestion',
              pos: selection.from,
              text: response.generatedText,
            })
          );
        } else {
          console.warn('[Autocomplete] AI returned empty suggestion');
          stateManager.setLoading(false);
          syncStateToStorage();
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('[Autocomplete] AI request error:', error);
          stateManager.setError(resolveCurrentEditorMessage('editor.autocomplete.error.requestFailed'));
        }
        stateManager.setLoading(false);
        syncStateToStorage();
      }
    };

    // 向后兼容：同步状态到 storage
    const syncStateToStorage = () => {
      const currentState = stateManager.getState();
      extensionThis.storage.isLoading = currentState.isLoading;
      extensionThis.storage.suggestion = currentState.suggestion;
      extensionThis.storage.suggestionPos = currentState.suggestionPos;
      extensionThis.storage.error = currentState.error;
      extensionThis.storage.abortController = currentState.abortController;
      extensionThis.storage.lastSuggestionShownTimestamp = currentState.lastSuggestionShownTimestamp;
    };

    // 创建防抖函数
    triggerManager.createDebouncedCall(handleAutocompleteRequest);

    // Store 订阅（监听配置变化）
    let unsubscribeStore = null;
    if (aiSettingsStore && typeof aiSettingsStore.$subscribe === 'function') {
      unsubscribeStore = aiSettingsStore.$subscribe((mutation, state) => {
        if (mutation.storeId === 'aiSettings' && 'delayLevel' in state) {
          triggerManager.cancel();
          triggerManager.createDebouncedCall(handleAutocompleteRequest);
        }
      });
    }

    // 创建 ProseMirror 插件
    const plugin = new Plugin({
      key: AutocompletePluginKey,

      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, oldSet) {
          const meta = tr.getMeta(AutocompletePluginKey);

          // 文档变化时清除 Decoration
          if (tr.docChanged) {
            return DecorationSet.empty;
          }

          // 处理 Meta 动作
          if (meta) {
            if (meta.action === 'addSuggestion') {
              const mappedPos = tr.mapping.map(meta.pos);
              const decoration = createSuggestionWidget(mappedPos, meta.text);
              const newSet = DecorationSet.create(tr.doc, [decoration]);
              stateManager.updateSuggestionTimestamp();
              syncStateToStorage();
              return newSet;
            } else if (meta.action === 'clearSuggestion') {
              return DecorationSet.empty;
            }
          }

          return oldSet.map(tr.mapping, tr.doc);
        },
      },

      view(editorView) {
        const mapper = new PositionCoordMapper(editor);
        const dom = editorView.dom;

        // 鼠标点击处理
        const pointerDownHandler = (event) => {
          const clickX = event.clientX;
          const clickY = event.clientY;

          if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) return;

          const clickedPos = mapper.posAtEvent(event);
          if (clickedPos === null) return;

          const currentState = stateManager.getState();
          const { suggestion, suggestionPos } = currentState;

          if (suggestion && clickedPos === suggestionPos) {
            event.preventDefault();
            event.stopPropagation();

            const { state } = editorView;
            const tr = state.tr;
            const selection = TextSelection.create(state.doc, clickedPos);
            tr.setSelection(selection);
            editorView.focus();
            editorView.dispatch(tr);
          }
        };

        dom.addEventListener('mousedown', pointerDownHandler, true);

        // 销毁时清理
        const originalDestroy = () => {
          dom.removeEventListener('mousedown', pointerDownHandler, true);
          triggerManager.cancel();
          stateManager.abortRequest();
          if (unsubscribeStore) unsubscribeStore();
        };

        return {
          update(view, prevState) {
            try {
              // 检查是否启用
              const globalCheck = triggerManager.checkGlobalEnabled();
              if (!globalCheck.allowed) {
                triggerManager.cancel();
                stateManager.clearWithDispatch(view, AutocompletePluginKey);
                syncStateToStorage();
                return;
              }

              const { state } = view;

              // 检查编辑器状态
              if (!view.editable) {
                triggerManager.cancel();
                stateManager.clearWithDispatch(view, AutocompletePluginKey);
                syncStateToStorage();
                return;
              }

              // 🔥 检测变化
              const changeInfo = AutocompleteEventHandler.detectChange(prevState, state);

              // 🔥 记录行为事件
              if (behaviorTracker && (changeInfo.docChanged || changeInfo.selectionPosChanged)) {
                const { selection } = state;
                const prevSelection = prevState.selection;

                if (changeInfo.docChanged && !changeInfo.selectionPosChanged) {
                  // 文档变化：可能是插入、删除或粘贴
                  const deltaSize = state.doc.content.size - prevState.doc.content.size;

                  if (deltaSize > 0) {
                    // 插入文本
                    const insertedText = AutocompleteEventHandler.extractTextBeforeCursor(state, 50);

                    // 检测是否是粘贴（大量文本一次性插入）
                    const isPaste = deltaSize > 10; // 超过10个字符认为是粘贴

                    behaviorTracker.addEvent({
                      type: isPaste ? 'paste' : 'insert',
                      from: prevSelection.from,
                      to: selection.from,
                      deltaChars: deltaSize,
                      contentSample: insertedText.slice(-Math.min(50, insertedText.length)),
                      source: 'keyboard',
                    });
                  } else if (deltaSize < 0) {
                    // 删除文本
                    behaviorTracker.addEvent({
                      type: 'delete',
                      from: selection.from,
                      to: selection.to,
                      deltaChars: deltaSize,
                      source: 'keyboard',
                    });
                  }
                } else if (changeInfo.selectionPosChanged && !changeInfo.docChanged) {
                  // 仅选区移动（方向键、鼠标点击）
                  behaviorTracker.addEvent({
                    type: 'selection_move',
                    from: prevSelection.from,
                    to: selection.from,
                    deltaChars: 0,
                    source: 'unknown', // 无法直接区分 keyboard/mouse
                  });
                }
              }

              if (
                changeInfo.docChanged ||
                changeInfo.selectionPosChanged ||
                changeInfo.selectionTypeChanged
              ) {
                const currentState = stateManager.getState();
                const hasSuggestion = currentState.suggestion !== null;

                // 🔥 检查是否拒绝
                const rejectionInfo = AutocompleteEventHandler.checkRejection(
                  changeInfo,
                  hasSuggestion,
                  prevState,
                  state
                );

                // 记录拒绝
                if (
                  rejectionInfo.isRejection &&
                  currentState.suggestion &&
                  currentState.suggestionPos !== null
                ) {
                  rejectionTracker.addRejection(
                    currentState.suggestion,
                    currentState.suggestionPos,
                    rejectionInfo.userInputAfterRejection
                  );
                }

                // 清理状态
                stateManager.clearWithDispatch(view, AutocompletePluginKey);
                syncStateToStorage();

                // 🔥 判断是否触发新补全
                if (AutocompleteEventHandler.shouldTriggerNewCompletion(changeInfo, state)) {
                  triggerManager.trigger();
                } else {
                  triggerManager.cancel();
                }
              }
            } catch (error) {
              console.debug('[Autocomplete] Plugin update error:', error);
            }
          },

          destroy: originalDestroy,
        };
      },

      props: {
        decorations(state) {
          try {
            if (!AutocompletePluginKey) return DecorationSet.empty;
            if (!state) return DecorationSet.empty;
            if (typeof AutocompletePluginKey.getState !== 'function') return DecorationSet.empty;

            const pluginState = AutocompletePluginKey.getState(state);
            return pluginState || DecorationSet.empty;
          } catch (error) {
            return DecorationSet.empty;
          }
        },
      },
    });

    return [plugin];
  },
  });
}

export default createAutocompleteExtension;
