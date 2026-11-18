<template>
  <div v-if="view?.changes.length || view?.latest_run?.permission_level || failed" class="conversation-permission-history">
    <p v-if="failed" role="status" class="conversation-permission-error">
      {{ conversationMessage('conversation.commandPermission.changeFailed') }}
    </p>
    <details v-if="latestChange" data-conversation-permission-history>
      <summary>{{ changeLabel(latestChange) }} · {{ historyTime(latestChange.changed_at_ms) }}</summary>
      <ul v-if="view">
        <li v-for="change in view.changes" :key="change.revision">
          {{ changeLabel(change) }} · {{ historyDateTime(change.changed_at_ms) }}
        </li>
      </ul>
    </details>
    <p v-if="view?.latest_run?.permission_level" data-conversation-permission-run>
      {{ conversationMessage('conversation.commandPermission.recentRun', { level: label(view.latest_run.permission_level) }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CommandPermissionLevel, ConversationCommandPermissionChange, ConversationCommandPermissionView } from '@app/schemas/commands';
import { useHistoryTime } from '@/app/localization';
import { commandPermissionLabelKeys } from '@/app/workflows/command-permissions/permissionLabels';
import { useSettingsLocalization } from '@/domains/settings/features/command-permission-settings';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

const props = defineProps<{ view?: ConversationCommandPermissionView; failed: boolean }>();
const latestChange = computed(() => props.view?.changes[0]);
const { conversationMessage } = useConversationLocalization();
const { settingsMessage } = useSettingsLocalization();
const { historyTime, historyDateTime } = useHistoryTime();
const label = (level: CommandPermissionLevel) => settingsMessage(commandPermissionLabelKeys[level]);

function selectionLabel(selection: CommandPermissionLevel | null, effective: CommandPermissionLevel) {
  return selection === null
    ? conversationMessage('conversation.commandPermission.follow', { level: label(effective) })
    : label(selection);
}

function changeLabel(change: ConversationCommandPermissionChange) {
  return conversationMessage('conversation.commandPermission.changed', {
    from: selectionLabel(change.previous_selection, change.previous_level),
    to: selectionLabel(change.next_selection, change.next_level),
  });
}
</script>

<style scoped>
.conversation-permission-history {
  padding-inline: var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.conversation-permission-history p {
  margin-block: var(--space-1);
}

.conversation-permission-history summary {
  cursor: pointer;
}

.conversation-permission-history .conversation-permission-error {
  color: var(--color-error-text);
}
</style>
