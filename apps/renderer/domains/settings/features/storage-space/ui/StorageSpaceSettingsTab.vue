<template>
  <SettingsPage>
    <SettingsSection>
      <SettingsState
        v-if="store.loadState === 'loading' && !store.overview"
        kind="loading"
        :message="settingsMessage('settings.storageSpace.loading')"
      />
      <SettingsState
        v-else-if="store.loadState === 'failed'"
        kind="error"
        :message="settingsMessage('settings.storageSpace.unavailable')"
      >
        <template #action>
          <button
            type="button"
            class="settings-inline-button"
            @click="refresh"
          >
            {{ settingsMessage('settings.storageSpace.actions.refresh') }}
          </button>
        </template>
      </SettingsState>

      <div
        v-if="store.overview"
        class="storage-space-summary"
      >
        <div class="storage-space-summary-total">
          <span class="storage-space-summary-label">
            {{ settingsMessage('settings.storageSpace.total') }}
          </span>
          <strong class="storage-space-summary-value">
            {{ formatStorageBytes(store.overview.total_byte_size, locale) }}
          </strong>
        </div>
        <small class="storage-space-summary-meta">
          {{ settingsMessage('settings.storageSpace.measuredAt') }}:
          {{ formatMeasuredAt(store.overview.measured_at_ms) }}
        </small>
      </div>
    </SettingsSection>

    <template v-if="store.overview">
      <SettingsSection :title="settingsMessage('settings.storageSpace.categories')">
        <SettingsList class="storage-space-list storage-space-category-list">
          <SettingsListRow
            v-for="category in store.overview.categories"
            :key="category.kind"
            :title="settingsMessage(projectStorageCategoryMessage(category.kind))"
          >
            <template #trailing>
              <span class="storage-space-size">
                {{ formatStorageBytes(category.byte_size, locale) }}
              </span>
            </template>
          </SettingsListRow>
        </SettingsList>
      </SettingsSection>

      <SettingsSection :title="settingsMessage('settings.storageSpace.conversations')">
        <SettingsState
          v-if="store.overview.conversations.length === 0"
          kind="empty"
          :message="settingsMessage('settings.storageSpace.empty')"
        />
        <SettingsList
          v-else
          class="storage-space-list storage-space-conversation-list"
        >
          <SettingsListRow
            v-for="conversation in store.overview.conversations"
            :key="conversation.conversation_id"
            :title="projectStorageConversationTitle(
              conversation.title,
              settingsMessage('settings.storageSpace.unnamedConversation'),
            )"
          >
            <template #meta>
              {{ settingsMessage(projectStorageWorkFilesStateMessage(conversation.work_files_state)) }}
              <span
                v-if="clearFailureText(conversation.conversation_id)"
                class="storage-space-row-error"
                role="status"
              >
                {{ clearFailureText(conversation.conversation_id) }}
              </span>
            </template>
            <template #trailing>
              <span class="storage-space-size">
                {{ conversation.byte_size === null
                  ? settingsMessage('settings.storageSpace.valueUnavailable')
                  : formatStorageBytes(conversation.byte_size, locale) }}
              </span>
              <button
                type="button"
                class="settings-inline-button is-quiet is-danger"
                :disabled="store.isPending(conversation.conversation_id)
                  || conversation.work_files_state !== 'available'"
                @click="clear(conversation.conversation_id)"
              >
                {{ settingsMessage(store.isPending(conversation.conversation_id)
                  ? 'settings.storageSpace.actions.clearing'
                  : 'settings.storageSpace.actions.clear') }}
              </button>
            </template>
          </SettingsListRow>
        </SettingsList>
      </SettingsSection>
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';

import { confirm } from '@shared/composables/confirmDialog';
import {
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
  SettingsState,
} from '../../../ui/kit';
import { useSettingsLocalization } from '../../../ui/useSettingsLocalization';
import { formatStorageBytes } from '../functions/formatStorageBytes';
import { projectStorageConversationTitle } from '../functions/projectStorageConversationTitle';
import {
  projectStorageCategoryMessage,
  projectStorageClearFailureMessage,
  projectStorageWorkFilesStateMessage,
} from '../functions/projectStorageSpaceMessages';
import { clearConversationWorkDirectory } from '../orchestration/clearConversationWorkDirectory';
import { loadStorageSpaceOverview } from '../orchestration/loadStorageSpaceOverview';
import { useStorageSpaceStore } from '../store/storageSpaceStore';

const store = useStorageSpaceStore();
const { settingsMessage } = useSettingsLocalization();
const locale = navigator.language;

function formatMeasuredAt(measuredAtMs: number): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(measuredAtMs));
}

function clearFailureText(conversationId: string): string | undefined {
  const failure = store.failureFor(conversationId);
  return failure ? settingsMessage(projectStorageClearFailureMessage(failure)) : undefined;
}

function refresh(): void {
  void loadStorageSpaceOverview();
}

function clear(conversationId: string): void {
  void clearConversationWorkDirectory({
    conversationId,
    confirmClear: () => confirm({
      title: settingsMessage('settings.storageSpace.confirm.title'),
      message: settingsMessage('settings.storageSpace.confirm.message'),
      confirmText: settingsMessage('settings.storageSpace.confirm.confirm'),
      cancelText: settingsMessage('settings.storageSpace.confirm.cancel'),
      isDangerousAction: true,
    }),
  });
}

onMounted(refresh);
</script>
