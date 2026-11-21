<script setup lang="ts">
import type { PluginCleanupFailureReason, PluginDataSummary, PluginStateView } from '@app/schemas';
import { formatStorageBytes } from '@app/localization';
import { BaseButton } from '@linnya/renderer-ui';
import { usePluginStoreLocalization } from './usePluginStoreLocalization';
import type { PluginStoreMessageKey } from '../definitions/pluginStoreMessages';
import '../styles/components/PluginDataPanel.css';

const props = defineProps<{
  readonly data?: PluginDataSummary;
  readonly measurement?: PluginStateView['dataMeasurement'];
  readonly locale: string;
  readonly canDelete: boolean;
}>();

const emit = defineEmits<{ delete: []; retry: []; stop: []; reveal: []; measure: [paused: boolean] }>();
const { pluginStoreMessage } = usePluginStoreLocalization();

const labels: Readonly<Record<'source' | 'derived' | 'runtime', PluginStoreMessageKey>> = {
  source: 'pluginStore.data.source',
  derived: 'pluginStore.data.derived',
  runtime: 'pluginStore.data.runtime',
} as const;

const failureLabels: Readonly<Record<PluginCleanupFailureReason, PluginStoreMessageKey>> = {
  'file-locked': 'pluginStore.data.failure.fileLocked',
  'permission-denied': 'pluginStore.data.failure.permissionDenied',
  interrupted: 'pluginStore.data.failure.interrupted',
  'disk-full': 'pluginStore.data.failure.diskFull',
  unknown: 'pluginStore.data.failure.unknown',
};

function statusLabel(status: PluginDataSummary['status']): string {
  switch (status) {
    case 'installed': return pluginStoreMessage('pluginStore.data.status.installed');
    case 'empty': return pluginStoreMessage('pluginStore.data.status.empty');
    case 'retained': return pluginStoreMessage('pluginStore.data.status.retained');
    case 'legacy': return pluginStoreMessage('pluginStore.data.status.legacy');
    case 'cleaning': return pluginStoreMessage('pluginStore.data.status.cleaning');
    case 'failed': return pluginStoreMessage('pluginStore.data.status.failed');
    case 'unavailable': return pluginStoreMessage('pluginStore.data.status.unavailable');
  }
}
</script>

<template>
  <section class="plugin-data-panel plugin-store-detail-section" :aria-label="pluginStoreMessage('pluginStore.data.ariaLabel')">
    <div class="plugin-data-panel__header">
      <h2>{{ pluginStoreMessage('pluginStore.data.title') }}</h2>
      <span v-if="data && data.status !== 'empty'" class="plugin-data-panel__total">{{ pluginStoreMessage('pluginStore.data.total', { bytes: formatStorageBytes(data.bytes, locale) }) }}</span>
    </div>
    <div v-if="measurement" class="plugin-data-panel__measurement">
      <p class="plugin-data-panel__hint">{{ pluginStoreMessage(measurement === 'running' ? 'pluginStore.data.measuring' : 'pluginStore.data.measurementPaused') }}</p>
      <BaseButton variant="ghost" size="sm" @click="emit('measure', measurement === 'running')">
        {{ pluginStoreMessage(measurement === 'running' ? 'pluginStore.data.pauseMeasurement' : 'pluginStore.data.resumeMeasurement') }}
      </BaseButton>
    </div>
    <template v-if="data">
    <p class="plugin-data-panel__status" :class="`is-${data.status}`">{{ statusLabel(data.status) }}</p>
    <dl v-if="data.status !== 'empty'" class="plugin-data-panel__rows">
      <div v-for="category in (['source', 'derived', 'runtime'] as const)" :key="category" class="plugin-data-panel__row">
        <dt>{{ pluginStoreMessage(labels[category]) }}</dt>
        <dd>{{ formatStorageBytes(data.directories[category], locale) }}</dd>
      </div>
    </dl>
    <p v-if="Object.values(data.tables).some(count => count > 0)" class="plugin-data-panel__records">
      {{ pluginStoreMessage('pluginStore.data.records', { count: Object.values(data.tables).reduce((total, count) => total + count, 0) }) }}
    </p>
    <p v-if="data.status === 'retained' || data.status === 'legacy'" class="plugin-data-panel__hint">
      {{ pluginStoreMessage('pluginStore.data.retainedHint') }}
    </p>
    <template v-if="data.status === 'cleaning'">
      <p v-if="data.removedEntries !== undefined" class="plugin-data-panel__hint plugin-data-panel__progress">
        {{ pluginStoreMessage('pluginStore.data.cleanupProgress', { count: data.removedEntries }) }}
      </p>
      <p class="plugin-data-panel__hint">{{ pluginStoreMessage('pluginStore.data.cleaningHint') }}</p>
      <BaseButton variant="secondary" size="sm" @click="emit('stop')">{{ pluginStoreMessage('pluginStore.data.stop') }}</BaseButton>
      <BaseButton variant="ghost" size="sm" @click="emit('reveal')">{{ pluginStoreMessage('pluginStore.data.reveal') }}</BaseButton>
    </template>
    <template v-else-if="data.status === 'failed'">
      <p class="plugin-data-panel__attention">{{ pluginStoreMessage('pluginStore.data.cleanupIncomplete', { bytes: formatStorageBytes(data.bytes, locale) }) }}</p>
      <p v-if="data.errorCode" class="plugin-data-panel__reason">{{ pluginStoreMessage(failureLabels[data.errorCode]) }}</p>
      <div class="plugin-data-panel__actions">
        <BaseButton variant="secondary" size="sm" @click="emit('retry')">{{ pluginStoreMessage('pluginStore.data.retry') }}</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="emit('reveal')">{{ pluginStoreMessage('pluginStore.data.reveal') }}</BaseButton>
      </div>
    </template>
    <button v-else-if="canDelete && (data.status === 'retained' || data.status === 'legacy')" type="button" class="plugin-data-panel__danger" @click="emit('delete')">
      {{ data.status === 'legacy' ? pluginStoreMessage('pluginStore.data.cleanup') : pluginStoreMessage('pluginStore.data.delete') }}
    </button>
    </template>
  </section>
</template>

