<template>
  <div class="deck-viewer">
    <div class="deck-viewer-body">
      <!-- 左栏：缩略图列表 -->
      <div
        v-if="!outlineCollapsed"
        class="deck-viewer-outline"
        :style="{ width: `${OUTLINE_DEFAULT_WIDTH}px` }"
      >
        <!-- 文稿切换时必须立即撤下旧列表，不能让已销毁滚动实例的离场 DOM 继续显示。 -->
        <div v-if="showLoading" class="outline-loading-spacer" />
        <DeckOutline v-else />
      </div>

      <!-- 中栏：Slide 预览舞台 -->
      <div ref="stageHostRef" class="deck-viewer-stage">
        <!-- loading 期间不保留上一份文稿的状态页或舞台 DOM。 -->
        <div v-if="showLoading" class="stage-loading-spacer" />
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
        <SlideStage
          v-else
          :source-edit-busy="sourceEditBusy"
          @source-edit-submit="emit('sourceEditSubmit', $event)"
        />

        <!-- 右下角缩放控件只更新自身数值，不参与文稿内容切换。 -->
        <div v-if="deckPreview" class="stage-zoom-slider">
          <button
            class="stage-zoom-slider__btn"
            :disabled="zoomPercent <= ZOOM_PERCENT_MIN"
            aria-label="缩小"
            @click="adjustZoom(-ZOOM_PERCENT_STEP)"
          >
            <MinusIcon class="stage-zoom-slider__icon" />
          </button>
          <input
            ref="sliderInput"
            class="stage-zoom-slider__input"
            type="range"
            :min="ZOOM_PERCENT_MIN"
            :max="ZOOM_PERCENT_MAX"
            :step="ZOOM_PERCENT_SLIDER_STEP"
            :value="zoomPercent"
            @input="onSliderInput"
          >
          <button
            class="stage-zoom-slider__btn"
            :disabled="zoomPercent >= ZOOM_PERCENT_MAX"
            aria-label="放大"
            @click="adjustZoom(ZOOM_PERCENT_STEP)"
          >
            <AddIcon class="stage-zoom-slider__icon" />
          </button>
          <span class="stage-zoom-slider__label">{{ zoomPercent }}%</span>
          <button
            class="stage-zoom-slider__btn stage-zoom-slider__fit-btn"
            :class="{ 'is-active': zoomMode === 'fit' }"
            aria-label="适配窗口大小"
            title="适配窗口大小"
            @click="zoomToFit"
          >
            <HomeIcon class="stage-zoom-slider__icon" />
          </button>
          <button
            class="stage-zoom-slider__btn stage-zoom-slider__select-btn"
            :class="{ 'is-active': sourceSelectionModeEnabled }"
            :disabled="!canUseSourceSelectionMode"
            :aria-pressed="sourceSelectionModeEnabled"
            aria-label="选择 PPT 元素"
            :title="sourceSelectionButtonTitle"
            @click="toggleSourceSelectionMode"
          >
            <SelectObjectIcon class="stage-zoom-slider__icon" />
          </button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesUiStore } from '../../store/slidesUiStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import {
  AddIcon,
  HomeIcon,
  MinusIcon,
  SelectObjectIcon,
} from '@linnya/renderer-ui/icons';
import DeckOutline from './DeckOutline.vue';
import SlideStage from '../preview/SlideStage.vue';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import { SlidesDraftFailureLog } from '../../features/documentBuildFailure';
import {
  INSPECTOR_DEFAULT_WIDTH,
  OUTLINE_DEFAULT_WIDTH,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_SLIDER_STEP,
} from '../../shared/constants';
import { computeFitScale } from '../../shared/slideScale';
import {
  resolveSourceSelectionAvailability,
  type SourceSelectionEditSubmitPayload,
} from '../../features/sourceSelection';
import { isKonvaNodeSupported } from '../../features/konvaPreview';
import { useSlidesPreviewLocalization } from '../../features/previewRenderState';

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
const { slidesPreviewMessage } = useSlidesPreviewLocalization();

const {
  deckPreview,
  deckLoading,
  deckError,
  currentDeckId,
  documentBuildState,
} = storeToRefs(slidesStore);
const {
  outlineCollapsed,
  inspectorVisible,
  zoomLevel,
  zoomMode,
  fitZoomLevel,
  sourceSelectionModeEnabled,
} = storeToRefs(slidesUiStore);
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
const sliderInput = ref<HTMLInputElement | null>(null);

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
      ),
    );
  }

  return clampZoomLevel(fitZoomLevel.value);
});

const zoomPercent = computed(() => {
  return Math.round(resolvedZoomLevel.value * 100);
});

const currentSlideKonvaCompatible = computed(() =>
  currentSlideRender.value !== null
  && currentSlideRender.value.elements.every(isKonvaNodeSupported),
);

const sourceSelectionAvailability = computed(() =>
  resolveSourceSelectionAvailability({
    renderModel: renderModel.value,
    currentSlideRender: currentSlideRender.value,
    currentSlideKonvaCompatible: currentSlideKonvaCompatible.value,
  }),
);

const canUseSourceSelectionMode = computed(() => sourceSelectionAvailability.value.canEnableMode);

const sourceSelectionButtonTitle = computed(() =>
  canUseSourceSelectionMode.value
    ? (sourceSelectionModeEnabled.value ? '关闭元素选择模式' : '打开元素选择模式')
    : sourceSelectionAvailability.value.label,
);

function reload() {
  if (currentDeckId.value) {
    slidesStore.loadDeck(currentDeckId.value);
  }
}

function setZoomPercent(value: number) {
  const clamped = Math.max(ZOOM_PERCENT_MIN, Math.min(ZOOM_PERCENT_MAX, value));
  slidesUiStore.setZoom(clamped / 100, 'manual');
  updateSliderProgress();
}

function adjustZoom(delta: number) {
  setZoomPercent(zoomPercent.value + delta);
}

function onSliderInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  setZoomPercent(value);
}

function zoomToFit() {
  slidesUiStore.zoomToFit();
}

function toggleSourceSelectionMode() {
  if (!canUseSourceSelectionMode.value) {
    return;
  }
  slidesUiStore.toggleSourceSelectionMode();
}

function updateSliderProgress() {
  const input = sliderInput.value;
  if (!input) return;
  const pct = ((zoomPercent.value - ZOOM_PERCENT_MIN) / (ZOOM_PERCENT_MAX - ZOOM_PERCENT_MIN)) * 100;
  input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, pct))}%`);
}

watch(zoomPercent, () => nextTick(updateSliderProgress));
watch(canUseSourceSelectionMode, (enabled) => {
  if (!enabled && sourceSelectionModeEnabled.value) {
    slidesUiStore.setSourceSelectionModeEnabled(false);
  }
});
</script>
