<template>
  <button class="action-link" :disabled="disabled || busy || !modelId" @click="openConfirmation">
    {{ knowledgeBaseMessage(busy ? 'knowledgeBase.manage.rebuild.running' : 'knowledgeBase.manage.rebuild.action') }}
  </button>
  <AlertDialog
    :visible="pending !== null"
    is-confirmation
    :title="knowledgeBaseMessage('knowledgeBase.manage.rebuild.title')"
    :message="knowledgeBaseMessage('knowledgeBase.manage.rebuild.message', { knowledgeBaseName: pending?.name || '', modelName: pending?.modelName || '' })"
    :confirm-text="knowledgeBaseMessage('knowledgeBase.manage.rebuild.confirm')"
    @confirm="confirmRebuild"
    @cancel="pending = null"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { AlertDialog } from '@linnya/renderer-ui';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

const props = defineProps<{ kbId: string; name: string; modelId: string | null; modelName: string; disabled?: boolean; busy?: boolean }>();
const emit = defineEmits<{ rebuild: [request: { kbId: string; modelId: string }] }>();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();
const pending = ref<{ kbId: string; name: string; modelId: string; modelName: string } | null>(null);
function openConfirmation(): void {
  // 确认框属于点击时的知识库，不能在切换列表后转而修改另一个库。
  if (props.modelId) pending.value = { kbId: props.kbId, name: props.name, modelId: props.modelId, modelName: props.modelName };
}
function confirmRebuild(): void {
  const request = pending.value;
  pending.value = null;
  if (request) emit('rebuild', { kbId: request.kbId, modelId: request.modelId });
}
</script>
