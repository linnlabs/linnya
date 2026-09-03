/**
 * @file apps/renderer/domains/conversation/store/executionState.ts
 * @description App-level contributed workflow 的兼容执行状态
 *
 * @brief 设计理念
 * 功能 (What): 管理AI助手执行过程中的状态，包括加载、流式传输、错误、摘要等
 * 输入 (Input): 状态更新调用
 * 输出 (Output): 响应式状态引用
 * 副作用 (Side-effects): 更新组件响应式状态，控制取消信号
 *
 * @principles 设计原则
 * 1. 高内聚：所有执行状态相关的逻辑集中在此模块
 * 2. 低耦合：通过明确的接口暴露状态和操作，不依赖外部状态
 * 3. 响应式：使用 Vue 的响应式系统，保证UI及时更新
 * 4. 可组合：可以被其他模块轻松组合和复用
 *
 * @scope 作用域说明
 * - **作用域**：尚未迁移到独立 feature store 的 application contributed use case
 * - **不拥有**：conversation foreground run；该状态由 `features/interactive-run/` 按会话持有
 * - **独立性**：与外部 input extension 的执行态独立，支持同时运行场景
 * - **聚合方式**：`assistantStore` 只聚合 conversation 与批注执行态；外部 workflow
 *   通过各自窄 UI contract 在宿主层组合，不反向写入 conversation store
 * - **不同于**：
 *   - input extension 自己持有并通过窄 UI contract 暴露的执行态
 *   - `annotationRunExecutionStore` 的状态：专用于编辑器批注流程
 *
 * @see assistantStore.ts - 全局状态聚合器
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';

/**
 * 执行状态 Pinia Store
 *
 * @description
 * 以 Pinia Store 形式提供旧 app workflow 的共享执行状态。
 * conversation 正文禁止写入这里，避免不同会话和辅助 Agent 共用一个 controller。
 */
export const useExecutionState = defineStore('executionState', () => {
  // ===============================
  // 响应式状态定义
  // ===============================
  
  /** 是否正在加载 */
  const isLoading = ref<boolean>(false);
  
  /** 是否正在流式传输 */
  const isStreaming = ref<boolean>(false);
  
  /** 错误信息 */
  const error = ref<string | null>(null);
  
  /** 当前的取消控制器 */
  const currentAbortController = ref<AbortController | null>(null);

  // ===============================
  // 状态操作方法
  // ===============================

  /**
   * 设置加载状态
   * 
   * @param loading 是否正在加载
   */
  const setLoading = (loading: boolean): void => {
    isLoading.value = loading;
  };

  /**
   * 设置流式传输状态
   * 
   * @param streaming 是否正在流式传输
   */
  const setStreaming = (streaming: boolean): void => {
    isStreaming.value = streaming;
  };

  /**
   * 设置错误信息
   * 
   * @param errorMessage 错误信息，null表示清除错误
   */
  const setError = (errorMessage: string | null): void => {
    error.value = errorMessage;
    if (errorMessage) {
      console.error('[ExecutionState] 错误:', errorMessage);
    }
  };

  /**
   * 清除错误信息
   */
  const clearError = (): void => {
    setError(null);
  };

  /**
   * 设置当前的AbortController
   * 
   * @param controller AbortController实例或null
   */
  const setAbortController = (controller: AbortController | null) => {
    // 如果存在旧的控制器，且不是同一个，就中止它
    if (currentAbortController.value && currentAbortController.value !== controller) {
      console.log('[ExecutionState] 💥 Aborting previous request controller.');
      currentAbortController.value.abort();
    }
    currentAbortController.value = controller;
  };

  /**
   * 清理 AbortController 引用而不中止
   * @description 用于任务正常或异常结束后，仅清理引用
   */
  const clearAbortController = () => {
    if (currentAbortController.value) {
      currentAbortController.value = null;
    }
  };

  /** 只清理由指定 run 创建的 controller，避免旧 run 的 finally 误清后来者。 */
  const clearAbortControllerIfCurrent = (controller: AbortController): boolean => {
    if (currentAbortController.value !== controller) return false;
    currentAbortController.value = null;
    return true;
  };

  /**
   * 取消当前的流式传输
   * 
   * @description
   * 如果有正在进行的流式传输，将其取消并重置相关状态
   */
  const cancelCurrentStream = (): void => {
    if (currentAbortController.value) {
      try {
        currentAbortController.value.abort();
      } catch (err) {
        // 忽略 AbortError，这是预期的行为
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('[ExecutionState] 取消流式传输时发生意外错误:', err);
        }
      }
      
      // 关键：在取消后，直接将 ref 设置为 null
      clearAbortController();
    }

    isLoading.value = false;
    isStreaming.value = false;
    error.value = null;
  };

  // ===============================
  // 便捷方法
  // ===============================

  /**
   * 开始执行流程
   * 
   * @param controller 新的AbortController
   * @description 启动新的执行流程，设置相关状态
   */
  const startExecution = (controller: AbortController): void => {
    setAbortController(controller);
    setLoading(true);
    setStreaming(true);
    clearError();
  };

  /**
   * 获取当前执行状态的快照（用于调试）
   * 
   * @returns 当前执行状态的简化对象
   */
  const getExecutionSnapshot = () => ({
    isLoading: isLoading.value,
    isStreaming: isStreaming.value,
    hasError: error.value !== null,
    errorMessage: error.value,
    hasAbortController: currentAbortController.value !== null,
    abortSignalAborted: currentAbortController.value?.signal.aborted || false,
  });

  return {
    // 响应式状态
    isLoading,
    isStreaming,
    error,
    currentAbortController,
    
    // 基础操作
    setLoading,
    setStreaming,
    setError,
    clearError,
    setAbortController,
    clearAbortController,
    clearAbortControllerIfCurrent,
    cancelCurrentStream,
    
    // 便捷方法
    startExecution,
    getExecutionSnapshot
  };
});
