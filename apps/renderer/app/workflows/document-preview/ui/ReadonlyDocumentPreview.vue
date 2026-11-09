<template>
  <section class="readonly-document-preview" :aria-label="label || '文档只读预览'"
    @mouseenter="pointerInside = true; expanded = true" @mouseleave="pointerInside = false">
    <p v-if="controller.error.value" role="status">{{ controller.error.value }}</p>
    <p v-else-if="!current" role="status">正在读取文档预览…</p>
    <p v-if="surface.phase.value === 'failed'" role="alert">详情暂不可用，请重新打开预览。</p>
    <div ref="viewport" class="readonly-document-preview__viewport" @click="preventPreviewNavigation" />
    <Teleport v-if="detailComponent && expanded && surface.body.value && current" :to="surface.body.value">
      <component :is="detailComponent" :document-id="current.target.documentId" :project-id="current.target.projectId" />
    </Teleport>
    <button v-if="recovery" type="button" @click="controller.recover(recovery)">{{ recovery.label }}</button>
    <button v-if="!expanded && hasDetail" type="button" @click="expanded = true">展开</button>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { DOCUMENT_PREVIEW_LAYOUT } from '@linnya/document-preview';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { useNavigationScope } from '@/app/navigation';
import { readDocumentTypeIcon, readDocumentTypePreviewComponent, readDocumentTypeRecoveryAction } from '@/app/plugins/documentTypePresentation';
import type { DocumentPreviewTarget } from '../definitions/documentPreview';
import { createDocumentPreviewController } from '../orchestration/createDocumentPreviewController';
import { createReadonlyDocumentSurface } from '../orchestration/createReadonlyDocumentSurface';
const props = defineProps<{ readTarget: () => DocumentPreviewTarget; detailOnly?: boolean; label?: string; widthPx?: number }>();
const emit = defineEmits<{ ready: [] }>();
const scope = useNavigationScope(), expanded = ref(Boolean(props.detailOnly)), pointerInside = ref(false);
const viewport = ref<HTMLElement | null>(null), measuredWidth = ref(0);
const theme = ref<'light' | 'dark'>('light');
const controller = createDocumentPreviewController(props.readTarget, () => scope.currentProjectId), current = controller.result;
const surface = createReadonlyDocumentSurface({ element: () => viewport.value,
  ready: () => emit('ready'), report: failure => console.warn('[document-preview] presentation failed', failure) });
const recovery = computed(() => current.value?.presentation.status === 'plugin_unavailable' && current.value.presentation.nodeType
  ? readDocumentTypeRecoveryAction(current.value.presentation.nodeType) : null);
const detailComponent = computed(() => current.value?.presentation.status === 'available' && current.value.preview.status === 'ready' && current.value.presentation.nodeType
  ? readDocumentTypePreviewComponent(current.value.presentation.nodeType) : null);
const hasDetail = computed(() => Boolean(detailComponent.value || current.value?.preview.content?.detail));
function preventPreviewNavigation(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}
// 使用未变换的布局宽度；画布相机缩放不能改变正文的换行。
let resize: ResizeObserver | undefined, appearance: MutationObserver | undefined;
onMounted(() => {
  const root = document.documentElement;
  const readTheme = () => { theme.value = root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark' ? 'dark' : 'light'; };
  readTheme(); appearance = new MutationObserver(readTheme);
  appearance.observe(root, { attributes: true, attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE] });
  resize = new ResizeObserver(entries => { const entry = entries[0]; if (entry) measuredWidth.value = entry.contentRect.width; });
  if (viewport.value) resize.observe(viewport.value);
});
watchEffect(() => { void controller.refresh(); });
watch(current, () => { expanded.value = Boolean(props.detailOnly || pointerInside.value); });
watch([current, expanded, theme, measuredWidth, () => props.widthPx], () => {
  const identity = current.value, width = props.widthPx ?? measuredWidth.value;
  if (!identity || width <= 0) { surface.clear(); return; }
  void surface.render({ preview: identity.preview, widthPx: width,
    maxHeight: expanded.value ? undefined : DOCUMENT_PREVIEW_LAYOUT.firstScreenHeight,
    theme: theme.value, icon: identity.presentation.nodeType ? readDocumentTypeIcon(identity.presentation.nodeType) : null,
    externalBody: expanded.value && Boolean(detailComponent.value),
    onOpen: identity.presentation.status === 'available' ? () => { void controller.open(identity); } : undefined,
  }, () => controller.isCurrent(identity));
}, { flush: 'post' });
onBeforeUnmount(() => { resize?.disconnect(); appearance?.disconnect(); surface.clear(); controller.dispose(); });
</script>
