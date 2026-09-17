<template>
  <ExecutionProgressText
    class="tool-card__name-text"
    :active="activity.isExecuting"
  >
    {{ title }}
  </ExecutionProgressText>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ConversationToolMessageStatus } from '@app/schemas';
import { useLocalization } from '@app/localization';

import { ExecutionProgressText, useToolExecutionActivity } from '../../../shared/execution-presentation';
import { useSubrunCompactStepTitle } from '../../subrun-trace';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  readonly fallbackTitle: string;
  readonly status: ConversationToolMessageStatus;
  readonly subrunTrace?: unknown;
  readonly subrunTraceVersion?: number;
}>();
const { t: resolveLocalizedText } = useLocalization();
const activity = useToolExecutionActivity(() => props.status);
const projected = useSubrunCompactStepTitle({
  enabled: () => activity.value.isExecuting,
  status: () => props.status,
  subrunTrace: () => props.subrunTrace,
  subrunTraceVersion: () => props.subrunTraceVersion ?? 0,
});
const title = computed(() => projected.title.value
  ? resolveLocalizedText(projected.title.value)
  : props.fallbackTitle);
</script>
