import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { SSEEvent } from '@linnlabs/linnkit/contracts';
import type {
  InteractiveRunSnapshot,
  InteractiveRunTerminalStatus,
} from '../definitions/interactiveRun';
import {
  assertInteractiveRunCanStart,
  reduceInteractiveRunEvent,
} from '../functions/interactiveRunTransitions';

export const useInteractiveRunStore = defineStore('conversationInteractiveRun', () => {
  const runsByConversation = ref(new Map<string, InteractiveRunSnapshot>());
  // reader 关闭后还要做状态对账；保留最近请求身份，阻止旧请求覆盖下一代状态。
  const latestTransportByConversation = new Map<string, AbortController>();
  const controllersByConversation = new Map<
    string,
    {
      readonly controller: AbortController;
      executionId?: string;
    }
  >();

  const beginStart = (conversationId: string, controller: AbortController): void => {
    assertInteractiveRunCanStart(conversationId, runsByConversation.value.get(conversationId));
    controllersByConversation.set(conversationId, { controller });
    latestTransportByConversation.set(conversationId, controller);
    runsByConversation.value.set(conversationId, { conversationId, status: 'starting' });
  };

  const beginSubmitting = (conversationId: string, controller: AbortController): void => {
    const current = runsByConversation.value.get(conversationId);
    if (!current?.pendingInteraction) {
      throw new Error(`Conversation ${conversationId} does not have a pending interaction`);
    }
    controllersByConversation.set(conversationId, { controller });
    latestTransportByConversation.set(conversationId, controller);
    runsByConversation.value.set(conversationId, {
      ...current,
      status: 'submitting',
      error: undefined,
    });
  };

  const beginContinuation = (
    snapshot: InteractiveRunSnapshot,
    controller: AbortController
  ): void => {
    controllersByConversation.set(snapshot.conversationId, { controller });
    latestTransportByConversation.set(snapshot.conversationId, controller);
    runsByConversation.value.set(snapshot.conversationId, {
      ...snapshot,
      status: 'continuing',
      error: undefined,
    });
  };

  const observeEvent = (event: SSEEvent): void => {
    const current = runsByConversation.value.get(event.conversation_id);
    const next = reduceInteractiveRunEvent(current, event);
    const controllerOwner = controllersByConversation.get(event.conversation_id);
    if (
      controllerOwner &&
      next !== current &&
      event.type !== 'transport_end' &&
      event.execution_id
    ) {
      controllerOwner.executionId = event.execution_id;
    }
    if (event.type === 'transport_end' && controllerOwner?.executionId === event.execution_id) {
      controllersByConversation.delete(event.conversation_id);
    }
    // reducer 返回原快照表示该事件没有当前 foreground run 的控制权。
    if (next === current) return;
    if (next) runsByConversation.value.set(event.conversation_id, next);
  };

  const snapshotFor = (
    conversationId: string | null | undefined
  ): InteractiveRunSnapshot | undefined =>
    conversationId ? runsByConversation.value.get(conversationId) : undefined;

  const abortTransport = (conversationId: string): void => {
    controllersByConversation.get(conversationId)?.controller.abort();
    controllersByConversation.delete(conversationId);
    latestTransportByConversation.delete(conversationId);
  };

  const isLatestTransport = (conversationId: string, controller: AbortController): boolean =>
    latestTransportByConversation.get(conversationId) === controller;
  const hasTransport = (conversationId: string): boolean =>
    controllersByConversation.has(conversationId);

  /** transport owner 已完成 reader teardown 后，只释放仍属于该请求的 controller。 */
  const releaseTransport = (conversationId: string, controller: AbortController): boolean => {
    const owner = controllersByConversation.get(conversationId);
    if (owner?.controller !== controller) return false;
    controllersByConversation.delete(conversationId);
    return true;
  };

  const beginCancelling = (conversationId: string): InteractiveRunSnapshot | undefined => {
    const current = runsByConversation.value.get(conversationId);
    if (!current?.runId) return undefined;
    runsByConversation.value.set(conversationId, { ...current, status: 'cancelling' });
    return current;
  };

  const completeTerminalSettlement = (
    conversationId: string,
    status: InteractiveRunTerminalStatus
  ): void => {
    const current = runsByConversation.value.get(conversationId);
    if (!current) return;
    controllersByConversation.get(conversationId)?.controller.abort();
    controllersByConversation.delete(conversationId);
    runsByConversation.value.set(conversationId, {
      ...current,
      status,
      pendingInteraction: undefined,
    });
    latestTransportByConversation.delete(conversationId);
  };

  const recordCommandError = (conversationId: string, error: string): void => {
    const current = runsByConversation.value.get(conversationId);
    if (!current) return;
    runsByConversation.value.set(conversationId, { ...current, error });
  };

  const failRun = (conversationId: string, error: string): void => {
    const current = runsByConversation.value.get(conversationId);
    controllersByConversation.delete(conversationId);
    runsByConversation.value.set(conversationId, {
      conversationId,
      runId: current?.runId,
      turnId: current?.turnId,
      executionId: current?.executionId,
      status: 'failed',
      error,
    });
  };

  /** 只关闭指定会话的错误提示，保留 terminal run 身份供控制面和诊断读取。 */
  const clearError = (conversationId: string): void => {
    const current = runsByConversation.value.get(conversationId);
    if (!current?.error) return;
    runsByConversation.value.set(conversationId, { ...current, error: undefined });
  };

  const synchronizeSnapshot = (
    conversationId: string,
    snapshot: InteractiveRunSnapshot | undefined
  ): void => {
    if (!snapshot) {
      controllersByConversation.delete(conversationId);
      runsByConversation.value.delete(conversationId);
      return;
    }
    if (snapshot.conversationId !== conversationId) {
      throw new Error('Interactive run snapshot belongs to another conversation');
    }
    runsByConversation.value.set(conversationId, snapshot);
  };

  return {
    runsByConversation,
    beginStart,
    beginSubmitting,
    beginContinuation,
    observeEvent,
    snapshotFor,
    abortTransport,
    releaseTransport,
    isLatestTransport,
    hasTransport,
    beginCancelling,
    completeTerminalSettlement,
    recordCommandError,
    failRun,
    clearError,
    synchronizeSnapshot,
  };
});
