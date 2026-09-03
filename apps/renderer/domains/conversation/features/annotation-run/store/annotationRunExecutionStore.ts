import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  BeginAnnotationRunExecutionInput,
  SettleAnnotationRunExecutionInput,
} from '../definitions/annotationRunExecution';

/** Annotation run 独立执行态，避免与聊天 run 争用 controller 和错误状态。 */
export const useAnnotationRunExecutionStore = defineStore('annotationRunExecution', () => {
  const isLoading = ref(false);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  const currentAbortController = ref<AbortController | null>(null);
  const conversationId = ref<string | null>(null);
  const runId = ref<string | null>(null);

  const begin = (input: BeginAnnotationRunExecutionInput): void => {
    conversationId.value = input.conversationId;
    runId.value = input.runId;
    currentAbortController.value = input.controller;
    isLoading.value = true;
    isStreaming.value = true;
    error.value = null;
  };

  const settle = ({ controller, errorMessage }: SettleAnnotationRunExecutionInput): void => {
    // 旧 run 的迟到回调不能覆盖后来启动的 Annotation run。
    if (currentAbortController.value !== controller) return;
    currentAbortController.value = null;
    isLoading.value = false;
    isStreaming.value = false;
    error.value = errorMessage;
  };

  const isLoadingFor = (candidateConversationId: string | null | undefined): boolean => (
    candidateConversationId !== null
    && candidateConversationId !== undefined
    && conversationId.value === candidateConversationId
    && isLoading.value
  );

  const isStreamingFor = (candidateConversationId: string | null | undefined): boolean => (
    candidateConversationId !== null
    && candidateConversationId !== undefined
    && conversationId.value === candidateConversationId
    && isStreaming.value
  );

  const errorFor = (candidateConversationId: string | null | undefined): string | null => (
    candidateConversationId !== null
    && candidateConversationId !== undefined
    && conversationId.value === candidateConversationId
      ? error.value
      : null
  );

  const setError = (errorMessage: string | null): void => {
    error.value = errorMessage;
  };

  /** 关闭提示时只清理其所属会话，避免切换会话后误删另一条批注执行错误。 */
  const clearErrorFor = (candidateConversationId: string): void => {
    if (conversationId.value !== candidateConversationId) return;
    error.value = null;
  };

  return {
    isLoading,
    isStreaming,
    error,
    currentAbortController,
    conversationId,
    runId,
    begin,
    settle,
    isLoadingFor,
    isStreamingFor,
    errorFor,
    setError,
    clearErrorFor,
  };
});
