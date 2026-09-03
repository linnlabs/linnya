<template>
  <SettingsPage>
    <SettingsSection>
      <SettingsSwitchRow
        v-model="automaticTitleEnabled"
        :label="settingsMessage('settings.conversation.automaticTitle.label')"
        :description="settingsMessage('settings.conversation.automaticTitle.description')"
      />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationTitleSettingsStore } from '@/domains/conversation/features/conversation-title';
import { SettingsPage, SettingsSection, SettingsSwitchRow } from '../kit';
import { useSettingsLocalization } from '../useSettingsLocalization';

const conversationTitleSettingsStore = useConversationTitleSettingsStore();
const { settingsMessage } = useSettingsLocalization();

const automaticTitleEnabled = computed({
  get: () => conversationTitleSettingsStore.isAutomaticTitleEnabled,
  set: (enabled: boolean) => conversationTitleSettingsStore.setAutomaticTitleEnabled(enabled),
});
</script>
