<template>
  <div
    class="deck-viewer"
    @keydown="handleHistoryShortcut($event); handleClipboardShortcut($event)"
  >
    <div class="deck-viewer-body">
      <!-- 主区域：单页舞台或全稿平铺 -->
      <div
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

        <div
          v-if="suspendedManualEditCount && !manualEditError && !manualEditNotice"
          class="stage-manual-edit-error"
          role="status"
        >
          部分人工修改因原对象或生成逻辑变化未应用。请让 AI 检查源码及历史，恢复需要的修改。
        </div>

        <!-- 顶部居中的文稿命令条浮在舞台上，不进入布局；幻灯片位置不随它出现或消失。 -->
        <SlideEditingCommandBar v-if="manualEditingEnabled && deckPreview && deckViewMode === 'slide'" />
      </div>
    </div>

    <!-- 底部导航：文稿切换时立即撤下旧页面条，加载期间保留同高占位避免舞台跳动。 -->
    <div
      v-if="showLoading"
      class="navigator-loading-spacer"
    />
    <DeckNavigatorBar v-else-if="deckPreview">
      <!-- 缩放只作用于单页舞台；平铺视图不提供插槽内容，底栏随之省去缩放组与分隔线。 -->
      <template
        v-if="deckViewMode === 'slide'"
        #view-controls
      >
        <StageZoomControls
          :zoom-percent="zoomPercent"
          :zoom-mode="zoomMode"
          @set-percent="setZoomPercent"
          @action="applyZoomMenuAction"
        />
      </template>
    </DeckNavigatorBar>
  </div>
</template>

<script setup lang="ts">
import { useElementClipboard } from '../../features/elementClipboard';
import { SlideEditingCommandBar, useEditingCommands } from '../../features/editingCommands';

import { useSlidesDocumentRuntime } from '../../features/documentRuntime';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesStore } from '../../features/documentRuntime';
import { useSlidesUiStore } from '../../store/slidesUiStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import SlideStage from '../preview/SlideStage.vue';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import { SlidesDraftFailureLog } from '../../features/documentBuildFailure';
import type { SourceSelectionEditSubmitPayload } from '../../features/sourceSelection';
import { DeckNavigatorBar, SlideGridView } from '../../features/deckNavigator';
import { StageZoomControls, clampStageZoomPercent, type StageZoomMenuAction } from '../../features/stageZoom';
import { useManualEditingLocalization } from '../../features/manualEditing/ui';
import { useSlidesManualSubmissionStore, useManualEditSubmission } from '../../features/manualEditing/submission';
import { useManualEditingEnabled } from '../../features/manualEditing/selection';

defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();


const slidesStore = useSlidesStore();
const slidesUiStore = useSlidesUiStore();
const slidesRenderStore = useSlidesRenderStore();
const manualEditingStore = useSlidesManualSubmissionStore();
const manualEditingEnabled = useManualEditingEnabled();
const { handleClipboardShortcut } = useElementClipboard();
const { handleHistoryShortcut } = useEditingCommands();
const manualEditSubmission = useManualEditSubmission();
const { manualEditingMessage } = useManualEditingLocalization();

const {
  deckPreview,
  deckLoading,
  deckError,
  currentDeckId,
  documentBuildState,
} = storeToRefs(slidesStore);
const {
  deckViewMode,
  zoomLevel,
  zoomMode,
  fitZoomLevel,
} = storeToRefs(slidesUiStore);
const {
  errorMessage: manualEditError,
  notice: manualEditNotice,
} = storeToRefs(manualEditingStore);
const {
  renderLoading,
  renderModel,
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
const suspendedManualEditCount = computed(() => deckPreview.value?.warnings.filter(warning => warning.code === 'manual_edit_suspended').length ?? 0);

const draftFailureLog = computed(() => {
  if (documentBuildState.value?.state !== 'draft') return '';
  return documentBuildState.value.draftStatus.errorSummary?.trim() ?? '';
});

const resolvedZoomLevel = computed(() => zoomMode.value === 'fit' ? fitZoomLevel.value : zoomLevel.value);

const zoomPercent = computed(() => {
  return Math.round(resolvedZoomLevel.value * 100);
});

function reload() {
  if (currentDeckId.value) {
    void useSlidesDocumentRuntime().loadDeck(currentDeckId.value);
  }
}

function setZoomPercent(value: number) {
  slidesUiStore.setZoom(clampStageZoomPercent(value) / 100, 'manual');
}

function applyZoomMenuAction(action: StageZoomMenuAction) {
  if (action.kind === 'fit') {
    slidesUiStore.zoomToFit();
    return;
  }
  setZoomPercent(action.percent);
}

</script>
