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
          :key="choiceGroupRevision"
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
          :description="settingsMessage('settings.commandPermission.internalData.description')"
          :disabled="isBusy"
          @update:model-value="setInternalDataAccess"
        />
      </SettingsSection>

      <AlertDialog
        v-if="reductionPreview"
        visible
        is-confirmation
        :close-is-cancel="false"
        width="460px"
        :title="settingsMessage('settings.commandPermission.reduction.title')"
        :message="settingsMessage('settings.commandPermission.reduction.message', {
          count: reductionPreview.affected_count,
          level: reductionLevelLabel,
        })"
        :confirm-text="settingsMessage('settings.commandPermission.reduction.apply', { level: reductionLevelLabel })"
        :cancel-text="settingsMessage('settings.commandPermission.reduction.globalOnly')"
        @confirm="applyReduction(true)"
        @cancel="applyReduction(false)"
        @close="cancelReduction"
      />

      <SettingsFeedback
        :kind="store.saveState === 'failed' ? 'error' : 'success'"
        :message="feedbackMessage"
      />
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { CommandPermissionLevelSchema, compareCommandPermissionLevels, type CommandPermissionLevel } from '@app/schemas/commands';
import { AlertDialog } from '@linnya/renderer-ui';
import {
  commandPermissionDescriptionKeys,
  commandPermissionLabelKeys,
} from '@/app/workflows/command-permissions/permissionLabels';
import { useCommandPermissionReduction } from '../orchestration/useCommandPermissionReduction';
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
import { confirmPermissionLevelExpansion } from '../orchestration/confirmPermissionLevelExpansion';
import { applyCommandPermissionSettingsChange } from '../orchestration/applyCommandPermissionSettingsChange';
import { ensureCommandPermissionSettingsLoaded } from '../orchestration/ensureCommandPermissionSettingsLoaded';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

const store = useCommandPermissionSettingsStore();
const { settingsMessage } = useSettingsLocalization();
const {
  preview: reductionPreview,
  partialCount,
  prepare: prepareReduction,
  cancel: discardReduction,
  apply: applyReduction,
} = useCommandPermissionReduction();
const choiceGroupRevision = ref(0);
function cancelReduction() {
  discardReduction();
  // 点击原生 radio 时浏览器已先切换选中值，关闭确认后重新应用 Host 投影。
  choiceGroupRevision.value++;
}
const reductionLevelLabel = computed(() => reductionPreview.value
  ? settingsMessage(commandPermissionLabelKeys[reductionPreview.value.target_level])
  : '');
const isBusy = computed(() => (
  store.saveState === 'saving' || store.saveState === 'confirming'
));
const permissionLevelOptions = computed<readonly SettingsChoiceOption[]>(() => (
  CommandPermissionLevelSchema.options.map((level) => ({
    value: level,
    label: settingsMessage(commandPermissionLabelKeys[level]),
    description: settingsMessage(commandPermissionDescriptionKeys[level]),
    tone: level === 'full_access' ? 'danger' : 'default',
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


const feedbackMessage = computed(() => {
  if (partialCount.value !== undefined && store.saveState === 'failed') {
    return settingsMessage('settings.commandPermission.reduction.partial', { count: partialCount.value });
  }
  return saveStatusMessage.value ? settingsMessage(saveStatusMessage.value) : '';
});

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
  const parsed = CommandPermissionLevelSchema.safeParse(value);
  const current = store.projection;
  if (!parsed.success || !current || isBusy.value) return;
  const level = parsed.data;
  if (compareCommandPermissionLevels(level, current.permissionLevel) < 0) {
    await prepareReduction(level);
    choiceGroupRevision.value++;
    return;
  }
  await applyCommandPermissionSettingsChange({ kind: 'permission_level', value: level }, {
    confirmExpansion: level === 'read_only' ? undefined : () => confirmPermissionLevelExpansion(settingsMessage, level),
  });
}

async function setInternalDataAccess(allowed: boolean): Promise<void> {
  await applyCommandPermissionSettingsChange({
    kind: 'internal_data_access',
    value: allowed ? 'allowed' : 'denied',
  }, { confirmExpansion: confirmInternalDataExpansion });
}

onMounted(() => {
  // 全局设置始终向 App Server 读取，避免把对话档位当成全局设置。
  void ensureCommandPermissionSettingsLoaded();
});
</script>
