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
          <BaseButton
            variant="secondary"
            @click="refresh"
          >
            {{ settingsMessage('settings.storageSpace.actions.refresh') }}
          </BaseButton>
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
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import { onMounted } from 'vue';

import {
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
  SettingsState,
} from '../../../ui/kit';
import { useSettingsLocalization } from '../../../ui/useSettingsLocalization';
import { formatStorageBytes } from '@/shared/utils/formatStorageBytes';
import { projectStorageCategoryMessage } from '../functions/projectStorageSpaceMessages';
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

function refresh(): void {
  void loadStorageSpaceOverview();
}

onMounted(refresh);
</script>
