<template>
  <section
    class="readonly-document-preview"
    :aria-label="label || '文档只读预览'"
    @mouseenter="
      pointerInside = true;
      expanded = true;
    "
    @mouseleave="pointerInside = false"
  >
    <p
      v-if="controller.error.value"
      role="status"
    >
      {{ controller.error.value }}
    </p>
    <template v-else-if="current">
      <strong v-if="!detailOnly">{{ current.preview.title ?? label }}</strong>
      <template v-if="!expanded">
        <img
          v-if="current.preview.content?.image"
          :src="current.preview.content.image.dataUri"
          :alt="current.preview.title ?? ''"
        >
        <p>{{ current.preview.content?.summary ?? unavailable }}</p>
      </template>
      <button
        v-if="recovery"
        type="button"
        @click="controller.recover(recovery)"
      >
        {{ recovery.label }}
      </button>
      <button
        v-if="!expanded && hasDetail"
        type="button"
        @click="expanded = true"
      >
        展开
      </button>
      <component
        :is="detailComponent"
        v-if="expanded && detailComponent"
        :document-id="current.target.documentId"
        :project-id="current.target.projectId"
      />
      <div
        v-else-if="expanded && markdownDetail"
        ref="detail"
        class="markdown-document-content readonly-document-preview__detail"
        @click="preventPreviewNavigation"
      />
      <p v-else-if="expanded">
        {{ current.preview.content?.summary ?? unavailable }}
      </p>
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
import { computed, nextTick, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useNavigationScope } from '@/app/navigation';
import {
  readDocumentTypePreviewComponent,
  readDocumentTypeRecoveryAction,
} from '@/app/plugins/documentTypePresentation';
import type { DocumentPreviewTarget } from '../definitions/documentPreview';
import { createDocumentPreviewController } from '../orchestration/createDocumentPreviewController';
const props = defineProps<{
  readTarget: () => DocumentPreviewTarget;
  detailOnly?: boolean;
  label?: string;
}>();
const scope = useNavigationScope(),
  expanded = ref(Boolean(props.detailOnly)),
  pointerInside = ref(false),
  detail = ref<HTMLElement | null>(null);
const controller = createDocumentPreviewController(props.readTarget, () => scope.currentProjectId),
  current = controller.result;
const unavailable = computed(() =>
  current.value?.presentation.status === 'plugin_unavailable'
    ? '需要启用或安装对应插件'
    : '文档当前不可预览'
);
const recovery = computed(() =>
  current.value?.presentation.status === 'plugin_unavailable' && current.value.presentation.nodeType
    ? readDocumentTypeRecoveryAction(current.value.presentation.nodeType)
    : null
);
const detailComponent = computed(() =>
  current.value?.presentation.status === 'available' &&
  current.value.preview.status === 'ready' &&
  current.value.presentation.nodeType
    ? readDocumentTypePreviewComponent(current.value.presentation.nodeType)
    : null
);
const markdownDetail = computed(() =>
  current.value?.presentation.status === 'available' && current.value.preview.status === 'ready'
    ? current.value.preview.content?.detail
    : null
);
const hasDetail = computed(() => Boolean(detailComponent.value || markdownDetail.value));
function preventPreviewNavigation(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}
// getter在controller的try内运行，失效引用显示状态而不是在Vue watcher中抛出。
watchEffect(() => {
  void controller.refresh();
});
watch(current, () => {
  expanded.value = Boolean(props.detailOnly || pointerInside.value);
});
watch([expanded, current], async ([value]) => {
  const identity = current.value,
    content = markdownDetail.value;
  if (!value || detailComponent.value || !content || !identity) return;
  if (content.format === 'text') {
    await nextTick();
    if (controller.isCurrent(identity) && expanded.value && detail.value)
      detail.value.textContent = content.text;
    return;
  }
  const markdown = await import('@linnya/markdown-document-core');
  await nextTick();
  if (controller.isCurrent(identity) && expanded.value && detail.value)
    detail.value.replaceChildren(
      markdown.createMarkdownDocumentFragment(
        markdown.parseMarkdownDocument(content.text),
        detail.value.ownerDocument
      )
    );
});
onBeforeUnmount(controller.dispose);
</script>
