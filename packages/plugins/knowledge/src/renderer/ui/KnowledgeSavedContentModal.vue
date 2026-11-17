<template>
  <Modal :is-visible="target !== null" :title="knowledgeBaseMessage('knowledgeBase.manage.savedContent.title')" width="56em" max-height="80vh" @close="emit('close')">
    <div class="knowledge-saved-content">
      <p v-if="loading" role="status">{{ knowledgeBaseMessage('knowledgeBase.manage.savedContent.loading') }}</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <div ref="contentElement" class="knowledge-saved-content__body" :aria-label="target?.fileName" />
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { Modal } from '@linnya/renderer-ui';
import { createEmbeddedMarkdownEditor, parseEmbeddedMarkdown, type EmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

const props = defineProps<{ target: { kbId: string; documentId: string; fileName: string } | null }>();
const emit = defineEmits<{ close: [] }>();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();
const contentElement = ref<HTMLElement | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

watch(() => props.target, async (target, _previous, onCleanup) => {
  if (!target) return;
  const controller = new AbortController();
  let editor: EmbeddedMarkdownEditor | null = null;
  onCleanup(() => { controller.abort(); editor?.destroy(); });
  loading.value = true;
  error.value = null;
  try {
    const saved = await knowledgeBaseService.readSavedContent(target.kbId, target.documentId, controller.signal);
    await nextTick();
    if (controller.signal.aborted || !contentElement.value) return;
    // 纯独立正文不带 Workspace 文档身份，也不提供任意本地图片路径解析。
    editor = createEmbeddedMarkdownEditor({
      element: contentElement.value, content: parseEmbeddedMarkdown(saved.markdown),
      label: saved.fileName, readonly: true, onUpdate() {},
    });
  } catch (failure) {
    if (!controller.signal.aborted) {
      console.error('[KnowledgeSavedContent] 读取已保存内容失败', failure);
      error.value = knowledgeBaseMessage('knowledgeBase.manage.savedContent.failed');
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });
</script>
