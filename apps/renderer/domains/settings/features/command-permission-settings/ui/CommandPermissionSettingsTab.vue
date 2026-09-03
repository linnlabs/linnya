<template>
  <SettingsPage>
    <SettingsState
      v-if="store.loadState === 'loading'"
      kind="loading"
      :message="settingsMessage('settings.commandPermission.loading')"
    />
    <SettingsState
      v-else-if="store.loadState === 'unavailable'"
      kind="unavailable"
      :message="settingsMessage('settings.commandPermission.unavailable')"
    />

    <template v-else-if="store.projection">
      <SettingsSection :title="settingsMessage('settings.commandPermission.level.title')">
        <SettingsChoiceGroup
          :model-value="store.draft?.permissionLevel ?? ''"
          :options="permissionLevelOptions"
          name="command-permission-level"
          :disabled="isBusy"
          @update:model-value="selectPermissionLevel"
        />
      </SettingsSection>

      <SettingsSection :title="settingsMessage('settings.commandPermission.internalData.title')">
        <SettingsSwitchRow
          :model-value="store.draft?.internalDataAccess === 'allowed'"
          :label="settingsMessage('settings.commandPermission.internalData.label')"
          :disabled="isBusy"
          @update:model-value="setInternalDataAccess"
        />
      </SettingsSection>

      <SettingsFeedback
        :kind="store.saveState === 'failed' ? 'error' : 'success'"
        :message="saveStatusMessage ? settingsMessage(saveStatusMessage) : ''"
      />
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';

import type { CommandPermissionLevel } from '@app/schemas/commands';
import type { SettingsChoiceOption } from '../../../definitions/settingsKit';
import type { SettingsMessageKey } from '../../../definitions/settingsMessages';
import {
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsPage,
  SettingsSection,
  SettingsState,
  SettingsSwitchRow,
} from '../../../ui/kit';
import { useSettingsLocalization } from '../../../ui/useSettingsLocalization';
import { confirm } from '@shared/composables/confirmDialog';
import { applyCommandPermissionSettingsChange } from '../orchestration/applyCommandPermissionSettingsChange';
import { ensureCommandPermissionSettingsLoaded } from '../orchestration/ensureCommandPermissionSettingsLoaded';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

interface PermissionLevelOption {
  readonly value: CommandPermissionLevel;
  readonly label: SettingsMessageKey;
  readonly description: SettingsMessageKey;
}

const permissionLevels: readonly PermissionLevelOption[] = [
  {
    value: 'read_only',
    label: 'settings.commandPermission.level.readOnly',
    description: 'settings.commandPermission.level.readOnlyDescription',
  },
  {
    value: 'standard',
    label: 'settings.commandPermission.level.standard',
    description: 'settings.commandPermission.level.standardDescription',
  },
  {
    value: 'full_access',
    label: 'settings.commandPermission.level.fullAccess',
    description: 'settings.commandPermission.level.fullAccessDescription',
  },
] as const;

const store = useCommandPermissionSettingsStore();
const { settingsMessage } = useSettingsLocalization();
const isBusy = computed(() => (
  store.saveState === 'saving' || store.saveState === 'confirming'
));
const permissionLevelOptions = computed<readonly SettingsChoiceOption[]>(() => (
  permissionLevels.map((level) => ({
    value: level.value,
    label: settingsMessage(level.label),
    description: settingsMessage(level.description),
    tone: level.value === 'full_access' ? 'danger' : 'default',
  }))
));
const saveStatusMessage = computed<SettingsMessageKey | undefined>(() => {
  if (store.saveState === 'saved') return 'settings.commandPermission.status.saved';
  if (store.saveState !== 'failed') return undefined;
  if (store.saveFailure === 'revision_conflict') {
    return 'settings.commandPermission.status.revisionConflict';
  }
  if (store.saveFailure === 'write_failed') {
    return 'settings.commandPermission.status.writeFailed';
  }
  return 'settings.commandPermission.status.saveFailed';
});

function confirmPermissionLevelExpansion(
  level: 'standard' | 'full_access',
): Promise<boolean> {
  const prefix = level === 'standard'
    ? 'settings.commandPermission.confirmExpansion.standard'
    : 'settings.commandPermission.confirmExpansion.fullAccess';

  return confirm({
    title: settingsMessage(`${prefix}.title`),
    message: settingsMessage(`${prefix}.message`),
    sections: level === 'standard'
      ? [
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.standard.files.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.standard.files.scope'),
            settingsMessage('settings.commandPermission.confirmExpansion.standard.files.riskyOperations'),
          ],
        },
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.run'),
            settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.network'),
          ],
        },
      ]
      : [
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.files.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.files.operations'),
          ],
        },
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.run'),
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.network'),
          ],
        },
      ],
    riskMessage: settingsMessage(`${prefix}.risk`),
    confirmText: settingsMessage('settings.commandPermission.confirmExpansion.confirm'),
    cancelText: settingsMessage('settings.commandPermission.confirmExpansion.cancel'),
    isDangerousAction: true,
    width: '520px',
  });
}

function confirmInternalDataExpansion(): Promise<boolean> {
  return confirm({
    title: settingsMessage('settings.commandPermission.confirmExpansion.internalData.title'),
    message: settingsMessage('settings.commandPermission.confirmExpansion.internalData.message'),
    confirmText: settingsMessage('settings.commandPermission.confirmExpansion.confirm'),
    cancelText: settingsMessage('settings.commandPermission.confirmExpansion.cancel'),
    isDangerousAction: true,
  });
}

async function selectPermissionLevel(value: string): Promise<void> {
  if (value === 'read_only' || value === 'standard' || value === 'full_access') {
    const change = {
      kind: 'permission_level',
      value,
    } as const;
    if (value === 'read_only') {
      await applyCommandPermissionSettingsChange(change);
      return;
    }
    await applyCommandPermissionSettingsChange(change, {
      confirmExpansion: () => confirmPermissionLevelExpansion(value),
    });
  }
}

async function setInternalDataAccess(allowed: boolean): Promise<void> {
  await applyCommandPermissionSettingsChange({
    kind: 'internal_data_access',
    value: allowed ? 'allowed' : 'denied',
  }, { confirmExpansion: confirmInternalDataExpansion });
}

onMounted(() => {
  // 设置页是权限的唯一管理入口，首次打开时在这里读取后端权威事实。
  void ensureCommandPermissionSettingsLoaded();
});
</script>
