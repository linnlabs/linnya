<template>
  <section class="canvas-history-preview" :aria-label="t('canvas.history.label')">
    <div ref="host" class="canvas-stage" />
    <div ref="staging" class="canvas-raster-staging" aria-hidden="true" />
    <BaseButton variant="secondary" size="sm" class="canvas-history-fit" @click="preview?.fit()">
      {{ t('canvas.zoom.fit') }}
    </BaseButton>
    <p v-if="preview?.state.phase.value === 'loading'" class="canvas-status" role="status">
      {{ t('canvas.history.loading') }}
    </p>
    <p v-if="preview?.state.error.value" class="canvas-status canvas-status-error" role="alert">
      {{ preview.state.error.value }}
    </p>
    <div
      v-if="budgetNotice || preview?.state.renderNotice.value"
      class="canvas-read-notice"
      role="status"
    >
      <p v-if="budgetNotice">
        {{ budgetNotice }}
      </p>
      <p v-if="preview?.state.renderNotice.value">
        {{ preview.state.renderNotice.value }}
      </p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import { canvasText as t } from '../features/localization';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createCanvasRasterPresentation } from '../orchestration/createCanvasRasterPresentation';
import { installCanvasResolutionObserver } from '../orchestration/installCanvasResolutionObserver';
import { createCanvasCardContent } from '../features/cardMedia';
import { createCanvasCardMediaPort } from '../adapters/createCanvasCardMediaPort';
import { createCanvasHistoryPreview, canvasVersionBudgetNotice } from '../features/historyPreview';
import { useCanvasPreferencesStore } from '../features/materialSetting';
import { createCanvasHistoryPort } from '../adapters/createCanvasHistoryPort';
import { readCanvasAppearance } from '../functions/readCanvasAppearance';
const props = defineProps<{ documentId: string; versionId: string }>();
const host = ref<HTMLElement | null>(null),
  staging = ref<HTMLElement | null>(null);
const preview = shallowRef<ReturnType<typeof createCanvasHistoryPreview> | null>(null);
const preferences = useCanvasPreferencesStore();
const budgetNotice = computed(() =>
  canvasVersionBudgetNotice(preview.value?.state.budget.value ?? null)
);
let removeBudget: (() => void) | null = null,
  theme: MutationObserver | null = null;
onMounted(() => {
  const stage = host.value,
    stagingHost = staging.value;
  if (!stage || !stagingHost) return;
  const port = createCanvasHistoryPort();
  preview.value = createCanvasHistoryPreview({
    host: stage,
    createContent: documentId => createCanvasCardContent(documentId, createCanvasCardMediaPort()),
    createRaster: settings => createCanvasRasterPresentation({ ...settings, host: stagingHost }),
    read: port.read,
    readBudget: port.readBudget,
    readAppearance: () => readCanvasAppearance(preferences.preferences),
    observeResolution: installCanvasResolutionObserver,
  });
  removeBudget = port.subscribeBudget(status => preview.value?.budgetChanged(status));
  theme = new MutationObserver(() => preview.value?.refreshAppearance());
  theme.observe(document.documentElement, { attributes: true });
  void preview.value.open(props.documentId, props.versionId);
});
watch([() => props.documentId, () => props.versionId], ([documentId, versionId]) => {
  void preview.value?.open(documentId, versionId);
});
watch(
  () => preferences.preferences,
  () => preview.value?.refreshAppearance()
);
onBeforeUnmount(() => {
  removeBudget?.();
  theme?.disconnect();
  preview.value?.dispose();
});
</script>
