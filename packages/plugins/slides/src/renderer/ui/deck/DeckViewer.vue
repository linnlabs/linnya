<template>
  <div
    class="deck-viewer"
    @keydown="handleHistoryShortcut($event); handleClipboardShortcut($event)"
  >
    <div class="deck-viewer-body">
      <!-- 主区域：单页舞台或全稿平铺 -->
      <div
        ref="stageHostRef"
        class="deck-viewer-stage"
      >
        <!-- loading 期间不保留上一份文稿的状态页或舞台 DOM。 -->
        <div
          v-if="showLoading"
          class="stage-loading-spacer"
        />
        <SlidesStatusState
          v-else-if="documentBuildState?.state === 'draft'"
          title="PPT 编译失败"
          action-label="重新检查"
          tone="error"
          @action="reload"
        >
          <div class="deck-viewer__draft-failure-content">
            <SlidesDraftFailureLog
              v-if="draftFailureLog"
              :log="draftFailureLog"
            />
            <p class="deck-viewer__draft-failure-guidance">
              请让 AI 修复源码后重新编译。
            </p>
          </div>
        </SlidesStatusState>
        <SlidesStatusState
          v-else-if="deckError"
          :title="deckError"
          action-label="重试"
          tone="error"
          @action="reload"
        />
        <SlidesStatusState
          v-else-if="renderError"
          :title="slidesPreviewMessage('slides.preview.error.presentationRendering')"
          :description="renderError"
          action-label="重试"
          tone="error"
          @action="reload"
        />
        <SlidesStatusState
          v-else-if="!deckPreview"
          title="无预览数据"
        />
        <SlideGridView v-else-if="deckViewMode === 'grid'" />
        <SlideStage
          v-else
          :source-edit-busy="sourceEditBusy"
          @source-edit-submit="emit('sourceEditSubmit', $event)"
        />

        <div
          v-if="manualEditError"
          class="stage-manual-edit-error"
          role="status"
        >
          {{ manualEditError }}
          <button
            v-if="manualEditingStore.pendingPresentationRevision !== null"
            class="manual-edit-error__retry"
            @click="manualEditSubmission.refreshPresentation"
          >
            {{ manualEditingMessage('slides.manualEditing.refreshPresentation') }}
          </button>
        </div>
        <div
          v-else-if="manualEditNotice"
          class="stage-manual-edit-error"
          role="status"
        >
          {{ manualEditNotice }}
          <button
            class="manual-edit-error__retry"
            @click="manualEditingStore.setNotice(null)"
          >
            {{ manualEditingMessage('slides.manualEditing.notice.dismiss') }}
          </button>
        </div>

        <!-- 顶部居中的文稿命令条浮在舞台上，不进入布局；幻灯片位置不随它出现或消失。 -->
        <SlideEditingCommandBar v-if="manualEditingEnabled && deckPreview && deckViewMode === 'slide'" />

        <!-- 右下角缩放控件只更新自身数值，不参与文稿内容切换；平铺视图没有舞台可缩放。 -->
        <div
          v-if="deckPreview && deckViewMode === 'slide'"
          class="stage-zoom-slider"
        >
          <button
            class="stage-zoom-slider__btn"
            :disabled="zoomPercent <= ZOOM_PERCENT_MIN"
            aria-label="缩小"
            @click="adjustZoom(-ZOOM_PERCENT_STEP)"
          >
            <SubtractIcon class="stage-zoom-slider__icon" />
          </button>
          <CustomSlider
            class="stage-zoom-slider__input"
            variant="compact"
            :min="ZOOM_PERCENT_MIN"
            :max="ZOOM_PERCENT_MAX"
            :step="ZOOM_PERCENT_SLIDER_STEP"
            :model-value="zoomPercent"
            aria-label="缩放比例"
            @update:model-value="setZoomPercent"
          />
          <button
            class="stage-zoom-slider__btn"
            :disabled="zoomPercent >= ZOOM_PERCENT_MAX"
            aria-label="放大"
            @click="adjustZoom(ZOOM_PERCENT_STEP)"
          >
            <AddIcon class="stage-zoom-slider__icon" />
          </button>
          <StageZoomMenu
            :zoom-percent="zoomPercent"
            :zoom-mode="zoomMode"
            @action="applyZoomMenuAction"
          />
        </div>
      </div>

      <!-- 右栏：Inspector（FE-2 填充） -->
      <div
        v-if="inspectorVisible"
        class="deck-viewer-inspector"
        :style="{ width: `${INSPECTOR_DEFAULT_WIDTH}px` }"
      >
        <div class="inspector-placeholder">
          <span class="inspector-label">Inspector</span>
        </div>
      </div>
    </div>

    <!-- 底部导航：文稿切换时立即撤下旧页面条，加载期间保留同高占位避免舞台跳动。 -->
    <div
      v-if="showLoading"
      class="navigator-loading-spacer"
    />
    <DeckNavigatorBar v-else-if="deckPreview" />
  </div>
</template>

<script setup lang="ts">
import { useElementClipboard } from '../../features/elementClipboard';
import { SlideEditingCommandBar, useEditingCommands } from '../../features/editingCommands';

import { useSlidesDocumentRuntime } from '../../features/documentRuntime';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { CustomSlider } from '@linnya/renderer-ui';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesUiStore } from '../../store/slidesUiStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import {
  AddIcon,
  SubtractIcon,
} from '@linnya/renderer-ui/icons';
import SlideStage from '../preview/SlideStage.vue';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import { SlidesDraftFailureLog } from '../../features/documentBuildFailure';
import {
  INSPECTOR_DEFAULT_WIDTH,
  SLIDE_STAGE_FIT_PADDING,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_SLIDER_STEP,
} from '../../shared/constants';
import { computeFitScale } from '../../shared/slideScale';
import type { SourceSelectionEditSubmitPayload } from '../../features/sourceSelection';
import { useSlidesPreviewLocalization } from '../../features/previewRenderState';
import { DeckNavigatorBar, SlideGridView } from '../../features/deckNavigator';
import { StageZoomMenu, type StageZoomMenuAction } from '../../features/stageZoom';
import {
  resolveManualEditingAvailability,
  useManualEditingLocalization,
  useSlidesManualEditingStore,
  useManualEditSubmission,
} from '../../features/manualEditing';

defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();

const ZOOM_PERCENT_MIN = Math.round(ZOOM_MIN * 100);
const ZOOM_PERCENT_MAX = Math.round(ZOOM_MAX * 100);
const ZOOM_PERCENT_STEP = Math.round(ZOOM_STEP * 100);
const ZOOM_PERCENT_SLIDER_STEP = Math.round(ZOOM_SLIDER_STEP * 100);

const slidesStore = useSlidesStore();
const slidesUiStore = useSlidesUiStore();
const slidesRenderStore = useSlidesRenderStore();
const manualEditingStore = useSlidesManualEditingStore();
const { handleClipboardShortcut } = useElementClipboard();
const { handleHistoryShortcut } = useEditingCommands();
const manualEditSubmission = useManualEditSubmission();
const { manualEditingMessage } = useManualEditingLocalization();
const { slidesPreviewMessage } = useSlidesPreviewLocalization();

const {
  deckPreview,
  deckLoading,
  deckError,
  currentDeckId,
  documentBuildState,
} = storeToRefs(slidesStore);
const {
  deckViewMode,
  inspectorVisible,
  zoomLevel,
  zoomMode,
  fitZoomLevel,
} = storeToRefs(slidesUiStore);
const {
  enabled: manualEditingEnabled,
  errorMessage: manualEditError,
  notice: manualEditNotice,
} = storeToRefs(manualEditingStore);
const {
  renderLoading,
  renderModel,
  renderError,
  currentSlideRender,
} = storeToRefs(slidesRenderStore);

/**
 * 统一 loading 门控：deckPreview 或 renderModel 任一处于首次加载中都显示加载态，
 * 避免 deckPreview 到达但 renderModel 未就绪时显示无法交互的空舞台。
 */
const showLoading = computed(() => {
  if (deckLoading.value && !deckPreview.value) return true;
  if (deckPreview.value && renderLoading.value && !renderModel.value) return true;
  return false;
});

const draftFailureLog = computed(() => {
  if (documentBuildState.value?.state !== 'draft') return '';
  return documentBuildState.value.draftStatus.errorSummary?.trim() ?? '';
});

const stageHostRef = ref<globalThis.HTMLElement | null>(null);
const stageViewportWidth = ref(0);
const stageViewportHeight = ref(0);

function clampZoomLevel(level: number): number {
  return Math.max(ZOOM_MIN, Math.min(level, ZOOM_MAX));
}

/**
 * 在父层提前测量舞台容器，避免等待 SlideStage 挂载后才回填 fitZoomLevel，
 * 导致右下角缩放栏先闪成 100% 再跳到真实值。
 */
function syncStageViewport(): void {
  const element = stageHostRef.value;
  if (!element) return;

  const rect = element.getBoundingClientRect();
  stageViewportWidth.value = rect.width;
  stageViewportHeight.value = rect.height;
}

const stageResizeObserver = new globalThis.ResizeObserver(() => {
  syncStageViewport();
});

onMounted(() => {
  syncStageViewport();
  if (stageHostRef.value) {
    stageResizeObserver.observe(stageHostRef.value);
  }
});

onBeforeUnmount(() => {
  stageResizeObserver.disconnect();
});

const resolvedZoomLevel = computed(() => {
  if (zoomMode.value !== 'fit') {
    return clampZoomLevel(zoomLevel.value);
  }

  if (deckPreview.value && stageViewportWidth.value > 0 && stageViewportHeight.value > 0) {
    return clampZoomLevel(
      computeFitScale(
        stageViewportWidth.value,
        stageViewportHeight.value,
        deckPreview.value.slideSize,
        'contain',
        SLIDE_STAGE_FIT_PADDING,
      ),
    );
  }

  return clampZoomLevel(fitZoomLevel.value);
});

const zoomPercent = computed(() => {
  return Math.round(resolvedZoomLevel.value * 100);
});

const manualEditingAvailability = computed(() => resolveManualEditingAvailability({
  buildState: documentBuildState.value,
  renderModel: renderModel.value,
  currentSlide: currentSlideRender.value,
}));

function reload() {
  if (currentDeckId.value) {
    void useSlidesDocumentRuntime().loadDeck(currentDeckId.value);
  }
}

function setZoomPercent(value: number) {
  const clamped = Math.max(ZOOM_PERCENT_MIN, Math.min(ZOOM_PERCENT_MAX, value));
  slidesUiStore.setZoom(clamped / 100, 'manual');
}

function adjustZoom(delta: number) {
  setZoomPercent(zoomPercent.value + delta);
}

function applyZoomMenuAction(action: StageZoomMenuAction) {
  if (action.kind === 'fit') {
    slidesUiStore.zoomToFit();
    return;
  }
  setZoomPercent(action.percent);
}

/**
 * 没有编辑模式：文稿就绪即可手动修改。自己刚提交的修订正在刷新画面时（version_not_ready）
 * 保持可写，避免每次保存都让命令栏和浮条闪成只读。
 */
watch(manualEditingAvailability, availability => {
  if (availability.available) manualEditingStore.setEnabled(true);
  else if (availability.reason !== 'version_not_ready') manualEditingStore.setEnabled(false);
}, { immediate: true });
</script>
