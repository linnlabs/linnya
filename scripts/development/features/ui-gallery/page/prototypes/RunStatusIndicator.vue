<script setup lang="ts">
import { computed } from 'vue';
import { HoverTooltip } from '@linnya/renderer-ui';
import { LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';
import { RUN_STATUS_LABELS, type RunStatus } from './runStatus';

/**
 * 候选组件原型：侧栏对话行行首的 Agent 运行状态（W-0352）。
 * - running：进行中，Linnya 摇曳动态（LinnyaLoadingIcon thinking，用户 2026-11-17 指定）；
 * - awaiting-answer / awaiting-approval：Agent 在等用户回答问题或审批；
 * - interrupted：运行失败、被取消或暂停后没有恢复，用户打开该对话后清除（查看后消失）；
 * - idle：无运行，不显示。
 *
 * variant：
 * - `quiet`（推荐）：两种“等你”同用强调色圆点，具体是什么由行尾文字说；中断用小一号的错误色圆点。
 * - `colored`（11-17 候选）：三种圆点各用一种状态色，“等你”加淡光环；行尾始终是时间。
 */
const props = withDefaults(
  defineProps<{ readonly status: RunStatus; readonly variant?: 'quiet' | 'colored'; readonly label?: string }>(),
  { variant: 'quiet', label: undefined },
);

const text = computed(() => (props.status === 'idle' ? '' : (props.label ?? RUN_STATUS_LABELS[props.status])));
</script>

<template>
  <HoverTooltip v-if="status !== 'idle'" :text="text" placement="top">
    <span
      class="proto-run-status"
      :class="[`proto-run-status--${status}`, `proto-run-status--${variant}`]"
      role="img"
      :aria-label="text"
      tabindex="0"
    >
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
  width: 18px;
  height: 18px;
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

/* 推荐：等你处理只用一种强调色；中断小一号，只提示看一眼。 */
.proto-run-status--quiet.proto-run-status--awaiting-answer .proto-run-status__dot,
.proto-run-status--quiet.proto-run-status--awaiting-approval .proto-run-status__dot {
  background-color: var(--color-accent);
}

.proto-run-status--quiet.proto-run-status--interrupted .proto-run-status__dot {
  width: 6px;
  height: 6px;
  background-color: var(--color-error);
}

/* 11-17 候选：三种状态色，等你处理加同色淡光环。 */
.proto-run-status--colored.proto-run-status--awaiting-answer .proto-run-status__dot {
  background-color: var(--color-info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-info) 22%, transparent);
}

.proto-run-status--colored.proto-run-status--awaiting-approval .proto-run-status__dot {
  background-color: var(--color-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 26%, transparent);
}

.proto-run-status--colored.proto-run-status--interrupted .proto-run-status__dot {
  background-color: var(--color-error);
}
</style>
