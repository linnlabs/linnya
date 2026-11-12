<template>
  <BaseDropdown
    v-if="presentation"
    ref="entryRef"
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
          :class="{ 'is-compact': compact }"
          :disabled="status === 'installing' || store.requestingRestart"
          :aria-label="tooltipText"
          @click="actions.requestRestart()"
        >
          <RefreshIcon :spinning="status === 'installing'" />
          <span class="app-update-entry__label">{{ updateMessage(presentation.labelKey) }}</span>
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
      <!-- 量完整按钮的宽度，用来判断放不放得下；不参与布局，也不进无障碍树。 -->
      <span
        v-if="presentation.shape === 'pill'"
        ref="measureRef"
        class="app-update-entry__pill app-update-entry__measure"
        aria-hidden="true"
      >
        <RefreshIcon />
        <span class="app-update-entry__label">{{ updateMessage(presentation.labelKey) }}</span>
      </span>
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
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';
import { useElementSize } from '@vueuse/core';
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
import { useUpdateActions } from '../runtime';
import { useUpdateLocalization } from './useUpdateLocalization';

const props = withDefaults(defineProps<{
  /** 入口最多能占的宽度；放不下完整按钮时只显示图标。null 表示不限宽。 */
  availableWidth?: number | null;
}>(), { availableWidth: null });

const emit = defineEmits<{
  /** 入口当前实际占的宽度，没有入口时为 0；标题栏用它给主区域让位。 */
  widthChange: [width: number];
}>();

const PANEL_WIDTH = 280;
const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;

const store = useUpdateStore();
const actions = useUpdateActions();
const { state, status } = storeToRefs(store);
const { updateMessage } = useUpdateLocalization();
const notifications = useNotificationStore();

const entryRef = ref<ComponentPublicInstance | null>(null);
const measureRef = ref<HTMLElement | null>(null);
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

const { width: entryWidth } = useElementSize(entryRef, undefined, { box: 'border-box' });
const { width: fullPillWidth } = useElementSize(measureRef, undefined, { box: 'border-box' });

const compact = computed(() => (
  props.availableWidth !== null
  && fullPillWidth.value > 0
  && fullPillWidth.value > props.availableWidth
));

watch(entryWidth, width => emit('widthChange', presentation.value ? Math.round(width) : 0), { immediate: true });

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
    void actions.download();
    return;
  }
  if (!isOpen) positionPanel();
  toggle(event);
  if (!isOpen) void nextTick(positionPanel);
}

function cancelAndClose(close: () => void): void {
  close();
  void actions.cancelDownload();
}

function retryAndClose(close: () => void): void {
  close();
  void actions.download();
}

// 更新后第一次打开：提示一次新版本号，然后告诉 Main 已经提示过。
watch(
  () => state.value?.installedVersion ?? null,
  installed => {
    if (!installed) return;
    notifications.show(updateMessage('update.installed', { version: installed }), 'success', 5_000);
    void actions.acknowledgeInstalled();
  },
  { immediate: true },
);
</script>
