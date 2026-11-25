<!--
  接收主进程的退出询问。每次询问都重新挂载弹窗，让它排在已经打开的其他确认框之上。
-->
<template>
  <WindowCloseDecisionDialog
    v-if="request"
    :key="request.request_id"
    :prompt="request.prompt"
    :open="open"
    @presented="markPresented(request.request_id)"
    @decide="decide(request.request_id, $event)"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type {
  WindowCloseDecision,
  WindowCloseDecisionRequestMessage,
  WindowCloseRequestId,
} from '@linnya/app-lifecycle-contract';
import WindowCloseDecisionDialog from './WindowCloseDecisionDialog.vue';

const request = shallowRef<WindowCloseDecisionRequestMessage | null>(null);
const open = ref(false);
let disposers: Array<() => void> = [];

function markPresented(requestId: WindowCloseRequestId): void {
  window.electronAPI?.markWindowCloseDecisionPresented(requestId);
}

function decide(requestId: WindowCloseRequestId, decision: WindowCloseDecision): void {
  if (!open.value || request.value?.request_id !== requestId) return;
  open.value = false;
  window.electronAPI?.resolveWindowCloseDecision(requestId, decision);
}

onMounted(() => {
  const bridge = window.electronAPI;
  if (!bridge?.onWindowCloseDecisionRequest) return;
  disposers = [
    bridge.onWindowCloseDecisionRequest(message => {
      request.value = message;
      open.value = true;
    }),
    bridge.onWindowCloseDecisionDismiss(requestId => {
      if (request.value?.request_id === requestId) open.value = false;
    }),
  ];
});

onBeforeUnmount(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});
</script>
