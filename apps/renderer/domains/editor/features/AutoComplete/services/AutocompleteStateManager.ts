/**
 * @file AutocompleteStateManager.ts
 * @description 自动补全状态管理器
 *
 * 职责：
 * - 管理补全状态（loading、suggestion、error）
 * - 管理 AbortController
 * - 管理时间戳
 */

import type { EditorView } from 'prosemirror-view';
import type { PluginKey } from 'prosemirror-state';
import type { MarkdownInlineProjection } from '../../../services/markdownRuntime';

export interface AutocompleteState {
  isLoading: boolean;
  suggestion: string | null;
  suggestionPos: number | null;
  suggestionProjection: MarkdownInlineProjection | null;
  error: string | null;
  abortController: AbortController | null;
  lastSuggestionShownTimestamp: number | null;
}

export class AutocompleteStateManager {
  private state: AutocompleteState = {
    isLoading: false,
    suggestion: null,
    suggestionPos: null,
    suggestionProjection: null,
    error: null,
    abortController: null,
    lastSuggestionShownTimestamp: null,
  };

  /**
   * 获取当前状态（只读）
   */
  getState(): Readonly<AutocompleteState> {
    return { ...this.state };
  }

  /**
   * 设置建议
   */
  setSuggestion(
    suggestion: string,
    pos: number,
    suggestionProjection: MarkdownInlineProjection | null = null
  ): void {
    this.state.suggestion = suggestion;
    this.state.suggestionPos = pos;
    this.state.suggestionProjection = suggestionProjection;
  }

  /**
   * 清除建议
   */
  clearSuggestion(): void {
    this.state.suggestion = null;
    this.state.suggestionPos = null;
    this.state.suggestionProjection = null;
  }

  /**
   * 设置加载状态
   */
  setLoading(loading: boolean): void {
    this.state.isLoading = loading;
  }

  /**
   * 设置错误
   */
  setError(error: string | null): void {
    this.state.error = error;
  }

  /**
   * 设置 AbortController
   */
  setAbortController(controller: AbortController | null): void {
    // 取消旧的请求
    if (this.state.abortController && controller !== this.state.abortController) {
      this.state.abortController.abort();
    }
    this.state.abortController = controller;
  }

  /**
   * 中止当前请求
   */
  abortRequest(): void {
    if (this.state.abortController) {
      this.state.abortController.abort();
      this.state.abortController = null;
    }
  }

  /**
   * 更新建议显示时间戳
   */
  updateSuggestionTimestamp(): void {
    this.state.lastSuggestionShownTimestamp = Date.now();
  }

  /**
   * 获取上次建议显示时间
   */
  getLastSuggestionTimestamp(): number | null {
    return this.state.lastSuggestionShownTimestamp;
  }

  /**
   * 完全重置状态
   */
  reset(): void {
    this.abortRequest();
    this.state = {
      isLoading: false,
      suggestion: null,
      suggestionPos: null,
      suggestionProjection: null,
      error: null,
      abortController: null,
      lastSuggestionShownTimestamp: this.state.lastSuggestionShownTimestamp, // 保留时间戳
    };
  }

  /**
   * 清除状态并发送 ProseMirror 清除命令
   * @param view ProseMirror view
   * @param pluginKey 插件 Key
   */
  clearWithDispatch(view: EditorView | null, pluginKey: PluginKey): void {
    this.reset();

    // 检查 view 和 state 是否有效
    if (!view || !view.state) {
      return;
    }

    const { state, dispatch } = view;

    try {
      if (!pluginKey || typeof pluginKey.getState !== 'function') {
        return;
      }

      let pluginState;
      try {
        pluginState = pluginKey.getState(state);
      } catch (err) {
        return;
      }

      // 仅当存在 Decoration 时才 dispatch
      if (pluginState && typeof pluginState.find === 'function' && pluginState.find().length > 0) {
        dispatch(state.tr.setMeta(pluginKey, { action: 'clearSuggestion' }));
      }
    } catch (error) {
      console.debug('[AutocompleteStateManager] clearWithDispatch error:', error);
    }
  }
}
