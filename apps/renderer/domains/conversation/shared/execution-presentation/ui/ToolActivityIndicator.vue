<template>
  <span
    class="tool-activity"
    :class="{ 'tool-activity--compact': compact }"
    :data-execution-state="activity.state"
    role="status"
  >
    <ExecutionProgressText :active="bodyProgress" :effect="effect">
      {{
        activity.isExecuting && runningLabel ? runningLabel : conversationMessage(activity.labelKey)
      }}
    </ExecutionProgressText>
  </span>
</template>

<script setup lang="ts">
import type { ToolActivityIndicatorProps } from '@linnya/plugin-host-contract/renderer/executionPresentation';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { useToolBodyProgress, useToolExecutionActivity } from '../composables/useExecutionActivity';
import ExecutionProgressText from './ExecutionProgressText.vue';
import './ToolActivityIndicator.css';

withDefaults(defineProps<ToolActivityIndicatorProps>(), { effect: 'shimmer' });
const activity = useToolExecutionActivity();
const bodyProgress = useToolBodyProgress();
const { conversationMessage } = useConversationLocalization();
</script>
