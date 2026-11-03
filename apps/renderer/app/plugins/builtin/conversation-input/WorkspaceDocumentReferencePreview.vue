<template>
  <section
    :aria-label="reference.label"
    @mouseenter="expanded = true"
  >
    <p
      v-if="controller.error.value"
      role="status"
    >
      {{ controller.error.value }}
    </p>
    <template v-else-if="current">
      <strong>{{ current.preview.title ?? reference.label }}</strong>
      <img
        v-if="current.preview.content?.image"
        :src="current.preview.content.image.dataUri"
        :alt="current.preview.title ?? ''"
      >
      <p>{{ current.preview.content?.summary ?? unavailable }}</p>
      <button
        v-if="recovery"
        type="button"
        @click="recover"
      >
        {{ recovery.label }}
      </button>
      <button
        v-if="detailComponent || current.preview.content?.detail"
        type="button"
        @click="expanded = true"
      >
        展开
      </button>
      <component
        :is="detailComponent"
        v-if="expanded && detailComponent"
        :document-id="current.presentation.documentId"
        :project-id="projectId"
      />
      <div
        v-else-if="expanded"
        ref="detail"
        class="markdown-document-content"
        @click="preventPreviewNavigation"
      />
    </template>
    <p
      v-else
      role="status"
    >
      正在读取文档预览…
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import { useNavigationScope } from '@/app/navigation';
import { readDocumentTypePreviewComponent, readDocumentTypeRecoveryAction } from '@/app/plugins/documentTypePresentation';
import { createWorkspaceReferencePreview } from './createWorkspaceReferencePreview';
const props = defineProps<{ reference: ConversationReferenceChipInput }>();
const scope = useNavigationScope(), expanded = ref(false), detail = ref<HTMLElement | null>(null);
const controller = createWorkspaceReferencePreview(props.reference, () => scope.currentProjectId);
const current = controller.result, projectId = computed(() => scope.currentProjectId);
const unavailable = computed(() => current.value?.presentation.status === 'plugin_unavailable' ? '需要启用或安装对应插件' : '文档当前不可预览');
const recovery = computed(() => current.value?.presentation.status === 'plugin_unavailable' && current.value.presentation.nodeType ? readDocumentTypeRecoveryAction(current.value.presentation.nodeType) : null);
const detailComponent = computed(() => current.value?.presentation.status === 'available' && current.value.preview.status === 'ready' && current.value.presentation.nodeType ? readDocumentTypePreviewComponent(current.value.presentation.nodeType) : null);
async function recover() {
  try { await recovery.value?.activate(); await controller.refresh(); }
  catch (failure) { controller.error.value = failure instanceof Error ? failure.message : '无法启用对应插件'; }
}
// hover内的正文只读，打开源文档由外侧引用按钮统一执行并复核项目身份。
function preventPreviewNavigation(event: MouseEvent) { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }
watch(() => scope.currentProjectId, () => { expanded.value = false; void controller.refresh(); }, { immediate: true });
watch(current, () => { expanded.value = false; });
watch(expanded, async value => {
  const content = current.value?.preview.content?.detail;
  if (!value || detailComponent.value || !content) return;
  const identity = current.value;
  if (content.format === 'text') { await nextTick(); if (expanded.value && current.value === identity && detail.value) detail.value.textContent = content.text; return; }
  const markdown = await import('@linnya/markdown-document-core'); await nextTick();
  if (expanded.value && current.value === identity && detail.value) detail.value.replaceChildren(markdown.createMarkdownDocumentFragment(markdown.parseMarkdownDocument(content.text), detail.value.ownerDocument));
});
onBeforeUnmount(controller.dispose);
</script>
