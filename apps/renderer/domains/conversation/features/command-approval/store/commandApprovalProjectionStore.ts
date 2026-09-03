import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  CommandApprovalPageSnapshotV1,
  CommandApprovalRequestId,
} from '@app/schemas/commands';

export type CommandApprovalPageState = 'idle' | 'ready' | 'unavailable';

export const useCommandApprovalProjectionStore = defineStore(
  'command-approval-projection',
  () => {
    const pageState = ref<CommandApprovalPageState>('idle');
    const snapshot = ref<CommandApprovalPageSnapshotV1>();
    const submittingRequestId = ref<CommandApprovalRequestId>();
    const activePending = computed(() => snapshot.value?.pending[0]);

    function pageOpened(next: CommandApprovalPageSnapshotV1): void {
      snapshot.value = next;
      pageState.value = 'ready';
    }

    function pageUnavailable(): void {
      snapshot.value = undefined;
      submittingRequestId.value = undefined;
      pageState.value = 'unavailable';
    }

    function projectionChanged(next: CommandApprovalPageSnapshotV1): void {
      snapshot.value = next;
      if (
        submittingRequestId.value
        && !next.pending.some(value => (
          value.approval_request_id === submittingRequestId.value
          && value.status === 'awaiting_reply'
        ))
      ) {
        submittingRequestId.value = undefined;
      }
    }

    function replyStarted(requestId: CommandApprovalRequestId): void {
      submittingRequestId.value = requestId;
    }

    function replyFinished(requestId: CommandApprovalRequestId): void {
      if (submittingRequestId.value === requestId) submittingRequestId.value = undefined;
    }

    function reset(): void {
      pageState.value = 'idle';
      snapshot.value = undefined;
      submittingRequestId.value = undefined;
    }

    return {
      pageState,
      snapshot,
      submittingRequestId,
      activePending,
      pageOpened,
      pageUnavailable,
      projectionChanged,
      replyStarted,
      replyFinished,
      reset,
    };
  },
);
