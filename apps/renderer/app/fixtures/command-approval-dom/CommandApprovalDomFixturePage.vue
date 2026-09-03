<script setup lang="ts">
import CommandApprovalPanel from '../../../domains/conversation/features/command-approval/ui/CommandApprovalPanel.vue';
import CommandApprovalPageOwner from '../../../domains/conversation/features/command-approval/ui/CommandApprovalPageOwner.vue';
import { useCommandApprovalProjectionStore } from '../../../domains/conversation/features/command-approval/store/commandApprovalProjectionStore';

const approvalStore = useCommandApprovalProjectionStore();
</script>

<template>
  <main
    data-command-approval-fixture-ready="true"
    :data-command-approval-page-state="approvalStore.pageState"
    :data-command-approval-page-ticket="approvalStore.snapshot?.page_ticket"
    :data-command-approval-request-id="approvalStore.activePending?.approval_request_id"
  >
    <CommandApprovalPageOwner />
    <CommandApprovalPanel />
  </main>
</template>
