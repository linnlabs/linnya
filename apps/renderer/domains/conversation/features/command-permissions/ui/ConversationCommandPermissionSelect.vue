<template>
  <CustomSelect
    data-conversation-permission-select
    class="conversation-command-permission"
    :class="{ 'conversation-command-permission--full': view?.permission_level === 'full_access' }"
    :model-value="view?.selection.permission_level ?? 'follow'"
    :display-text="displayText"
    :title="triggerTitle"
    :trigger-aria-label="triggerTitle"
    :options="options"
    :disabled="!view || busy || disabled"
    enable-keyboard-nav
    show-selected-checkmark
    use-portal-to-body
    options-motion-direction="up"
    min-width="220px"
    variant="minimal"
    :bordered="false"
    font-size="12px"
    @update:model-value="choose"
  >
    <template #arrow-icon>
      <ChevronIcon direction="up" />
    </template>
  </CustomSelect>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { CommandPermissionLevelSchema, type ConversationCommandPermissionView, type CommandPermissionLevel } from '@app/schemas/commands';
import { commandPermissionLabelKeys } from '@/app/workflows/command-permissions/permissionLabels';
import { useSettingsLocalization } from '@/domains/settings/features/command-permission-settings';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

const props = defineProps<{
  view?: ConversationCommandPermissionView;
  loading: boolean;
  busy: boolean;
  running: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [selection: CommandPermissionLevel | null] }>();
const { settingsMessage } = useSettingsLocalization();
const { conversationMessage } = useConversationLocalization();
const label = (level: CommandPermissionLevel) => settingsMessage(commandPermissionLabelKeys[level]);

const displayText = computed(() => props.view
  ? label(props.view.permission_level)
  : conversationMessage(props.loading ? 'conversation.commandPermission.loading' : 'conversation.commandPermission.unavailable'));
const triggerTitle = computed(() => {
  if (!props.view) return displayText.value;
  const scope = conversationMessage(
    props.view.source === 'global_setting' ? 'conversation.commandPermission.follow' : 'conversation.commandPermission.explicit',
    { level: displayText.value },
  );
  return props.running ? `${scope} ${conversationMessage('conversation.commandPermission.nextRun')}` : scope;
});
const options = computed<readonly CustomSelectOption[]>(() => props.view ? [
  {
    value: 'follow',
    text: conversationMessage('conversation.commandPermission.follow', { level: label(props.view.global_level) }),
  },
  ...CommandPermissionLevelSchema.options.map(level => ({
    value: level,
    text: label(level),
    variant: level === 'full_access' ? 'danger' as const : 'default' as const,
  })),
] : []);

function choose(value: string | number | boolean) {
  if (value === 'follow') {
    emit('select', null);
    return;
  }
  const parsed = CommandPermissionLevelSchema.safeParse(value);
  if (parsed.success) emit('select', parsed.data);
}
</script>

<style scoped>
.conversation-command-permission {
  flex: 0 0 auto;
  max-inline-size: 9rem;
}

.conversation-command-permission :deep(.selected-value) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-command-permission :deep(svg) {
  inline-size: 12px;
  block-size: 12px;
}

.conversation-command-permission--full :deep(.select-trigger) {
  background-color: var(--color-warning-bg);
  color: var(--color-warning-text);
}
</style>
