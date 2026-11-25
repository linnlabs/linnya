<!-- 一次退出询问的弹窗。画出来以后告诉主进程，主进程才继续等用户。 -->
<template>
  <AlertDialog
    :visible="shown && open"
    :title="presentation.title"
    :message="presentation.message"
    :confirm-text="presentation.confirmText"
    :cancel-text="presentation.cancelText"
    is-confirmation
    is-dangerous-action
    default-action="cancel"
    @confirm="emit('decide', 'proceed')"
    @cancel="emit('decide', 'return')"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { WindowCloseDecision, WindowClosePrompt } from '@linnya/app-lifecycle-contract';
import { AlertDialog } from '@linnya/renderer-ui';
import { presentWindowClosePrompt } from '../functions/presentWindowClosePrompt';
import { useWindowCloseLocalization } from './useWindowCloseLocalization';

const props = defineProps<{
  readonly prompt: WindowClosePrompt;
  readonly open: boolean;
}>();

const emit = defineEmits<{
  presented: [];
  decide: [decision: WindowCloseDecision];
}>();

const { windowCloseMessage } = useWindowCloseLocalization();
const presentation = computed(() => presentWindowClosePrompt(props.prompt, windowCloseMessage));

// 挂载后再显示，入场动画和键盘操作才完整。
const shown = ref(false);
onMounted(async () => {
  shown.value = true;
  await nextTick();
  emit('presented');
});
</script>
