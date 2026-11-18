<template>
  <p class="command-permission-change" data-command-permission-change>{{ text }} · {{ time }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import { useHistoryTime } from '@/app/localization';
import { commandPermissionLabelKeys } from '@/app/workflows/command-permissions/permissionLabels';
import { useSettingsLocalization } from '@/domains/settings/features/command-permission-settings';
import type { CommandPermissionChangeMessage } from '../../../types';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

/** 时间线里的一行档位变更记录；样式见 styles/features/command-permissions。 */
const props = defineProps<{ message: CommandPermissionChangeMessage }>();
const { conversationMessage } = useConversationLocalization();
const { settingsMessage } = useSettingsLocalization();
const { historyTime } = useHistoryTime();

function selectionText(selection: CommandPermissionLevel | null, effective: CommandPermissionLevel): string {
  const label = settingsMessage(commandPermissionLabelKeys[selection ?? effective]);
  return selection === null ? conversationMessage('conversation.commandPermission.followLevel', { level: label }) : label;
}

const text = computed(() => {
  const change = props.message.metadata;
  const from = selectionText(change.previous_selection, change.previous_level);
  const to = selectionText(change.next_selection, change.next_level);
  if (change.origin === 'global_reduction') {
    return conversationMessage('conversation.commandPermission.changedByGlobalReduction', { from, to });
  }
  if (change.origin === 'host_initialization') {
    return conversationMessage('conversation.commandPermission.initialized', { to });
  }
  return conversationMessage('conversation.commandPermission.changedByUser', { from, to });
});
const time = computed(() => historyTime(props.message.metadata.changed_at_ms));
</script>
