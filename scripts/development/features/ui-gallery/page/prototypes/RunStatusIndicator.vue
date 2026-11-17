<script setup lang="ts">
import { computed } from 'vue';
import { HoverTooltip } from '@linnya/renderer-ui';
import { LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';

/**
 * 候选组件原型：侧栏对话行的 Agent 运行状态。
 * - running：进行中，Linnya 摇曳动态（LinnyaLoadingIcon thinking）；
 * - awaiting-answer：Agent 在等用户回答问题；
 * - awaiting-approval：Agent 在等用户审批命令或写入；
 * - interrupted：运行被中断，用户打开该对话后清除（查看后消失）；
 * - idle：无运行，不显示指示器，行尾照常显示时间。
 * 两种“等用户”的状态都是用户必须处理的，比中断更醒目；中断只是提示看一眼。
 */
export type RunStatus = 'running' | 'awaiting-answer' | 'awaiting-approval' | 'interrupted' | 'idle';

const props = defineProps<{ readonly status: RunStatus }>();

const LABELS: Readonly<Record<Exclude<RunStatus, 'idle'>, string>> = {
  running: '正在运行',
  'awaiting-answer': '等你回答',
  'awaiting-approval': '等你审批',
  interrupted: '运行已中断',
};

const label = computed(() => (props.status === 'idle' ? '' : LABELS[props.status]));
</script>

<template>
  <HoverTooltip v-if="status !== 'idle'" :text="label" placement="top">
    <span class="proto-run-status" :class="`proto-run-status--${status}`" role="img" :aria-label="label" tabindex="0">
      <LinnyaLoadingIcon v-if="status === 'running'" class="proto-run-status__loading" activity="thinking" />
      <span v-else class="proto-run-status__dot" />
    </span>
  </HoverTooltip>
</template>

<style>
.proto-run-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
}

.proto-run-status:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
}

.proto-run-status__loading {
  width: 16px;
  height: 16px;
}

.proto-run-status__dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
}

/* 等用户处理：实心圆点 + 同色淡光环，比中断醒目。 */
.proto-run-status--awaiting-answer .proto-run-status__dot {
  background-color: var(--color-info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-info) 22%, transparent);
}

.proto-run-status--awaiting-approval .proto-run-status__dot {
  background-color: var(--color-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 26%, transparent);
}

/* 中断：只提示看一眼，不加光环。 */
.proto-run-status--interrupted .proto-run-status__dot {
  background-color: var(--color-error);
}
</style>
