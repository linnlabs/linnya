<template>
  <SettingsPage :description="systemMessage('system.memoryDiagnostics.description')">
    <SettingsSection
      :title="systemMessage('system.memoryDiagnostics.recording.title')"
      :description="systemMessage('system.memoryDiagnostics.recording.description')"
    >
      <div class="process-memory-observation__recording-row">
        <div class="process-memory-observation__status">
          <span :class="['process-memory-observation__status-dot', `is-${status}`]" />
          <strong>{{ statusLabel }}</strong>
          <span v-if="summary" class="process-memory-observation__sample-count">
            {{ summary.sampleCount }} {{ systemMessage('system.memoryDiagnostics.samples') }}
          </span>
        </div>
        <div class="process-memory-observation__secondary-actions">
          <button
            type="button"
            class="settings-inline-button is-quiet"
            :disabled="status !== 'recording'"
            @click="sampleNow"
          >
            {{ systemMessage('system.memoryDiagnostics.actions.sample') }}
          </button>
          <button
            type="button"
            class="settings-inline-button is-quiet"
            :disabled="!summary || status === 'recording'"
            @click="exportReport"
          >
            {{ systemMessage('system.memoryDiagnostics.actions.export') }}
          </button>
        </div>
      </div>
      <SettingsActions
        :primary-text="status === 'recording'
          ? systemMessage('system.memoryDiagnostics.actions.stop')
          : systemMessage('system.memoryDiagnostics.actions.start')"
        :secondary-text="systemMessage('system.memoryDiagnostics.actions.clear')"
        :secondary-disabled="status === 'recording' || samples.length === 0"
        @primary="toggleRecording"
        @secondary="clearRecording"
      />
      <SettingsFeedback kind="error" :message="errorMessage" />
      <SettingsFeedback :kind="feedbackKind" :message="feedbackMessage" />
    </SettingsSection>

    <SettingsSection
      v-if="summary"
      :title="systemMessage('system.memoryDiagnostics.summary.title')"
    >
      <div class="process-memory-observation__summary-grid">
        <article v-for="card in summaryCards" :key="card.label">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>
      <p class="process-memory-observation__summary-meta">
        {{ formatDuration(summary.durationMs) }} ·
        {{ systemMessage('system.memoryDiagnostics.summary.largestProcess') }}:
        {{ largestProcessLabel }}
      </p>
    </SettingsSection>

    <SettingsSection
      v-if="timelineView"
      :title="systemMessage('system.memoryDiagnostics.timeline.title')"
      :description="systemMessage('system.memoryDiagnostics.timeline.description')"
    >
      <MemoryTimeline
        :view="timelineView"
        :chart-label="systemMessage('system.memoryDiagnostics.timeline.ariaLabel')"
        :legend="timelineLegend"
      />
    </SettingsSection>

    <SettingsSection
      v-if="latestProcesses.length > 0"
      :title="systemMessage('system.memoryDiagnostics.processes.title')"
    >
      <div class="process-memory-observation__table-scroll">
        <table class="process-memory-observation__process-table">
          <thead>
            <tr>
              <th>{{ systemMessage('system.memoryDiagnostics.processes.process') }}</th>
              <th>{{ systemMessage('system.memoryDiagnostics.processes.workingSet') }}</th>
              <th>{{ systemMessage('system.memoryDiagnostics.processes.private') }}</th>
              <th>{{ systemMessage('system.memoryDiagnostics.processes.peak') }}</th>
              <th>CPU</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="processInfo in latestProcesses" :key="processInfo.pid">
              <td>
                <strong>{{ processLabel(processInfo) }}</strong>
                <small>PID {{ processInfo.pid }} · {{ processInfo.type }}</small>
              </td>
              <td>{{ formatMB(processInfo.workingSetMB) }}</td>
              <td>{{ processInfo.privateMB === null ? '—' : formatMB(processInfo.privateMB) }}</td>
              <td>{{ formatMB(processInfo.peakWorkingSetMB) }}</td>
              <td>{{ processInfo.cpuPercent.toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="status === 'recording' || markers.length > 0"
      :title="systemMessage('system.memoryDiagnostics.marker.title')"
      :description="systemMessage('system.memoryDiagnostics.marker.description')"
    >
      <SettingsRow
        v-if="status === 'recording'"
        control="fill"
        :label="systemMessage('system.memoryDiagnostics.marker.label')"
      >
        <div class="process-memory-observation__marker-control">
          <CustomTextInput
            v-model="markerDraft"
            :placeholder="systemMessage('system.memoryDiagnostics.marker.placeholder')"
            @keydown.enter="addMarker"
          />
          <button
            type="button"
            class="settings-inline-button"
            :disabled="markerDraft.trim().length === 0"
            @click="addMarker"
          >
            {{ systemMessage('system.memoryDiagnostics.marker.add') }}
          </button>
        </div>
      </SettingsRow>
      <ol v-if="markers.length > 0" class="process-memory-observation__marker-list">
        <li v-for="marker in markers" :key="`${marker.timestamp}-${marker.label}`">
          <time>{{ formatMarkerOffset(marker.timestamp) }}</time>
          <span>{{ marker.label }}</span>
        </li>
      </ol>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ElectronProcessMemoryMetric } from '@app/schemas';
import { CustomTextInput } from '@linnya/renderer-ui';
import {
  SettingsActions,
  SettingsFeedback,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@/domains/settings/public';
import { useSystemLocalization } from '../../../ui/useSystemLocalization';
import { buildMemoryTimelineView } from '../functions/buildMemoryTimelineView';
import { useProcessMemoryObservationStore } from '../store/processMemoryObservationStore';
import {
  clearProcessMemoryObservation,
  markProcessMemoryObservation,
  sampleProcessMemoryObservation,
  startProcessMemoryObservation,
  stopProcessMemoryObservation,
} from '../orchestration/processMemoryObservationSession';
import { exportProcessMemoryObservation } from '../orchestration/exportProcessMemoryObservation';
import MemoryTimeline from './MemoryTimeline.vue';

const store = useProcessMemoryObservationStore();
const {
  errorMessage,
  latestSample,
  markers,
  samples,
  startedAt,
  status,
  summary,
} = storeToRefs(store);
const { systemMessage } = useSystemLocalization();
const markerDraft = ref('');
const feedbackMessage = ref('');
const feedbackKind = ref<'success' | 'error' | 'info'>('info');

const statusLabel = computed(() => systemMessage(
  status.value === 'recording'
    ? 'system.memoryDiagnostics.state.recording'
    : status.value === 'stopped'
      ? 'system.memoryDiagnostics.state.stopped'
      : 'system.memoryDiagnostics.state.idle',
));
const timelineView = computed(() => buildMemoryTimelineView(samples.value, {
  width: 720,
  height: 180,
}));
const timelineLegend = computed(() => [
  { id: 'total' as const, label: systemMessage('system.memoryDiagnostics.timeline.total') },
  { id: 'main' as const, label: systemMessage('system.memoryDiagnostics.role.main') },
  { id: 'renderer' as const, label: systemMessage('system.memoryDiagnostics.role.renderer') },
  { id: 'hidden-worker' as const, label: systemMessage('system.memoryDiagnostics.role.hiddenWorker') },
]);
const latestProcesses = computed(() => latestSample.value?.snapshot.metrics ?? []);
const summaryCards = computed(() => summary.value ? [
  {
    label: systemMessage('system.memoryDiagnostics.summary.baseline'),
    value: formatMB(summary.value.baselineWorkingSetMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.peak'),
    value: formatMB(summary.value.peakWorkingSetMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.latest'),
    value: formatMB(summary.value.latestWorkingSetMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.delta'),
    value: formatSignedMB(summary.value.deltaFromBaselineMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.released'),
    value: formatMB(summary.value.releasedFromPeakMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.mainExternal'),
    value: formatMB(summary.value.peakMainExternalMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.mainArrayBuffers'),
    value: formatMB(summary.value.peakMainArrayBuffersMB),
  },
  {
    label: systemMessage('system.memoryDiagnostics.summary.rendererHeap'),
    value: summary.value.peakRendererHeapMB === null
      ? '—'
      : formatMB(summary.value.peakRendererHeapMB),
  },
] : []);
const largestProcessLabel = computed(() => {
  const processInfo = summary.value?.largestProcess;
  return processInfo
    ? `${processLabel(processInfo)} · ${formatMB(processInfo.workingSetMB)}`
    : '—';
});

function formatMB(value: number): string {
  return `${value.toFixed(1)} MB`;
}

function formatSignedMB(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} MB`;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatMarkerOffset(timestamp: number): string {
  return `+${formatDuration(Math.max(0, timestamp - startedAt.value))}`;
}

function processLabel(processInfo: ElectronProcessMemoryMetric): string {
  if (processInfo.role === 'main') return systemMessage('system.memoryDiagnostics.role.main');
  if (processInfo.role === 'app-renderer') return systemMessage('system.memoryDiagnostics.role.renderer');
  if (processInfo.role === 'hidden-worker') {
    return processInfo.ownerId ?? systemMessage('system.memoryDiagnostics.role.hiddenWorker');
  }
  if (processInfo.role === 'gpu') return systemMessage('system.memoryDiagnostics.role.gpu');
  if (processInfo.role === 'utility') return processInfo.serviceName
    ?? systemMessage('system.memoryDiagnostics.role.utility');
  return processInfo.name ?? processInfo.serviceName
    ?? systemMessage('system.memoryDiagnostics.role.other');
}

async function toggleRecording(): Promise<void> {
  feedbackMessage.value = '';
  if (status.value === 'recording') {
    await stopProcessMemoryObservation();
  } else {
    await startProcessMemoryObservation();
  }
}

function clearRecording(): void {
  clearProcessMemoryObservation();
  feedbackMessage.value = '';
}

function sampleNow(): void {
  void sampleProcessMemoryObservation('manual');
}

function addMarker(): void {
  const label = markerDraft.value.trim();
  if (!label) return;
  markProcessMemoryObservation(label);
  markerDraft.value = '';
}

async function exportReport(): Promise<void> {
  feedbackMessage.value = '';
  try {
    const result = await exportProcessMemoryObservation();
    if (result === 'saved') {
      feedbackKind.value = 'success';
      feedbackMessage.value = systemMessage('system.memoryDiagnostics.export.saved');
    }
  } catch (error) {
    feedbackKind.value = 'error';
    feedbackMessage.value = error instanceof Error ? error.message : String(error);
  }
}
</script>
