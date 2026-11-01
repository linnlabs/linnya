<template>
  <BaseDropdown
    v-if="presentation"
    class="app-update-entry"
    :external-content-ref="panelRef"
  >
    <template #trigger="{ toggle, isOpen }">
      <HoverTooltip
        :text="tooltipText"
        placement="bottom"
        :disabled="isOpen"
      >
        <button
          v-if="presentation.shape === 'pill'"
          ref="triggerRef"
          type="button"
          class="app-update-entry__pill"
          :disabled="status === 'installing' || store.requestingRestart"
          :aria-label="tooltipText"
          @click="store.requestRestart()"
        >
          <RefreshIcon :spinning="status === 'installing'" />
          <span>{{ updateMessage(presentation.labelKey) }}</span>
        </button>
        <span
          v-else
          ref="triggerRef"
          class="app-update-entry__trigger"
        >
          <IconButton
            :label="tooltipText"
            :tooltip="false"
            class="app-update-entry__button"
            :class="`is-${presentation.tone}`"
            :aria-expanded="presentation.opensPanel ? isOpen : undefined"
            @click="handleIconClick($event, toggle, isOpen)"
          >
            <UpdateIcon :progress="presentation.progress" />
          </IconButton>
        </span>
      </HoverTooltip>
    </template>

    <template #content="{ isOpen, close }">
      <Teleport to="body">
        <div
          v-if="isOpen && presentation.opensPanel"
          ref="panelRef"
          class="app-update-panel"
          :class="[DROPDOWN_SURFACE_CLASSES.root, DROPDOWN_SURFACE_CLASSES.panel, DROPDOWN_SURFACE_CLASSES.portal]"
          :style="panelStyle"
          role="dialog"
          :aria-label="panelTitle"
        >
          <h4 class="app-update-panel__title">
            {{ panelTitle }}
          </h4>
          <p class="app-update-panel__subtitle">
            {{ panelSubtitle }}
          </p>

          <template v-if="status !== 'failed'">
            <div
              class="app-update-panel__bar"
              :class="{ 'is-warning': status === 'paused' }"
            >
              <i :style="{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }" />
            </div>
            <div class="app-update-panel__meta">
              <span>{{ sizeText }}</span>
              <span>{{ rateText }}</span>
            </div>
          </template>

          <div
            v-if="status === 'downloading' && releaseNotesHtml"
            class="app-update-panel__notes"
          >
            <div class="app-update-panel__notes-title">
              {{ updateMessage('update.panel.releaseNotes') }}
            </div>
            <div
              class="app-update-panel__notes-body"
              v-html="releaseNotesHtml"
            />
          </div>

          <div class="app-update-panel__actions">
            <button
              v-if="status === 'downloading'"
              type="button"
              class="app-update-panel__action is-quiet"
              @click="cancelAndClose(close)"
            >
              {{ updateMessage('update.panel.actions.cancelDownload') }}
            </button>
            <template v-else>
              <button
                type="button"
                class="app-update-panel__action is-quiet"
                @click="cancelAndClose(close)"
              >
                {{ updateMessage('update.panel.actions.cancel') }}
              </button>
              <button
                v-if="canRetry"
                type="button"
                class="app-update-panel__action"
                @click="retryAndClose(close)"
              >
                {{ updateMessage('update.panel.actions.retry') }}
              </button>
            </template>
          </div>
        </div>
      </Teleport>
    </template>
  </BaseDropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { storeToRefs } from 'pinia';
import {
  BaseDropdown,
  DROPDOWN_SURFACE_CLASSES,
  HoverTooltip,
  IconButton,
} from '@linnya/renderer-ui';
import { RefreshIcon, UpdateIcon } from '@linnya/renderer-ui/icons';
import { useNotificationStore } from '@/app/notification';
import type { UpdateMessageKey } from '../definitions/updateMessages';
import {
  formatUpdateBytes,
  resolveUpdateEntryPresentation,
} from '../functions/resolveUpdateEntryPresentation';
import { useUpdateStore } from '../store/updateStore';
import { useUpdateLocalization } from './useUpdateLocalization';

const PANEL_WIDTH = 280;
const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;

const store = useUpdateStore();
const { state, status } = storeToRefs(store);
const { updateMessage } = useUpdateLocalization();
const notifications = useNotificationStore();

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelPosition = ref({ top: 0, left: 0 });

const presentation = computed(() => resolveUpdateEntryPresentation(state.value));
const progress = computed(() => state.value?.progress ?? null);
const version = computed(() => state.value?.version ?? '');

const tooltipText = computed(() => {
  const current = presentation.value;
  if (!current) return '';
  if (current.shape === 'pill' && status.value === 'ready') {
    return updateMessage('update.entry.readyTooltip', { version: version.value });
  }
  return updateMessage(current.labelKey, current.labelParams);
});

const failureKey = computed<UpdateMessageKey>(() => (
  `update.panel.failed.${state.value?.failure?.kind ?? 'unknown'}` as UpdateMessageKey
));

const panelTitle = computed(() => {
  if (status.value === 'paused') return updateMessage('update.panel.paused.title');
  if (status.value === 'failed') return updateMessage('update.panel.failed.title');
  return updateMessage('update.panel.downloading.title', { version: version.value });
});

const panelSubtitle = computed(() => {
  if (status.value === 'paused') return updateMessage('update.panel.paused.subtitle');
  if (status.value === 'failed') return updateMessage(failureKey.value);
  return updateMessage('update.panel.downloading.subtitle');
});

// 位置问题需要用户先移动 App，重试没有意义；其他失败都允许重新下载。
const canRetry = computed(() => status.value !== 'failed' || state.value?.failure?.kind !== 'location');

const sizeText = computed(() => {
  const current = progress.value;
  if (!current) return '';
  const transferred = formatUpdateBytes(current.transferredBytes);
  return current.totalBytes ? `${transferred} / ${formatUpdateBytes(current.totalBytes)}` : transferred;
});

const rateText = computed(() => {
  if (status.value === 'paused') return updateMessage('update.panel.waitingNetwork');
  const current = progress.value;
  const percent = current?.fraction == null ? '' : `${Math.round(current.fraction * 100)}%`;
  const speed = current?.bytesPerSecond
    ? updateMessage('update.panel.speed', { speed: formatUpdateBytes(current.bytesPerSecond) })
    : '';
  return [percent, speed].filter(Boolean).join(' · ');
});

const releaseNotesHtml = computed(() => {
  const notes = state.value?.releaseNotes;
  if (!notes) return '';
  const html = marked.parse(notes, { gfm: true, breaks: true, async: false });
  return typeof html === 'string' ? DOMPurify.sanitize(html) : '';
});

const panelStyle = computed(() => ({
  top: `${panelPosition.value.top}px`,
  left: `${panelPosition.value.left}px`,
  width: `${PANEL_WIDTH}px`,
}));

function positionPanel(): void {
  const rect = triggerRef.value?.getBoundingClientRect();
  if (!rect) return;
  const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
  panelPosition.value = {
    top: rect.bottom + PANEL_GAP,
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left - VIEWPORT_MARGIN, maxLeft)),
  };
}

function handleIconClick(event: MouseEvent, toggle: (event?: Event) => void, isOpen: boolean): void {
  if (!presentation.value?.opensPanel) {
    void store.download();
    return;
  }
  if (!isOpen) positionPanel();
  toggle(event);
  if (!isOpen) void nextTick(positionPanel);
}

function cancelAndClose(close: () => void): void {
  close();
  void store.cancelDownload();
}

function retryAndClose(close: () => void): void {
  close();
  void store.download();
}

// 更新后第一次打开：提示一次新版本号，然后告诉 Main 已经提示过。
watch(
  () => state.value?.installedVersion ?? null,
  installed => {
    if (!installed) return;
    notifications.show(updateMessage('update.installed', { version: installed }), 'success', 5_000);
    void store.acknowledgeInstalled();
  },
  { immediate: true },
);
</script>
