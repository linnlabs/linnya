<template>
  <CustomSelect
    data-conversation-permission-select
    class="conversation-command-permission"
    :class="{ 'conversation-command-permission--full': view?.permission_level === 'full_access' }"
    :model-value="view?.selection.permission_level ?? FOLLOW"
    :display-text="displayText"
    :trigger-tooltip="triggerTooltip"
    :options="options"
    :disabled="!view || disabled"
    show-selected-checkmark
    use-portal-to-body
    min-width="300px"
    options-max-height="calc(100vh - 16px)"
    options-motion-direction="up"
    variant="minimal"
    :bordered="false"
    hide-arrow
    font-size="12px"
    :class-names="{
      trigger: 'input-footer-command-permission-trigger',
      options: 'input-footer-command-permission-options',
      optionIcon: 'conversation-command-permission__option-icon',
    }"
    @update:model-value="choose"
  >
    <!-- 底栏只显示档位图标，档位名在悬停提示与菜单里。 -->
    <template #selected-value>
      <component :is="triggerIcon" class="conversation-command-permission__icon" />
    </template>
    <template v-if="running" #options-header>
      <p class="conversation-command-permission__hint">
        {{ conversationMessage('conversation.commandPermission.nextRun') }}
      </p>
    </template>
  </CustomSelect>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import { CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import { ShieldCheckmarkIcon, ShieldErrorIcon, ShieldKeyholeIcon } from '@linnya/renderer-ui/icons';
import { CommandPermissionLevelSchema, type ConversationCommandPermissionView, type CommandPermissionLevel } from '@app/schemas/commands';
import {
  commandPermissionDescriptionKeys,
  commandPermissionLabelKeys,
} from '@/app/workflows/command-permissions/permissionLabels';
import { useSettingsLocalization } from '@/domains/settings/public';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

/** 菜单里的两个非档位项；档位值来自合同，不会与它们重名。 */
const FOLLOW = 'follow';
const OPEN_SETTINGS = 'open-settings';
/** 菜单选项由这份档位列表生成，选中值只需在其中查回，不是外部输入。 */
const LEVELS: readonly CommandPermissionLevel[] = CommandPermissionLevelSchema.options;

/** 同一个盾牌，里面的符号表示档位：锁孔＝只读，对勾＝标准，感叹号＝完全访问。 */
const LEVEL_ICONS: Readonly<Record<CommandPermissionLevel, Component>> = {
  read_only: ShieldKeyholeIcon,
  standard: ShieldCheckmarkIcon,
  full_access: ShieldErrorIcon,
};

const props = defineProps<{
  view?: ConversationCommandPermissionView;
  loading: boolean;
  running: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  select: [selection: CommandPermissionLevel | null];
  openSettings: [];
}>();
const { settingsMessage } = useSettingsLocalization();
const { conversationMessage } = useConversationLocalization();
const label = (level: CommandPermissionLevel) => settingsMessage(commandPermissionLabelKeys[level]);

const displayText = computed(() => props.view
  ? label(props.view.permission_level)
  : conversationMessage(props.loading ? 'conversation.commandPermission.loading' : 'conversation.commandPermission.unavailable'));
const triggerIcon = computed(() => LEVEL_ICONS[props.view?.permission_level ?? 'standard']);
const triggerTooltip = computed(() => {
  if (!props.view) return displayText.value;
  return conversationMessage(
    props.view.source === 'global_setting'
      ? 'conversation.commandPermission.tooltipFollow'
      : 'conversation.commandPermission.tooltipExplicit',
    { level: displayText.value },
  );
});
const options = computed<readonly CustomSelectOption[]>(() => props.view ? [
  {
    value: FOLLOW,
    text: conversationMessage('conversation.commandPermission.followOption'),
    iconComponent: LEVEL_ICONS[props.view.global_level],
    description: conversationMessage('conversation.commandPermission.followDescription', {
      level: label(props.view.global_level),
    }),
  },
  { isSeparator: true },
  ...LEVELS.map(level => ({
    value: level,
    text: label(level),
    iconComponent: LEVEL_ICONS[level],
    description: settingsMessage(commandPermissionDescriptionKeys[level]),
    variant: level === 'full_access' ? 'warning' as const : 'default' as const,
  })),
  { isSeparator: true },
  {
    value: OPEN_SETTINGS,
    text: conversationMessage('conversation.commandPermission.openSettings'),
    className: 'conversation-command-permission__settings-link',
  },
] : []);

function choose(value: string | number | boolean) {
  if (value === OPEN_SETTINGS) {
    emit('openSettings');
    return;
  }
  if (value === FOLLOW) {
    emit('select', null);
    return;
  }
  const level = LEVELS.find(item => item === value);
  if (level) emit('select', level);
}
</script>
