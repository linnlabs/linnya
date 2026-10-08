<template>
  <ExecutionProgressText
    class="tool-card__name-text"
    :active="isExecuting"
  >
    {{ title }}
  </ExecutionProgressText>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  ToolCardPresentation,
  ToolUiExecutionIdentity,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import { useLocalization } from '@app/localization';
import {
  ExecutionProgressText,
  useToolExecutionActivity,
} from '../../../shared/execution-presentation';
import { resolveToolTitleDescriptor } from '../../../ui/tools/functions/resolveToolTitleDescriptor';
import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import { useCommandExecutionDisplay } from '../orchestration/useCommandExecutionDisplay';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  readonly presentation: ToolCardPresentation<CommandExecutionPresentationData>;
  readonly conversationId?: string;
  readonly toolIdentity?: ToolUiExecutionIdentity;
}>();
const display = useCommandExecutionDisplay({
  presentation: () => props.presentation,
  conversationId: () => props.conversationId,
  toolIdentity: () => props.toolIdentity,
});
const { t } = useLocalization();
const title = computed(() => resolveToolTitleDescriptor(display.value.title, t).text);
const activity = useToolExecutionActivity();
const isExecuting = computed(
  () =>
    !display.value.approvalStatus &&
    (display.value.data.state === 'starting' || display.value.data.state === 'running') &&
    activity.value.isExecuting
);
</script>
